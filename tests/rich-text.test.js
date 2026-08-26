import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  sanitizeHtml,
  serializeRich,
  setRich,
  plainText,
  setCaretOffsets,
  caretOffsets,
  toggleMark,
  formatFromKey,
} from '../src/rich-text.js'

describe('sanitizeHtml', () => {
  it('keeps bold italic underline and drops the rest', () => {
    const html = sanitizeHtml('<b>a</b><script>alert(1)</script><i>b</i><img src=x><u>c</u>')
    expect(html).toBe('<b>a</b><i>b</i><u>c</u>')
    expect(html).not.toMatch(/script|img/i)
  })

  it('leaves plain notes as plain text', () => {
    expect(sanitizeHtml('hello\nthere')).toBe('hello\nthere')
  })
})

describe('toggleMark', () => {
  let root

  beforeEach(() => {
    root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    root.textContent = 'hello'
    setCaretOffsets(root, 0, 5)
  })

  afterEach(() => {
    root.remove()
  })

  it('wraps the selection in bold', () => {
    toggleMark(root, 'bold')
    expect(root.querySelector('b')?.textContent).toBe('hello')
  })

  it('unwraps bold on a second toggle', () => {
    toggleMark(root, 'bold')
    toggleMark(root, 'bold')
    expect(root.querySelector('b')).toBeNull()
    expect(plainText(root)).toBe('hello')
  })

  it('underlines the selection', () => {
    toggleMark(root, 'underline')
    expect(root.querySelector('u')?.textContent).toBe('hello')
  })
})

describe('caretOffsets', () => {
  it('round-trips a caret in a text node', () => {
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    setRich(root, 'abc')
    setCaretOffsets(root, 2)
    expect(caretOffsets(root).start).toBe(2)
    expect(serializeRich(root)).toBe('abc')
    root.remove()
  })
})

describe('formatFromKey', () => {
  it('maps b i u', () => {
    expect(formatFromKey('b')).toBe('bold')
    expect(formatFromKey('I')).toBe('italic')
    expect(formatFromKey('u')).toBe('underline')
    expect(formatFromKey('z')).toBeNull()
  })
})
