import { describe, it, expect } from 'vitest'
import { normalizeSheet, SHEET_LIMITS } from '../src/sheet-model.js'

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
