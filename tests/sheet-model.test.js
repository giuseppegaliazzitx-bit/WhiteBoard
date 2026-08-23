import { describe, it, expect } from 'vitest'
import { normalizeSheet, SHEET_LIMITS, padToLine, offsetAtLine } from '../src/sheet-model.js'

describe('normalizeSheet', () => {
  it('fills defaults', () => {
    const sheet = normalizeSheet({})
    expect(sheet.title).toBe('')
    expect(sheet.body).toBe('')
    expect(sheet.position).toBe(1000)
    expect(sheet.id).toBeTruthy()
  })

  it('keeps title and body', () => {
    const sheet = normalizeSheet({ title: 'Notes', body: 'hello', position: 2000 })
    expect(sheet.title).toBe('Notes')
    expect(sheet.body).toBe('hello')
    expect(sheet.position).toBe(2000)
  })

  it('caps oversized fields', () => {
    expect(normalizeSheet({ title: 'x'.repeat(999) }).title).toHaveLength(SHEET_LIMITS.title)
  })
})

describe('padToLine', () => {
  it('leaves text alone when the line already exists', () => {
    expect(padToLine('a\nb', 1)).toBe('a\nb')
  })

  it('adds blank lines so a later row can be typed on', () => {
    expect(padToLine('hi', 3)).toBe('hi\n\n\n')
    expect(padToLine('', 2).split('\n')).toHaveLength(3)
  })
})

describe('offsetAtLine', () => {
  it('is 0 on the first line', () => {
    expect(offsetAtLine('hello\nthere', 0)).toBe(0)
  })

  it('skips previous lines and their newlines', () => {
    expect(offsetAtLine('hi\nthere', 1)).toBe(3)
  })
})
