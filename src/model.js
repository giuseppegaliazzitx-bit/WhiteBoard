/**
 * Domain model: stages, card shape, and the normalizer everything funnels through.
 *
 * `normalizeCard` is the single trust boundary. Rows arrive from three places
 * that can all be wrong -- localStorage written by an older build, a jsonb
 * column someone edited in the Supabase table view, and realtime payloads --
 * so nothing else in the app is allowed to assume a field has the right type.
 */

export const STAGES = [
  { id: 'problem',  name: 'Problem',     blurb: 'Something is wrong or in the way' },
  { id: 'idea',     name: 'Idea',        blurb: 'A proposal, not yet started' },
  { id: 'progress', name: 'In progress', blurb: 'Someone is actively on it' },
  { id: 'done',     name: 'Done',        blurb: 'Finished and verified' },
]

export const STAGE_IDS = STAGES.map((s) => s.id)
export const DEFAULT_STAGE = 'problem'
export const DONE_STAGE = 'done'

/** Field caps. Enforced here *and* as maxlength on inputs -- belt and braces,
 *  because a paste can exceed maxlength in some browsers and realtime rows
 *  never passed through our inputs at all. */
export const LIMITS = {
  title: 300,
  body: 5000,
  tag: 40,
  assignee: 60,
  note: 5000,
  assignees: 20,
  notes: 500,
}

export function isStage(id) {
  return STAGE_IDS.includes(id)
}

/** Always returns a stage object; unknown ids fall back to the first stage. */
export function getStage(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0]
}

export function stageIndex(id) {
  const i = STAGE_IDS.indexOf(id)
  return i === -1 ? 0 : i
}

/** Crypto-strong where available; the fallback only has to be collision-free
 *  enough for one browser session, since the server generates real uuids. */
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`
}

function str(value, max) {
  if (typeof value === 'string') return value.slice(0, max)
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, max)
  return ''
}

/** Case-insensitive identity for a person. "sam " and "Sam" are one person. */
export function personKey(name) {
  return String(name || '').trim().toLowerCase()
}

export function normalizeAssignees(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const name = str(raw, LIMITS.assignee).trim()
    if (!name) continue
    const key = personKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= LIMITS.assignees) break
  }
  return out
}

export function normalizeNote(value) {
  if (!value || typeof value !== 'object') return null
  const text = str(value.text, LIMITS.note).trim()
  if (!text) return null
  const at = typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at))
    ? value.at
    : new Date(0).toISOString()
  return {
    id: str(value.id, 64) || newId(),
    author: str(value.author, LIMITS.assignee).trim() || 'Anonymous',
    text,
    at,
  }
}

export function normalizeNotes(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value) {
    const note = normalizeNote(raw)
    if (note) out.push(note)
    if (out.length >= LIMITS.notes) break
  }
  // Oldest first. Two notes written in the same millisecond keep insertion order.
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/**
 * Coerce anything card-shaped into a valid card. Never throws.
 * jsonb columns can arrive as strings if a client wrote them wrong, so
 * assignees/notes get a JSON.parse attempt before being given up on.
 */
export function normalizeCard(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const position = toFiniteNumber(src.position)
  return {
    id: str(src.id, 64) || newId(),
    title: str(src.title, LIMITS.title),
    body: str(src.body, LIMITS.body),
    status: isStage(src.status) ? src.status : DEFAULT_STAGE,
    tag: str(src.tag, LIMITS.tag).trim(),
    assignees: normalizeAssignees(maybeParse(src.assignees)),
    notes: normalizeNotes(maybeParse(src.notes)),
    position: position === null ? 1000 : position,
    board: str(src.board, 64) || 'main',
    created_at: isoOr(src.created_at),
    updated_at: isoOr(src.updated_at),
  }
}

/**
 * Strict numeric coercion. Plain `Number()` is unusable here: Number(null),
 * Number('') and Number([]) are all 0, which is a *valid* position -- so a row
 * with a null position column would silently pin itself to the top of its
 * column instead of taking the default.
 */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function maybeParse(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return []
  }
}

function isoOr(value) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return new Date(0).toISOString()
}

export function makeNote(author, text) {
  return {
    id: newId(),
    author: String(author || '').trim().slice(0, LIMITS.assignee) || 'Anonymous',
    text: String(text || '').trim().slice(0, LIMITS.note),
    at: new Date().toISOString(),
  }
}

/** "Sam Rivera" -> SR, "sam" -> SA, "" -> ?. Handles emoji/CJK via spread. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) {
    const chars = [...words[0]]
    return (chars[0] + (chars[1] || '')).toUpperCase()
  }
  return ([...words[0]][0] + [...words[words.length - 1]][0]).toUpperCase()
}

/**
 * Deterministic colour per person. Same name is the same colour for everyone
 * on the board, which is the whole point -- avatars are only useful if they
 * are stable across browsers. Lightness is pinned low enough that white text
 * clears 4.5:1 on every hue.
 */
export function avatarColor(name) {
  const key = personKey(name)
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  // Yellow-greens read lighter at equal L, so darken that arc a little.
  const isBright = hue > 40 && hue < 200
  return `hsl(${hue} 52% ${isBright ? 34 : 42}%)`
}
