import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSheetsView } from '../src/ui/sheets.js'
import { normalizeSheet } from '../src/sheet-model.js'
import { installShell, teardownShell } from './helpers/shell.js'
import { setCaretOffsets, plainText } from '../src/rich-text.js'

function key(target, name, opts = {}) {
  const ev = new KeyboardEvent('keydown', {
    key: name,
    code: name === 'Tab' ? 'Tab' : `Key${name.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  target.dispatchEvent(ev)
  return ev
}

function typeInto(el, next, inputType = 'insertText') {
  el.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }))
  el.textContent = next
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
}

describe('notepad undo', () => {
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
  })

  afterEach(() => {
    view?.destroy()
    teardownShell()
  })

  it('undoes an indent with Ctrl+Z and keeps focus in the page', () => {
    setCaretOffsets(body, 0, 0)
    key(body, 'Tab')
    expect(plainText(body)).toBe('\thello')
    const ev = key(body, 'z', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(plainText(body)).toBe('hello')
    expect(document.activeElement).toBe(body)
  })

  it('redoes with Ctrl+Shift+Z', () => {
    setCaretOffsets(body, 0, 0)
    key(body, 'Tab')
    key(body, 'z', { ctrlKey: true })
    key(body, 'z', { ctrlKey: true, shiftKey: true })
    expect(plainText(body)).toBe('\thello')
  })

  it('redoes with Ctrl+Y', () => {
    setCaretOffsets(body, 0, 0)
    key(body, 'Tab')
    key(body, 'z', { ctrlKey: true })
    key(body, 'y', { ctrlKey: true })
    expect(plainText(body)).toBe('\thello')
  })

  it('undoes typed text as one burst', () => {
    typeInto(body, 'hello!')
    typeInto(body, 'hello!!')
    key(body, 'z', { ctrlKey: true })
    expect(plainText(body)).toBe('hello')
  })
})
