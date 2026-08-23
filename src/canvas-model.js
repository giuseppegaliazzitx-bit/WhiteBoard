/**
 * Pad objects: stickies, text, strokes, images.
 *
 * Same job as normalizeCard -- rows arrive from localStorage, jsonb, and
 * realtime, so nothing downstream is allowed to assume a field is well typed.
 */
import { newId } from './model.js'

export const CANVAS_KINDS = ['sticky', 'text', 'stroke', 'image']

export const STICKY_COLORS = ['#f5e6a3', '#f7c4d4', '#c5dff0', '#c8e6c9', '#ffffff']
export const INK_COLORS = ['#14181f', '#d7263d', '#2f6df6', '#17936a', '#d68a12']

export const CANVAS_LIMITS = {
  text: 4000,
  points: 4000,
  imageChars: 700_000,
}

const STICKY_DEFAULT = STICKY_COLORS[0]
const INK_DEFAULT = INK_COLORS[0]

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

function num(value, fallback, min = -1e8, max = 1e8) {
  const n = toFiniteNumber(value)
  if (n === null) return fallback
  return Math.min(max, Math.max(min, n))
}

function maybeParse(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function isoOr(value) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return new Date(0).toISOString()
}

function isKind(id) {
  return CANVAS_KINDS.includes(id)
}

function clampInt(value, fallback, min, max) {
  const n = toFiniteNumber(value)
  if (n === null) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizePoints(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const x = toFiniteNumber(pair[0])
    const y = toFiniteNumber(pair[1])
    if (x === null || y === null) continue
    out.push([x, y])
    if (out.length >= CANVAS_LIMITS.points) break
  }
  return out
}

function normalizeData(kind, raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (kind === 'sticky') {
    return {
      text: str(src.text, CANVAS_LIMITS.text),
      color: STICKY_COLORS.includes(src.color) ? src.color : STICKY_DEFAULT,
      fontSize: clampInt(src.fontSize, 16, 12, 48),
    }
  }
  if (kind === 'text') {
    return {
      text: str(src.text, CANVAS_LIMITS.text),
      color: INK_COLORS.includes(src.color) ? src.color : INK_DEFAULT,
      fontSize: clampInt(src.fontSize, 24, 12, 96),
    }
  }
  if (kind === 'stroke') {
    return {
      points: normalizePoints(src.points),
      color: INK_COLORS.includes(src.color) ? src.color : INK_DEFAULT,
      size: clampInt(src.size, 4, 1, 40),
    }
  }
  // Images are data URLs only -- remote URLs would be an XSS hole on a
  // board anyone with the link can write to.
  const srcUrl = typeof src.src === 'string' && src.src.startsWith('data:image/')
    ? src.src.slice(0, CANVAS_LIMITS.imageChars)
    : ''
  return { src: srcUrl }
}

export function normalizeCanvasObject(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const kind = isKind(src.kind) ? src.kind : 'sticky'
  const w = num(src.w, kind === 'stroke' ? 0 : 220, 0, 8000)
  const h = num(src.h, kind === 'stroke' ? 0 : 220, 0, 8000)
  return {
    id: str(src.id, 64) || newId(),
    kind,
    x: num(src.x, 0),
    y: num(src.y, 0),
    w,
    h,
    z: clampInt(src.z, 0, 0, 1e9),
    data: normalizeData(kind, maybeParse(src.data)),
    board: str(src.board, 64) || 'main',
    created_at: isoOr(src.created_at),
    updated_at: isoOr(src.updated_at),
  }
}

export function nextZ(objects) {
  let max = 0
  for (const obj of objects) {
    if (obj.z > max) max = obj.z
  }
  return max + 1
}

export function brushSize(level) {
  return [2, 4, 6, 10, 16, 24][Math.min(5, Math.max(0, level - 1))]
}

export function fontSize(level) {
  return [14, 18, 24, 32, 40, 52][Math.min(5, Math.max(0, level - 1))]
}
