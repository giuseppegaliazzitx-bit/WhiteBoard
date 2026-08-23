/**
 * Lined notepad pages. Same trust-boundary idea as cards: anything that
 * arrived from storage or realtime is coerced before the UI sees it.
 */
import { newId } from './model.js'

export const SHEET_LIMITS = {
  title: 200,
  body: 100_000,
}

function str(value, max) {
  if (typeof value === 'string') return value.slice(0, max)
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, max)
  return ''
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isoOr(value) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return new Date(0).toISOString()
}

export function normalizeSheet(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const position = toFiniteNumber(src.position)
  return {
    id: str(src.id, 64) || newId(),
    title: str(src.title, SHEET_LIMITS.title),
    body: str(src.body, SHEET_LIMITS.body),
    position: position === null ? 1000 : position,
    board: str(src.board, 64) || 'main',
    created_at: isoOr(src.created_at),
    updated_at: isoOr(src.updated_at),
  }
}
