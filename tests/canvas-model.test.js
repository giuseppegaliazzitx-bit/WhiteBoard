import { describe, it, expect } from 'vitest'
import {
  normalizeCanvasObject,
  nextZ,
  brushSize,
  fontSize,
  STICKY_COLORS,
  CANVAS_LIMITS,
  objectsInRect,
} from '../src/canvas-model.js'

describe('normalizeCanvasObject', () => {
  it('defaults a blank row to a sticky', () => {
    const obj = normalizeCanvasObject({})
    expect(obj.kind).toBe('sticky')
    expect(obj.x).toBe(0)
    expect(obj.data.color).toBe(STICKY_COLORS[0])
    expect(obj.data.text).toBe('')
  })

  it('keeps a text object', () => {
    const obj = normalizeCanvasObject({ kind: 'text', x: 12, y: 8, data: { text: 'Hi', fontSize: 32, color: '#14181f' } })
    expect(obj.kind).toBe('text')
    expect(obj.data.text).toBe('Hi')
    expect(obj.data.fontSize).toBe(32)
  })

  it('rejects a remote image URL', () => {
    const obj = normalizeCanvasObject({ kind: 'image', data: { src: 'https://evil.example/x.png' } })
    expect(obj.data.src).toBe('')
  })

  it('keeps a data-URL image', () => {
    const src = 'data:image/png;base64,aaa'
    expect(normalizeCanvasObject({ kind: 'image', data: { src } }).data.src).toBe(src)
  })

  it('drops non-finite positions', () => {
    const obj = normalizeCanvasObject({ x: Infinity, y: 'nope', w: -4 })
    expect(obj.x).toBe(0)
    expect(obj.y).toBe(0)
    expect(obj.w).toBe(0)
  })

  it('parses jsonb that arrived as a string', () => {
    const obj = normalizeCanvasObject({ kind: 'sticky', data: '{"text":"ok","color":"#f5e6a3"}' })
    expect(obj.data.text).toBe('ok')
  })

  it('caps sticky text', () => {
    const obj = normalizeCanvasObject({ kind: 'sticky', data: { text: 'x'.repeat(99999) } })
    expect(obj.data.text).toHaveLength(CANVAS_LIMITS.text)
  })

  it('keeps stroke points that look like pairs', () => {
    const obj = normalizeCanvasObject({
      kind: 'stroke',
      data: { points: [[0, 0], [10, 4], 'nope', [1]], size: 6, color: '#d7263d' },
    })
    expect(obj.data.points).toEqual([[0, 0], [10, 4]])
    expect(obj.data.size).toBe(6)
  })

  it('keeps an arrow', () => {
    const obj = normalizeCanvasObject({
      kind: 'arrow',
      x: 0,
      y: 0,
      w: 40,
      h: 10,
      data: { x1: 0, y1: 5, x2: 40, y2: 5, color: '#2f6df6', size: 4 },
    })
    expect(obj.kind).toBe('arrow')
    expect(obj.data.x2).toBe(40)
    expect(obj.data.color).toBe('#2f6df6')
  })
})

describe('objectsInRect', () => {
  it('returns objects whose boxes overlap the marquee', () => {
    const a = normalizeCanvasObject({ id: 'a', kind: 'sticky', x: 0, y: 0, w: 50, h: 50 })
    const b = normalizeCanvasObject({ id: 'b', kind: 'sticky', x: 200, y: 200, w: 50, h: 50 })
    expect(objectsInRect([a, b], { x: 10, y: 10, w: 20, h: 20 }).map((o) => o.id)).toEqual(['a'])
    expect(objectsInRect([a, b], { x: 0, y: 0, w: 400, h: 400 })).toHaveLength(2)
  })
})

describe('nextZ', () => {
  it('is 1 on an empty pad', () => {
    expect(nextZ([])).toBe(1)
  })

  it('is one past the current max', () => {
    expect(nextZ([{ z: 2 }, { z: 7 }, { z: 3 }])).toBe(8)
  })
})

describe('size ramps', () => {
  it('maps 1–6 onto brush and font sizes', () => {
    expect(brushSize(1)).toBe(2)
    expect(brushSize(6)).toBe(24)
    expect(fontSize(3)).toBe(24)
    expect(brushSize(99)).toBe(24)
  })
})
