/**
 * Pointer event helpers.
 *
 * happy-dom has no PointerEvent constructor, and MouseEvent drops the
 * pointerId/pointerType fields, so those are assigned after construction.
 */
export function pointerEvent(type, { x = 0, y = 0, pointerId = 1, pointerType = 'mouse', button = 0 } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

/** Pins an element's layout box, since happy-dom reports every rect as zero. */
export function stubRect(el, { top, left = 0, width = 200, height = 40 }) {
  el.getBoundingClientRect = () => ({
    top, left, width, height,
    bottom: top + height,
    right: left + width,
    x: left, y: top,
    toJSON: () => {},
  })
}
