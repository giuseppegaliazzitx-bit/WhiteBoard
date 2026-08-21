import { h, icon } from './dom.js'

const DEFAULT_MS = 4500
let root = null

function mount() {
  if (!root) root = document.getElementById('toast-root')
  return root
}

/**
 * Transient message, optionally with one action (used for undo-delete).
 * Returns a dismiss function so a caller can retract its own toast.
 */
export function toast(message, opts = {}) {
  const host = mount()
  if (!host) return () => {}

  const { kind = 'info', actionLabel, onAction, duration = DEFAULT_MS } = opts
  let timer = null

  const node = h(
    'div',
    { class: 'toast', dataset: { kind }, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { text: message }),
    actionLabel &&
      h('button', {
        class: 'toast__action',
        type: 'button',
        text: actionLabel,
        onclick: () => {
          dismiss()
          onAction?.()
        },
      }),
    h(
      'button',
      { class: 'toast__action', type: 'button', 'aria-label': 'Dismiss', onclick: () => dismiss() },
      icon('x'),
    ),
  )

  function dismiss() {
    if (timer) clearTimeout(timer)
    node.remove()
  }

  // An actionable toast waits longer -- undo is useless if it vanishes first.
  const ms = actionLabel ? Math.max(duration, 7000) : duration
  if (ms > 0) timer = setTimeout(dismiss, ms)

  // Hovering pauses the countdown so a long message stays readable.
  node.addEventListener('mouseenter', () => timer && clearTimeout(timer))
  node.addEventListener('mouseleave', () => {
    if (ms > 0) timer = setTimeout(dismiss, 2000)
  })

  host.appendChild(node)
  return dismiss
}

export function errorToast(err, fallback = 'Something went wrong.') {
  const message = err instanceof Error ? err.message : String(err || '')
  return toast(message || fallback, { kind: 'error', duration: 7000 })
}
