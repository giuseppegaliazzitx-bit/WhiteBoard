/**
 * An in-memory stand-in for the slice of supabase-js the adapter uses.
 *
 * Worth the ~150 lines: without it, the Supabase adapter would be the one
 * piece of the storage layer with no test at all, and the whole justification
 * for the store interface in phase 2 was that both adapters behave alike.
 *
 * It models the parts of Postgres the adapter depends on -- column defaults,
 * the updated_at trigger, immutable created_at, PGRST116 on a missing single()
 * row, and delete-is-idempotent -- plus a hook to inject errors.
 */

const DEFAULTS = {
  cards: {
    title: '',
    body: '',
    status: 'problem',
    tag: '',
    assignees: [],
    notes: [],
    position: 1000,
    board: 'main',
  },
  people: {
    name: '',
    board: 'main',
  },
  canvas_objects: {
    kind: 'sticky',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    z: 0,
    data: {},
    board: 'main',
  },
  sheets: {
    title: '',
    body: '',
    position: 1000,
    board: 'main',
  },
}

const clone = (v) => JSON.parse(JSON.stringify(v))

class Query {
  constructor(db, op, payload, table) {
    this.db = db
    this.op = op
    this.payload = payload
    this.table = table
    this.filters = []
    this.returning = op === 'select'
    this.wantsSingle = false
  }

  rows() {
    return this.db.tables[this.table] || []
  }

  setRows(rows) {
    this.db.tables[this.table] = rows
  }

  select() {
    this.returning = true
    return this
  }

  eq(column, value) {
    this.filters.push([column, value])
    return this
  }

  single() {
    this.wantsSingle = true
    return this
  }

  matches(row) {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  run() {
    const injected = this.db.nextError
    if (injected) {
      this.db.nextError = null
      return { data: null, error: injected }
    }

    switch (this.op) {
      case 'select':  return this.finish(this.rows().filter((r) => this.matches(r)))
      case 'insert':  return this.runInsert()
      case 'update':  return this.runUpdate()
      case 'delete':  return this.runDelete()
      default:        throw new Error(`unsupported op ${this.op}`)
    }
  }

  runInsert() {
    const row = { ...(DEFAULTS[this.table] || {}), ...clone(this.payload) }
    if (this.rows().some((r) => r.id === row.id)) {
      return {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }
    }
    const now = this.db.now()
    row.created_at = now
    row.updated_at = now
    this.rows().push(row)
    this.db.notify('INSERT', row, this.table)
    return this.finish([row])
  }

  runUpdate() {
    const hit = this.rows().filter((r) => this.matches(r))
    for (const row of hit) {
      const { id, board, created_at, updated_at, ...safe } = clone(this.payload)
      Object.assign(row, safe)
      // The trigger in schema.sql: server clock wins, created_at is immutable.
      row.updated_at = this.db.now()
      this.db.notify('UPDATE', row, this.table)
    }
    return this.finish(hit)
  }

  runDelete() {
    const kept = []
    const removed = []
    for (const row of this.rows()) (this.matches(row) ? removed : kept).push(row)
    this.setRows(kept)
    for (const row of removed) this.db.notify('DELETE', row, this.table)
    // Deleting nothing is not an error in Postgres.
    return this.finish(removed)
  }

  finish(rows) {
    if (!this.returning) return { data: null, error: null }

    if (this.wantsSingle) {
      if (rows.length !== 1) {
        return {
          data: null,
          error: {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
          },
        }
      }
      return { data: clone(rows[0]), error: null }
    }
    return { data: clone(rows), error: null }
  }

  // supabase-js query builders are thenable rather than promises.
  then(onFulfilled, onRejected) {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected)
  }
}

class FakeChannel {
  constructor(db, name) {
    this.db = db
    this.name = name
    this.handlers = []
    this.subscribed = false
  }

  on(_event, filter, handler) {
    this.handlers.push({ table: filter?.table, handler })
    return this
  }

  subscribe(cb) {
    this.subscribed = true
    this.db.channels.add(this)
    cb?.('SUBSCRIBED')
    return this
  }

  emit(payload) {
    for (const { table, handler } of this.handlers) {
      if (table && payload.table && table !== payload.table) continue
      handler(payload)
    }
  }
}

export function createFakeSupabase({ rows = [], people = [], canvas = [], sheets = [], clock } = {}) {
  let tick = 0

  const db = {
    tables: {
      cards: clone(rows),
      people: clone(people),
      canvas_objects: clone(canvas),
      sheets: clone(sheets),
    },
    channels: new Set(),
    nextError: null,
    now: clock || (() => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++)).toISOString()),
    notify(eventType, row, table = 'cards') {
      for (const channel of db.channels) {
        channel.emit({ eventType, table, new: clone(row), old: clone(row) })
      }
    },
  }

  const client = {
    from(table = 'cards') {
      return {
        select: () => new Query(db, 'select', null, table),
        insert: (payload) => new Query(db, 'insert', payload, table),
        update: (payload) => new Query(db, 'update', payload, table),
        delete: () => new Query(db, 'delete', null, table),
      }
    },

    channel(name) {
      return new FakeChannel(db, name)
    },

    removeChannel(channel) {
      db.channels.delete(channel)
      return Promise.resolve('ok')
    },
  }

  return {
    client,
    /** Rows currently "in the database". */
    get rows() {
      return db.tables.cards
    },
    get people() {
      return db.tables.people
    },
    get canvas() {
      return db.tables.canvas_objects
    },
    /** Number of live realtime channels -- used to assert cleanup. */
    get channelCount() {
      return db.channels.size
    },
    /** Make the next query fail with this Supabase error object. */
    failNext(error) {
      db.nextError = error
    },
    /** Push a realtime event as if another client had written. */
    emitRemote(eventType = 'UPDATE', row = { id: 'x' }) {
      db.notify(eventType, row)
    },
  }
}
