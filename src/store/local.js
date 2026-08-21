/**
 * localStorage adapter.
 *
 * Not shared between people -- it exists so the board is fully usable with a
 * blank .env, and so phases 1-4 were testable before Supabase existed. It does
 * sync across tabs in the same browser via the `storage` event, which makes it
 * a decent stand-in for realtime while developing.
 */
import { normalizeCard, newId } from '../model.js'

const KEY = 'board:cards:v1'

export function createLocalStore({ boardId = 'main' } = {}) {
  const listeners = new Set()

  function readAll() {
    let raw
    try {
      raw = localStorage.getItem(KEY)
    } catch {
      return [] // private mode / storage disabled
    }
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(normalizeCard) : []
    } catch {
      // Corrupt payload. Better to start empty than to wedge the whole board.
      return []
    }
  }

  function writeAll(cards) {
    try {
      localStorage.setItem(KEY, JSON.stringify(cards))
    } catch (err) {
      const quota = err && (err.name === 'QuotaExceededError' || err.code === 22)
      throw new Error(
        quota
          ? 'Browser storage is full. Delete some cards, or connect Supabase.'
          : 'Could not save to browser storage.',
      )
    }
  }

  // Other tabs of the same browser fire `storage`; same-tab writes do not.
  const onStorage = (e) => {
    if (e.key === KEY) emit()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  function emit() {
    for (const fn of listeners) {
      try { fn() } catch (err) { console.error('store listener failed', err) }
    }
  }

  return {
    mode: 'local',

    async list() {
      return readAll().filter((c) => c.board === boardId)
    },

    async create(patch) {
      const now = new Date().toISOString()
      const card = normalizeCard({
        ...patch,
        id: patch.id || newId(),
        board: boardId,
        created_at: now,
        updated_at: now,
      })
      writeAll([...readAll(), card])
      return card
    },

    async update(id, patch) {
      const all = readAll()
      const i = all.findIndex((c) => c.id === id)
      if (i === -1) throw new Error('That card no longer exists.')
      // id/board/created_at are not client-editable.
      const { id: _i, board: _b, created_at: _c, ...safe } = patch
      const next = normalizeCard({ ...all[i], ...safe, updated_at: new Date().toISOString() })
      all[i] = next
      writeAll(all)
      return next
    },

    async remove(id) {
      const all = readAll()
      const next = all.filter((c) => c.id !== id)
      if (next.length !== all.length) writeAll(next)
    },

    subscribe(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },

    /** Same surface as the Supabase adapter; there is no socket to report on. */
    onStatus(handler) {
      handler('local')
      return () => {}
    },

    async close() {
      listeners.clear()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    },
  }
}
