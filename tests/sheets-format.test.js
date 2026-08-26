import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSheetsView } from '../src/ui/sheets.js'
import { normalizeSheet } from '../src/sheet-model.js'
import { installShell, teardownShell } from './helpers/shell.js'
import { setCaretOffsets, plainText } from '../src/rich-text.js'

function key(target, name, opts = {}) {
  const ev = new KeyboardEvent('keydown', {
    key: name,
    code: `Key${name.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  target.dispatchEvent(ev)
  return ev
}

describe('notepad formatting', () => {
  let view
  let root
  let body

  beforeEach(() => {
    installShell()
    document.body.dataset.view = 'notepad'
    root = document.getElementById('sheets')
    root.hidden = false
    view = createSheetsView(root, {
      onCreate: vi.fn(),
      onPatch: vi.fn(async () => {}),
      onRemove: vi.fn(),
    })
    view.render([normalizeSheet({ id: 's1', title: 'Notes', body: 'hello' })], { selectId: 's1' })
    body = root.querySelector('.sheets__body')
    body.focus()
    setCaretOffsets(body, 0, 5)
  })

  afterEach(() => {
    view?.destroy()
    teardownShell()
  })

  it('shows a keymap for the format shortcuts', () => {
    const keys = root.querySelector('.sheets__keys')
    expect(keys.textContent).toMatch(/Bold/)
    expect(keys.textContent).toMatch(/Italic/)
    expect(keys.textContent).toMatch(/Underline/)
    expect(keys.textContent).toMatch(/Undo/)
  })

  it('bolds the selection with Ctrl+B and blocks the browser shortcut', () => {
    const ev = key(body, 'b', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(body.querySelector('b')?.textContent).toBe('hello')
    expect(plainText(body)).toBe('hello')
  })

  it('underlines with Ctrl+U', () => {
    const ev = key(body, 'u', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(body.querySelector('u')?.textContent).toBe('hello')
  })

  it('italicizes with Ctrl+I', () => {
    const ev = key(body, 'i', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(body.querySelector('i')?.textContent).toBe('hello')
  })

  it('undoes a format with Ctrl+Z', () => {
    key(body, 'b', { ctrlKey: true })
    expect(body.querySelector('b')).toBeTruthy()
    key(body, 'z', { ctrlKey: true })
    expect(body.querySelector('b')).toBeNull()
    expect(plainText(body)).toBe('hello')
  })
})
