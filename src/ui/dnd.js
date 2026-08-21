/**
 * Card dragging, on Pointer Events.
 *
 * Not the HTML5 drag-and-drop API: that fires no events on touch at all, has
 * an unstyleable drag image, and cannot express "insert between these two
 * cards" without a lot of dragover bookkeeping. Pointer Events cover mouse,
 * pen and touch through one code path.
 *
 * Touch is best-effort. A long press starts a drag, but if the browser has
 * already claimed the gesture for scrolling it sends pointercancel and the
 * drag aborts. That is why the detail panel's stage buttons exist -- they are
 * the reliable way to move a card on a phone.
 */

/** Pointer travel before a mouse drag begins. Below this it is a click. */
const DRAG_THRESHOLD = 5
/** Hold time before a touch drag begins. */
const LONG_PRESS_MS = 260
/** Distance from a scrollable edge that starts auto-scrolling. */
const EDGE = 64
const EDGE_SPEED = 14

/** How long after a drop a synthetic click is still attributed to that drop. */
const CLICK_SUPPRESS_MS = 350

export function createDragController({ root, layer, onMove, onCancel }) {
  let drag = null
  let scrollRaf = null
  let suppressClickUntil = 0

  // ------------------------------------------------------------- geometry

  function columnUnder(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      const body = el.closest?.('.column__body')
      if (body) return body
    }
    return null
  }

  /**
   * Where the card would land in `body`, ignoring the card being dragged.
   * A card belongs above the pointer if the pointer is past its midpoint.
   */
  function indexIn(body, y) {
    const cards = [...body.querySelectorAll('.card')].filter((c) => c !== drag.ghost)
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect()
      if (y < rect.top + rect.height / 2) return { index: i, before: cards[i] }
    }
    return { index: cards.length, before: null }
  }

  function showLine(body, before) {
    const line = drag.line
    if (before) body.insertBefore(line, before)
    else body.appendChild(line)
  }

  // ------------------------------------------------------------- autoscroll

  function autoScroll() {
    scrollRaf = null
    if (!drag?.active) return

    const { x, y } = drag.pointer

    // Vertical, within the hovered column.
    const body = drag.overBody
    if (body) {
      const r = body.getBoundingClientRect()
      if (y < r.top + EDGE) body.scrollTop -= EDGE_SPEED
      else if (y > r.bottom - EDGE) body.scrollTop += EDGE_SPEED
    }

    // Horizontal, across the board.
    const r = root.getBoundingClientRect()
    if (x < r.left + EDGE) root.scrollLeft -= EDGE_SPEED
    else if (x > r.right - EDGE) root.scrollLeft += EDGE_SPEED

    queueScroll()
  }

  function queueScroll() {
    if (!scrollRaf && drag?.active) scrollRaf = requestAnimationFrame(autoScroll)
  }

  // ------------------------------------------------------------- lifecycle

  function begin() {
    const { source } = drag
    const rect = source.getBoundingClientRect()

    const clone = source.cloneNode(true)
    clone.classList.remove('is-flash')
    clone.style.width = `${rect.width}px`
    clone.removeAttribute('id')
    // The clone must never be reachable -- it is decoration, and a duplicate
    // of a real button would otherwise show up twice to a screen reader.
    clone.setAttribute('aria-hidden', 'true')
    clone.tabIndex = -1

    drag.clone = clone
    drag.grabX = drag.start.x - rect.left
    drag.grabY = drag.start.y - rect.top
    drag.ghost = source
    drag.active = true

    const line = document.createElement('div')
    line.className = 'drop-line'
    drag.line = line

    layer.appendChild(clone)
    source.classList.add('is-ghost')
    document.body.classList.add('is-dragging')
    moveClone()
    update()
  }

  function moveClone() {
    drag.clone.style.left = `${drag.pointer.x - drag.grabX}px`
    drag.clone.style.top = `${drag.pointer.y - drag.grabY}px`
  }

  function update() {
    const { x, y } = drag.pointer
    // The clone sits under the pointer; hide it so elementsFromPoint sees the board.
    drag.clone.style.visibility = 'hidden'
    const body = columnUnder(x, y)
    drag.clone.style.visibility = ''

    if (drag.overBody && drag.overBody !== body) {
      drag.overBody.closest('.column')?.classList.remove('is-dropzone')
    }
    drag.overBody = body

    if (!body) {
      drag.line.remove()
      drag.target = null
      return
    }

    body.closest('.column')?.classList.add('is-dropzone')
    const { index, before } = indexIn(body, y)
    showLine(body, before)
    drag.target = { status: body.dataset.stage, index }
  }

  function finish(commit) {
    if (!drag) return
    const { active, source, target, clone, line, overBody } = drag
    const id = source.dataset.id

    if (scrollRaf) cancelAnimationFrame(scrollRaf)
    scrollRaf = null

    if (active) {
      clone?.remove()
      line?.remove()
      source.classList.remove('is-ghost')
      overBody?.closest('.column')?.classList.remove('is-dropzone')
      document.body.classList.remove('is-dragging')
    }

    const moved = active
    drag = null

    if (moved && commit && target) onMove(id, target.status, target.index)
    else if (moved) onCancel?.()

    return moved
  }

  // ------------------------------------------------------------- events

  function onPointerDown(e) {
    // Primary button only, and never start a drag from inside a form control.
    if (e.button !== 0 || drag) return
    const source = e.target.closest?.('.card')
    if (!source || !root.contains(source)) return

    drag = {
      source,
      pointerId: e.pointerId,
      touch: e.pointerType === 'touch',
      start: { x: e.clientX, y: e.clientY },
      pointer: { x: e.clientX, y: e.clientY },
      active: false,
      moved: false,
      timer: null,
      overBody: null,
      target: null,
    }

    // Capture on the source so we keep receiving moves even off the element.
    source.setPointerCapture?.(e.pointerId)

    if (drag.touch) {
      drag.timer = setTimeout(() => {
        if (drag && !drag.active) {
          begin()
          queueScroll()
        }
      }, LONG_PRESS_MS)
    }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return

    drag.pointer = { x: e.clientX, y: e.clientY }
    const dx = e.clientX - drag.start.x
    const dy = e.clientY - drag.start.y
    const far = Math.hypot(dx, dy) > DRAG_THRESHOLD

    if (!drag.active) {
      if (far) drag.moved = true
      // A touch that moves before the long press is a scroll, not a drag.
      if (drag.touch) {
        if (far && drag.timer) {
          clearTimeout(drag.timer)
          drag.timer = null
          drag = null
        }
        return
      }
      if (!far) return
      begin()
      queueScroll()
    }

    // Stops the browser turning the drag into a text selection or a pan.
    if (e.cancelable) e.preventDefault()
    moveClone()
    update()
    queueScroll()
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (drag.timer) clearTimeout(drag.timer)

    // Arm the click suppressor: the browser fires a click right after a drag,
    // and without this, dropping a card would also open it.
    if (finish(true)) suppressClickUntil = now() + CLICK_SUPPRESS_MS
  }

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  /**
   * One permanent capture-phase listener rather than a one-shot armed per drop.
   * A one-shot leaks whenever no click follows -- a touch drop, or a drop
   * outside any column -- and then swallows an unrelated click much later.
   */
  function onClickCapture(e) {
    if (!suppressClickUntil) return
    const expired = now() >= suppressClickUntil
    suppressClickUntil = 0
    if (expired) return
    e.stopImmediatePropagation()
    e.preventDefault()
  }

  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (drag.timer) clearTimeout(drag.timer)
    finish(false)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && drag?.active) {
      e.preventDefault()
      finish(false)
    }
  }

  document.addEventListener('click', onClickCapture, true)
  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('pointerup', onPointerUp)
  root.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onKeyDown)
  // A drag in flight when the tab is hidden should not survive to the return.
  window.addEventListener('blur', () => finish(false))

  return {
    get isDragging() {
      return Boolean(drag?.active)
    },
    cancel: () => finish(false),
    destroy() {
      finish(false)
      document.removeEventListener('click', onClickCapture, true)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
    },
  }
}
