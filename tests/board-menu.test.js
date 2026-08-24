import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBoardView } from '../src/ui/board.js'
import { normalizeCard, STAGES } from '../src/model.js'
import { installShell, teardownShell, click, buttonWithText } from './helpers/shell.js'

function cardsByStage(list) {
  const map = new Map(STAGES.map((s) => [s.id, []]))
  for (const card of list) map.get(card.status).push(card)
  return map
}

function rightClick(el, opts = {}) {
  const ev = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: opts.x ?? 40,
    clientY: opts.y ?? 40,
    button: 2,
  })
  el.dispatchEvent(ev)
  return ev
}

describe('board context menu', () => {
  let view
  let onMoveTo
  let onDelete

  beforeEach(() => {
    installShell()
    onMoveTo = vi.fn()
    onDelete = vi.fn()
    view = createBoardView(document.getElementById('board'), {
      onOpen: vi.fn(),
      onAdd: vi.fn(),
      onMoveTo,
      onDelete,
    })
    view.render(
      cardsByStage([
        normalizeCard({ id: 'a', title: 'Fix export', status: 'problem', updated_at: new Date().toISOString() }),
        normalizeCard({ id: 'b', title: 'Ship it', status: 'idea', updated_at: new Date().toISOString() }),
      ]),
    )
  })

  afterEach(() => {
    view?.destroy()
    teardownShell()
  })

  it('blocks the browser menu on a card and offers stages plus Delete', () => {
    const ev = rightClick(document.querySelector('.card'))
    expect(ev.defaultPrevented).toBe(true)
    const menu = document.querySelector('.ctx-menu')
    expect(menu.hidden).toBe(false)
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim())).toEqual([
      'Problem',
      'Idea',
      'In progress',
      'Done',
      'Delete',
    ])
  })

  it('blocks the browser menu on empty board space without opening a card menu', () => {
    const ev = rightClick(document.querySelector('.column__body[data-stage="done"]'))
    expect(ev.defaultPrevented).toBe(true)
    expect(document.querySelector('.ctx-menu').hidden).toBe(true)
  })

  it('moves the card to the chosen stage', () => {
    rightClick(document.querySelector('.card'))
    click(buttonWithText(document.querySelector('.ctx-menu'), 'Done'))
    expect(onMoveTo).toHaveBeenCalledWith('a', 'done')
    expect(document.querySelector('.ctx-menu').hidden).toBe(true)
  })

  it('does not move when the current stage is chosen', () => {
    rightClick(document.querySelector('.card'))
    click(buttonWithText(document.querySelector('.ctx-menu'), 'Problem'))
    expect(onMoveTo).not.toHaveBeenCalled()
  })

  it('deletes from the menu', () => {
    rightClick(document.querySelector('.card'))
    click(buttonWithText(document.querySelector('.ctx-menu'), 'Delete'))
    expect(onDelete).toHaveBeenCalledWith('a')
  })

  it('blocks the browser menu when right-clicking the menu itself', () => {
    rightClick(document.querySelector('.card'))
    const ev = rightClick(document.querySelector('.ctx-menu'))
    expect(ev.defaultPrevented).toBe(true)
    expect(document.querySelector('.ctx-menu').hidden).toBe(false)
  })
})
