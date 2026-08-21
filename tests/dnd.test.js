import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDragController } from '../src/ui/dnd.js'
import { installShell, teardownShell } from './helpers/shell.js'
import { pointerEvent, stubRect } from './helpers/pointer.js'

/**
 * Board geometry used throughout. Two columns side by side; each card is 40px
 * tall starting at y=100, so card i spans [100 + 40i, 140 + 40i] and its
 * midpoint is at 120 + 40i.
 *
 *   problem column: x 0..200    idea column: x 200..400
 */
const CARD_H = 40
const TOP = 100
const midpointOf = (i) => TOP + CARD_H * i + CARD_H / 2

let root
let layer
let onMove
let controller

function buildBoard({ problem = ['a', 'b', 'c'], idea = ['d'] } = {}) {
  root = document.getElementById('board')
  layer = document.getElementById('drag-layer')

  const bodies = {}
  for (const [stage, ids, left] of [['problem', problem, 0], ['idea', idea, 200]]) {
    const column = document.createElement('section')
    column.className = 'column'
    const body = document.createElement('div')
    body.className = 'column__body'
    body.dataset.stage = stage

    ids.forEach((id, i) => {
      const card = document.createElement('button')
      card.className = 'card'
      card.dataset.id = id
      card.textContent = id
      stubRect(card, { top: TOP + CARD_H * i, left, width: 200, height: CARD_H })
      body.appendChild(card)
    })

    stubRect(body, { top: TOP, left, width: 200, height: 600 })
    stubRect(column, { top: 0, left, width: 200, height: 700 })
    column.appendChild(body)
    root.appendChild(column)
    bodies[stage] = body
  }

  stubRect(root, { top: 0, left: 0, width: 400, height: 700 })

  // Route hit-testing by x, the way the two columns are laid out above.
  document.elementsFromPoint = (x) => (x < 200 ? [bodies.problem] : [bodies.idea])

  return bodies
}

const cardEl = (id) => root.querySelector(`.card[data-id="${id}"]`)
const down = (el, opts) => el.dispatchEvent(pointerEvent('pointerdown', opts))
const move = (el, opts) => el.dispatchEvent(pointerEvent('pointermove', opts))
const up = (el, opts) => el.dispatchEvent(pointerEvent('pointerup', opts))

/** Grab card `id` and drop it at (x, y). */
function dragTo(id, x, y) {
  const el = cardEl(id)
  down(el, { x: 10, y: TOP + 10 })
  move(el, { x: 10, y: TOP + 40 }) // clear the threshold and begin the drag
  move(el, { x, y })
  up(el, { x, y })
}

beforeEach(() => {
  installShell()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  onMove = vi.fn()
})

afterEach(() => {
  controller?.destroy()
  controller = null
  vi.unstubAllGlobals()
  teardownShell()
})

function start(opts) {
  buildBoard(opts)
  controller = createDragController({ root, layer, onMove })
  return controller
}

describe('starting a drag', () => {
  it('does not start until the pointer has travelled far enough', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 12, y: 112 }) // 2.8px -- still a click

    expect(controller.isDragging).toBe(false)
    expect(el.classList.contains('is-ghost')).toBe(false)
    expect(layer.children).toHaveLength(0)
  })

  it('starts once the pointer clears the threshold', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })

    expect(controller.isDragging).toBe(true)
    expect(el.classList.contains('is-ghost')).toBe(true)
    expect(layer.querySelector('.card')).toBeTruthy()
  })

  it('hides the floating clone from assistive tech', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })

    const clone = layer.querySelector('.card')
    expect(clone.getAttribute('aria-hidden')).toBe('true')
    expect(clone.tabIndex).toBe(-1)
  })

  it('ignores the right mouse button', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110, button: 2 })
    move(el, { x: 10, y: 200 })
    expect(controller.isDragging).toBe(false)
  })

  it('ignores a pointerdown that is not on a card', () => {
    start()
    const body = root.querySelector('.column__body')
    down(body, { x: 10, y: 500 })
    move(body, { x: 10, y: 560 })
    expect(controller.isDragging).toBe(false)
  })
})

describe('drop position', () => {
  it('drops above a card when the pointer is past its midpoint', () => {
    start()
    dragTo('c', 10, midpointOf(0) - 5) // above card a's midpoint
    expect(onMove).toHaveBeenCalledWith('c', 'problem', 0)
  })

  it('drops between two cards', () => {
    start()
    // Dragging 'a' -- the remaining column is [b, c] at slots 0 and 1.
    // Aim below b's midpoint but above c's.
    dragTo('a', 10, midpointOf(1) + 5)
    expect(onMove).toHaveBeenCalledWith('a', 'problem', 1)
  })

  it('drops at the bottom when the pointer is below every card', () => {
    start()
    dragTo('a', 10, 600)
    expect(onMove).toHaveBeenCalledWith('a', 'problem', 2) // two cards remain
  })

  it('excludes the dragged card from the index, so a no-op drop stays put', () => {
    start()
    // 'a' is at slot 0; dropping it back above 'b' must be index 0, not 1.
    dragTo('a', 10, midpointOf(1) - 5)
    expect(onMove).toHaveBeenCalledWith('a', 'problem', 0)
  })

  it('drops into another column at the right index', () => {
    start()
    dragTo('a', 300, midpointOf(0) - 5) // above 'd' in the idea column
    expect(onMove).toHaveBeenCalledWith('a', 'idea', 0)
  })

  it('appends to an empty column', () => {
    start({ idea: [] })
    dragTo('a', 300, 400)
    expect(onMove).toHaveBeenCalledWith('a', 'idea', 0)
  })
})

describe('the drop indicator', () => {
  it('appears in the column under the pointer', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })
    move(el, { x: 300, y: 110 })

    const line = document.querySelector('.drop-line')
    expect(line).toBeTruthy()
    expect(line.closest('.column__body').dataset.stage).toBe('idea')
  })

  it('highlights the column being hovered and releases the previous one', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })
    expect(root.querySelectorAll('.is-dropzone')).toHaveLength(1)

    move(el, { x: 300, y: 140 })
    const zones = [...root.querySelectorAll('.is-dropzone')]
    expect(zones).toHaveLength(1)
    expect(zones[0].querySelector('.column__body').dataset.stage).toBe('idea')
  })

  it('is cleaned up after the drop', () => {
    start()
    dragTo('a', 10, 400)
    expect(document.querySelector('.drop-line')).toBeNull()
    expect(root.querySelector('.is-dropzone')).toBeNull()
    expect(layer.children).toHaveLength(0)
    expect(document.body.classList.contains('is-dragging')).toBe(false)
    expect(cardEl('a').classList.contains('is-ghost')).toBe(false)
  })
})

describe('cancelling', () => {
  it('abandons the move on Escape and leaves the card alone', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(onMove).not.toHaveBeenCalled()
    expect(controller.isDragging).toBe(false)
    expect(el.classList.contains('is-ghost')).toBe(false)
    expect(layer.children).toHaveLength(0)
  })

  it('abandons the move on pointercancel', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })
    el.dispatchEvent(pointerEvent('pointercancel', { x: 10, y: 140 }))

    expect(onMove).not.toHaveBeenCalled()
    expect(controller.isDragging).toBe(false)
    expect(document.body.classList.contains('is-dragging')).toBe(false)
  })

  it('calls onCancel when a started drag is abandoned', () => {
    buildBoard()
    const onCancel = vi.fn()
    controller = createDragController({ root, layer, onMove, onCancel })

    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })
    el.dispatchEvent(pointerEvent('pointercancel', { x: 10, y: 140 }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel for a plain click', () => {
    buildBoard()
    const onCancel = vi.fn()
    controller = createDragController({ root, layer, onMove, onCancel })

    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    up(el, { x: 10, y: 110 })

    expect(onCancel).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('clicks', () => {
  it('lets a plain click through so the card still opens', () => {
    start()
    const el = cardEl('a')
    const seen = vi.fn()
    document.body.addEventListener('click', seen)

    down(el, { x: 10, y: 110 })
    up(el, { x: 10, y: 110 })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(seen).toHaveBeenCalled()
    document.body.removeEventListener('click', seen)
  })

  it('only swallows one click, not every click after a drag', () => {
    start()
    const el = cardEl('a')
    const seen = vi.fn()
    document.body.addEventListener('click', seen)

    dragTo('a', 10, 400)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(seen).not.toHaveBeenCalled()

    // The next click is a real one and must get through.
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(seen).toHaveBeenCalledTimes(1)

    document.body.removeEventListener('click', seen)
  })

  it('swallows the click that a browser fires after a drop', () => {
    start()
    const el = cardEl('a')
    const seen = vi.fn()
    document.body.addEventListener('click', seen)

    dragTo('a', 10, 400)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(seen).not.toHaveBeenCalled()
    document.body.removeEventListener('click', seen)
  })
})

describe('dropping outside a column', () => {
  it('does not move the card', () => {
    start()
    // No column at these coordinates.
    document.elementsFromPoint = () => [document.body]

    const el = cardEl('a')
    down(el, { x: 10, y: 110 })
    move(el, { x: 10, y: 140 })
    move(el, { x: 900, y: 900 })
    up(el, { x: 900, y: 900 })

    expect(onMove).not.toHaveBeenCalled()
    expect(el.classList.contains('is-ghost')).toBe(false)
    expect(layer.children).toHaveLength(0)
  })
})

describe('touch', () => {
  const touch = { pointerType: 'touch' }

  it('does not drag on a short tap', () => {
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110, ...touch })
    up(el, { x: 10, y: 110, ...touch })
    expect(controller.isDragging).toBe(false)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('treats a swipe before the long press as a scroll, not a drag', async () => {
    vi.useFakeTimers()
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110, ...touch })
    move(el, { x: 10, y: 200, ...touch })

    await vi.advanceTimersByTimeAsync(400)
    expect(controller.isDragging).toBe(false)
    expect(onMove).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('starts dragging after a long press held still', async () => {
    vi.useFakeTimers()
    start()
    const el = cardEl('a')
    down(el, { x: 10, y: 110, ...touch })

    await vi.advanceTimersByTimeAsync(300)
    expect(controller.isDragging).toBe(true)

    move(el, { x: 300, y: midpointOf(0) - 5, ...touch })
    up(el, { x: 300, y: midpointOf(0) - 5, ...touch })
    expect(onMove).toHaveBeenCalledWith('a', 'idea', 0)
    vi.useRealTimers()
  })
})
