import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSheetsView } from '../src/ui/sheets.js'
import { normalizeSheet } from '../src/sheet-model.js'
import { installShell, teardownShell } from './helpers/shell.js'

function tab(target, { shift = false } = {}) {
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
    code: 'Tab',
    keyCode: 9,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(ev)
  return ev
}

describe('notepad Tab', () => {
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

  it('keeps Tab on the page and indents the current line', () => {
    body.setSelectionRange(0, 0)
    const ev = tab(body)
    expect(ev.defaultPrevented).toBe(true)
    expect(body.value).toBe('\thello')
    expect(document.activeElement).toBe(body)
  })

  it('moves to the next line on Shift+Tab', () => {
    body.setSelectionRange(5, 5)
    const ev = tab(body, { shift: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(body.value).toBe('hello\n')
    expect(body.selectionStart).toBe(6)
    expect(document.activeElement).toBe(body)
  })

  it('does not steal Tab while another view is showing', () => {
    document.body.dataset.view = 'board'
    root.hidden = true
    body.value = 'hello'
    const ev = tab(body)
    expect(ev.defaultPrevented).toBe(false)
    expect(body.value).toBe('hello')
  })
})
