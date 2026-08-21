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
  title: '',
  body: '',
  status: 'problem',
  tag: '',
  assignees: [],
  notes: [],
  position: 1000,
  board: 'main',
}

const clone = (v) => JSON.parse(JSON.stringify(v))

class Query {
  constructor(db, op, payload) {
    this.db = db
    this.op = op
    this.payload = payload
    this.filters = []
    this.returning = op === 'select'
    this.wantsSingle = false
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
      case 'select':  return this.finish(this.db.rows.filter((r) => this.matches(r)))
      case 'insert':  return this.runInsert()
      case 'update':  return this.runUpdate()
      case 'delete':  return this.runDelete()
      default:        throw new Error(`unsupported op ${this.op}`)
    }
  }

  runInsert() {
    const row = { ...DEFAULTS, ...clone(this.payload) }
    if (this.db.rows.some((r) => r.id === row.id)) {
      return {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }
    }
    const now = this.db.now()
    row.created_at = now
    row.updated_at = now
    this.db.rows.push(row)
    this.db.notify('INSERT', row)
    return this.finish([row])
  }

  runUpdate() {
    const hit = this.db.rows.filter((r) => this.matches(r))
    for (const row of hit) {
      const { id, board, created_at, updated_at, ...safe } = clone(this.payload)
      Object.assign(row, safe)
      // The trigger in schema.sql: server clock wins, created_at is immutable.
      row.updated_at = this.db.now()
      this.db.notify('UPDATE', row)
    }
    return this.finish(hit)
  }

  runDelete() {
    const kept = []
    const removed = []
    for (const row of this.db.rows) (this.matches(row) ? removed : kept).push(row)
    this.db.rows = kept
    for (const row of removed) this.db.notify('DELETE', row)
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

  on(_event, _filter, handler) {
    this.handlers.push(handler)
    return this
  }

  subscribe(cb) {
    this.subscribed = true
    this.db.channels.add(this)
    cb?.('SUBSCRIBED')
    return this
  }

  emit(payload) {
    for (const handler of this.handlers) handler(payload)
  }
}

export function createFakeSupabase({ rows = [], clock } = {}) {
  let tick = 0

  const db = {
    rows: clone(rows),
    channels: new Set(),
    nextError: null,
    now: clock || (() => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick++)).toISOString()),
    notify(eventType, row) {
      for (const channel of db.channels) {
        channel.emit({ eventType, new: clone(row), old: clone(row) })
      }
    },
  }

  const client = {
    from() {
      return {
        select: () => new Query(db, 'select'),
        insert: (payload) => new Query(db, 'insert', payload),
        update: (payload) => new Query(db, 'update', payload),
        delete: () => new Query(db, 'delete'),
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
      return db.rows
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
