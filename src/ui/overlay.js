/**
 * Focus management shared by the modal and the detail drawer.
 *
 * Both are overlays that take focus, must return it exactly where it came from
 * on close, and must not let Tab wander into the board behind them.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusableWithin(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

/**
 * Traps Tab inside `container` and calls `onClose` on Escape.
 * Returns a teardown that also restores focus to wherever it was.
 */
export function trapFocus(container, onClose) {
  const previous = document.activeElement

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return

    const items = focusableWithin(container)
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  container.addEventListener('keydown', onKeyDown)

  return function release({ restoreFocus = true } = {}) {
    container.removeEventListener('keydown', onKeyDown)
    // Only take focus back if it is still inside the overlay -- if the user
    // has already clicked elsewhere, stealing it would be worse than leaving it.
    if (restoreFocus && previous?.isConnected && container.contains(document.activeElement)) {
      previous.focus()
    }
  }
}
