import { describe, it, expect } from 'vitest'
import { normalizeSheet, SHEET_LIMITS, padToLine, offsetAtLine, indentSelection, nextLineCaret } from '../src/sheet-model.js'

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

describe('indentSelection', () => {
  it('indents the line the caret is on', () => {
    expect(indentSelection('hello', 2, 2)).toEqual({ text: '\thello', start: 3, end: 3 })
  })

  it('indents every line in a selection', () => {
    expect(indentSelection('a\nb\nc', 0, 3)).toEqual({ text: '\ta\n\tb\nc', start: 1, end: 5 })
  })

  it('does not indent the following line when the selection ends on a newline', () => {
    expect(indentSelection('a\nb\nc', 0, 2)).toEqual({ text: '\ta\nb\nc', start: 1, end: 3 })
  })
})

describe('nextLineCaret', () => {
  it('moves to the start of the next existing line', () => {
    expect(nextLineCaret('hello\nthere', 3)).toEqual({ text: 'hello\nthere', offset: 6 })
  })

  it('adds a blank line when already on the last row', () => {
    expect(nextLineCaret('hello', 5)).toEqual({ text: 'hello\n', offset: 6 })
  })
})
