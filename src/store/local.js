/**
 * localStorage adapter.
 *
 * Not shared between people -- it exists so the board is fully usable with a
 * blank .env, and so phases 1-4 were testable before Supabase existed. It does
 * sync across tabs in the same browser via the `storage` event, which makes it
 * a decent stand-in for realtime while developing.
 */
import { normalizeCard, normalizePerson, newId, personKey } from '../model.js'
import { normalizeCanvasObject } from '../canvas-model.js'
import { normalizeSheet } from '../sheet-model.js'

const CARDS_KEY = 'board:cards:v1'
const PEOPLE_KEY = 'board:people:v1'
const CANVAS_KEY = 'board:canvas:v1'
const SHEETS_KEY = 'board:sheets:v1'

function readJsonList(key, normalize) {
  let raw
  try {
    raw = localStorage.getItem(key)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalize) : []
  } catch {
    return []
  }
}

function writeJsonList(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch (err) {
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22)
    throw new Error(
      quota
        ? 'Browser storage is full. Delete some cards, or connect Supabase.'
        : 'Could not save to browser storage.',
    )
  }
}

export function createLocalStore({ boardId = 'main' } = {}) {
  const listeners = new Set()

  function readCards() {
    return readJsonList(CARDS_KEY, normalizeCard)
  }
  function writeCards(cards) {
    writeJsonList(CARDS_KEY, cards)
  }
  function readPeople() {
    return readJsonList(PEOPLE_KEY, normalizePerson)
  }
  function writePeople(people) {
    writeJsonList(PEOPLE_KEY, people)
  }
  function readCanvas() {
    return readJsonList(CANVAS_KEY, normalizeCanvasObject)
  }
  function writeCanvas(objects) {
    writeJsonList(CANVAS_KEY, objects)
  }
  function readSheets() {
    return readJsonList(SHEETS_KEY, normalizeSheet)
  }
  function writeSheets(items) {
    writeJsonList(SHEETS_KEY, items)
  }

  const onStorage = (e) => {
    if (e.key === CARDS_KEY || e.key === PEOPLE_KEY || e.key === CANVAS_KEY || e.key === SHEETS_KEY) emit()
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
      return readCards().filter((c) => c.board === boardId)
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
      writeCards([...readCards(), card])
      return card
    },

    async update(id, patch) {
      const all = readCards()
      const i = all.findIndex((c) => c.id === id)
      if (i === -1) throw new Error('That card no longer exists.')
      const { id: _i, board: _b, created_at: _c, ...safe } = patch
      const next = normalizeCard({ ...all[i], ...safe, updated_at: new Date().toISOString() })
      all[i] = next
      writeCards(all)
      return next
    },

    async remove(id) {
      const all = readCards()
      const next = all.filter((c) => c.id !== id)
      if (next.length !== all.length) writeCards(next)
    },

    async listPeople() {
      return readPeople().filter((p) => p.board === boardId && p.name)
    },

    async upsertPerson({ name }) {
      const trimmed = String(name || '').trim().slice(0, 60)
      if (!trimmed) throw new Error('Name is required.')
      const all = readPeople()
      const key = personKey(trimmed)
      const existing = all.find((p) => p.board === boardId && personKey(p.name) === key)
      if (existing) return existing
      const now = new Date().toISOString()
      const person = normalizePerson({
        id: newId(),
        name: trimmed,
        board: boardId,
        created_at: now,
        updated_at: now,
      })
      writePeople([...all, person])
      return person
    },

    async listCanvas() {
      return readCanvas().filter((o) => o.board === boardId)
    },

    async createCanvasObject(patch) {
      const now = new Date().toISOString()
      const obj = normalizeCanvasObject({
        ...patch,
        id: patch.id || newId(),
        board: boardId,
        created_at: now,
        updated_at: now,
      })
      writeCanvas([...readCanvas(), obj])
      return obj
    },

    async updateCanvasObject(id, patch) {
      const all = readCanvas()
      const i = all.findIndex((o) => o.id === id)
      if (i === -1) throw new Error('That object no longer exists.')
      const { id: _i, board: _b, created_at: _c, ...safe } = patch
      const next = normalizeCanvasObject({ ...all[i], ...safe, updated_at: new Date().toISOString() })
      all[i] = next
      writeCanvas(all)
      return next
    },

    async removeCanvasObject(id) {
      const all = readCanvas()
      const next = all.filter((o) => o.id !== id)
      if (next.length !== all.length) writeCanvas(next)
    },

    async listSheets() {
      return readSheets().filter((s) => s.board === boardId)
    },

    async createSheet(patch) {
      const now = new Date().toISOString()
      const sheet = normalizeSheet({
        ...patch,
        id: patch.id || newId(),
        board: boardId,
        created_at: now,
        updated_at: now,
      })
      writeSheets([...readSheets(), sheet])
      return sheet
    },

    async updateSheet(id, patch) {
      const all = readSheets()
      const i = all.findIndex((s) => s.id === id)
      if (i === -1) throw new Error('That sheet no longer exists.')
      const { id: _i, board: _b, created_at: _c, ...safe } = patch
      const next = normalizeSheet({ ...all[i], ...safe, updated_at: new Date().toISOString() })
      all[i] = next
      writeSheets(all)
      return next
    },

    async removeSheet(id) {
      const all = readSheets()
      const next = all.filter((s) => s.id !== id)
      if (next.length !== all.length) writeSheets(next)
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
