import { normalizeCard, normalizePerson, newId, personKey } from '../model.js'
import { normalizeCanvasObject } from '../canvas-model.js'

/**
 * Supabase adapter. Implements the same interface as the localStorage one --
 * see tests/helpers/store-contract.js, which both are held to.
 *
 * Known limitation: `notes` and `assignees` are jsonb arrays updated by
 * read-modify-write. Two people posting a note in the same second can lose one
 * of the two. The fix is an RPC that appends server-side; for a board this
 * size the race is rare enough that the extra setup step is not worth it. It
 * is documented in README.md so nobody rediscovers it the hard way.
 */

const TABLE = 'cards'
const PEOPLE_TABLE = 'people'
const CANVAS_TABLE = 'canvas_objects'

/** Columns a client is allowed to write. Everything else is server-owned. */
const WRITABLE = ['title', 'body', 'status', 'tag', 'assignees', 'notes', 'position']
const CANVAS_WRITABLE = ['kind', 'x', 'y', 'w', 'h', 'z', 'data']

/**
 * Keep only writable keys, and run each through the same normalizer used on
 * reads. Postgres has check constraints on status, on the jsonb shapes and on
 * field lengths (see supabase/schema.sql) -- sending a bad status would come
 * back as an opaque 23514, so it is cleaned here instead.
 */
function pickWritable(patch) {
  const normalized = normalizeCard(patch)
  const out = {}
  for (const key of WRITABLE) {
    if (key in patch) out[key] = normalized[key]
  }
  return out
}

function pickCanvasWritable(patch) {
  const normalized = normalizeCanvasObject(patch)
  const out = {}
  for (const key of CANVAS_WRITABLE) {
    if (key in patch) out[key] = normalized[key]
  }
  return out
}

/** Turn a Supabase error into something worth showing a person. */
function explain(error, fallback) {
  if (!error) return new Error(fallback)

  const code = error.code || ''
  const message = String(error.message || '')

  if (code === 'PGRST116') return new Error('That card no longer exists.')
  if (code === '42501' || /row-level security/i.test(message)) {
    return new Error('The database rejected that write. Check the RLS policy on `cards`.')
  }
  // PGRST205 is what PostgREST returns for an unknown table; 42P01 is the raw
  // Postgres code, which only surfaces on a direct query. Both mean the same
  // thing to the person reading it.
  if (code === 'PGRST205' || code === '42P01' || /relation .* does not exist/i.test(message) ||
      /could not find the table/i.test(message)) {
    return new Error('A table is missing. Re-run supabase/schema.sql on your project.')
  }
  if (/JWT|api key/i.test(message)) {
    return new Error('Supabase rejected the anon key. Check VITE_SUPABASE_ANON_KEY.')
  }
  if (/fetch|network/i.test(message)) {
    return new Error('Could not reach Supabase. The project may be paused, or you are offline.')
  }
  return new Error(message || fallback)
}

export function createSupabaseStore({ client, boardId = 'main' }) {
  const listeners = new Set()
  const statusListeners = new Set()
  let channel = null
  let lastStatus = 'connecting'

  function fanOut(set, arg) {
    for (const fn of set) {
      try {
        fn(arg)
      } catch (err) {
        console.error('store listener failed', err)
      }
    }
  }

  const table = () => client.from(TABLE)

  function setStatus(raw) {
    // supabase-js reports SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED.
    lastStatus = raw === 'SUBSCRIBED' ? 'live' : raw === 'CLOSED' ? 'connecting' : 'offline'
    fanOut(statusListeners, lastStatus)
  }

  function openChannel() {
    if (channel) return
    const onChange = () => fanOut(listeners)
    channel = client
      .channel(`board:${boardId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLE, filter: `board=eq.${boardId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PEOPLE_TABLE, filter: `board=eq.${boardId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: CANVAS_TABLE, filter: `board=eq.${boardId}` },
        onChange,
      )
      .subscribe(setStatus)
  }

  function closeChannelIfIdle() {
    if (channel && !listeners.size && !statusListeners.size) {
      client.removeChannel(channel)
      channel = null
      lastStatus = 'connecting'
    }
  }

  return {
    mode: 'supabase',

    async list() {
      const { data, error } = await table().select('*').eq('board', boardId)
      if (error) throw explain(error, 'Could not load the board.')
      return (data || []).map(normalizeCard)
    },

    async create(patch) {
      const row = {
        ...pickWritable(patch),
        // Generated here rather than server-side so undo can restore a card
        // under its original id.
        id: patch.id || newId(),
        board: boardId,
      }

      const { data, error } = await table().insert(row).select().single()
      if (error) throw explain(error, 'Could not create the card.')
      return normalizeCard(data)
    },

    async update(id, patch) {
      const changes = pickWritable(patch)
      if (!Object.keys(changes).length) {
        // Nothing writable in the patch; re-read rather than issuing an
        // empty UPDATE, which PostgREST rejects.
        const { data, error } = await table().select('*').eq('id', id).single()
        if (error) throw explain(error, 'That card no longer exists.')
        return normalizeCard(data)
      }

      const { data, error } = await table().update(changes).eq('id', id).select().single()
      if (error) throw explain(error, 'Could not save the card.')
      if (!data) throw new Error('That card no longer exists.')
      return normalizeCard(data)
    },

    async remove(id) {
      const { error } = await table().delete().eq('id', id)
      // Deleting an absent row is not an error in Postgres, which matches the
      // contract's idempotency requirement.
      if (error) throw explain(error, 'Could not delete the card.')
    },

    async listPeople() {
      const { data, error } = await client.from(PEOPLE_TABLE).select('*').eq('board', boardId)
      if (error) throw explain(error, 'Could not load people.')
      return (data || []).map(normalizePerson).filter((p) => p.name)
    },

    async upsertPerson({ name }) {
      const trimmed = String(name || '').trim().slice(0, 60)
      if (!trimmed) throw new Error('Name is required.')
      const existing = (await this.listPeople()).find((p) => personKey(p.name) === personKey(trimmed))
      if (existing) return existing

      const { data, error } = await client
        .from(PEOPLE_TABLE)
        .insert({ id: newId(), name: trimmed, board: boardId })
        .select()
        .single()

      if (error && (error.code === '23505' || /duplicate/i.test(error.message || ''))) {
        const again = (await this.listPeople()).find((p) => personKey(p.name) === personKey(trimmed))
        if (again) return again
      }
      if (error) throw explain(error, 'Could not save your name.')
      return normalizePerson(data)
    },

    async listCanvas() {
      const { data, error } = await client.from(CANVAS_TABLE).select('*').eq('board', boardId)
      if (error) throw explain(error, 'Could not load the pad.')
      return (data || []).map(normalizeCanvasObject)
    },

    async createCanvasObject(patch) {
      const row = {
        ...pickCanvasWritable(patch),
        id: patch.id || newId(),
        board: boardId,
      }
      const { data, error } = await client.from(CANVAS_TABLE).insert(row).select().single()
      if (error) throw explain(error, 'Could not add that to the pad.')
      return normalizeCanvasObject(data)
    },

    async updateCanvasObject(id, patch) {
      const changes = pickCanvasWritable(patch)
      if (!Object.keys(changes).length) {
        const { data, error } = await client.from(CANVAS_TABLE).select('*').eq('id', id).single()
        if (error) throw explain(error, 'That object no longer exists.')
        return normalizeCanvasObject(data)
      }
      const { data, error } = await client.from(CANVAS_TABLE).update(changes).eq('id', id).select().single()
      if (error) throw explain(error, 'Could not save the pad.')
      if (!data) throw new Error('That object no longer exists.')
      return normalizeCanvasObject(data)
    },

    async removeCanvasObject(id) {
      const { error } = await client.from(CANVAS_TABLE).delete().eq('id', id)
      if (error) throw explain(error, 'Could not delete that.')
    },

    /**
     * Data changes. The handler gets no payload: the app re-lists on any
     * change. Applying individual events would mean tracking which of our own
     * writes have echoed back, for no benefit at this size.
     *
     * Connection status is deliberately NOT delivered here -- a subscriber
     * that reloads the board should not reload it because a socket said hello.
     * Use onStatus for that.
     */
    subscribe(handler) {
      listeners.add(handler)
      openChannel()
      return () => {
        listeners.delete(handler)
        closeChannelIfIdle()
      }
    },

    /** Realtime connection status: 'connecting' | 'live' | 'offline'. */
    onStatus(handler) {
      statusListeners.add(handler)
      handler(lastStatus)
      openChannel()
      return () => {
        statusListeners.delete(handler)
        closeChannelIfIdle()
      }
    },

    async close() {
      listeners.clear()
      statusListeners.clear()
      if (channel) {
        await client.removeChannel(channel)
        channel = null
      }
    },
  }
}
