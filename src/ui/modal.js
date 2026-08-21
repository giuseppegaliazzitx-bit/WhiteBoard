import { h, clear } from './dom.js'
import { trapFocus } from './overlay.js'

/**
 * Modal dialogs.
 *
 * Both resolve a promise rather than taking callbacks, so calling code reads
 * top to bottom. `window.confirm` and `window.prompt` would have been shorter
 * but they block the event loop, cannot be styled, and are suppressed outright
 * in some embedded browsers -- which would silently break card deletion.
 */

function openModal(build) {
  const root = document.getElementById('modal-root')
  clear(root)

  return new Promise((resolve) => {
    let release = null
    let settled = false

    function close(value) {
      if (settled) return
      settled = true
      release?.()
      clear(root)
      resolve(value)
    }

    const panel = h('div', {
      class: 'modal',
      role: 'dialog',
      'aria-modal': 'true',
      // Clicks inside must not reach the scrim's dismiss handler.
      onclick: (e) => e.stopPropagation(),
    })

    const scrim = h('div', { class: 'modal-scrim', onclick: () => close(null) }, panel)

    const { focus } = build(panel, close)
    root.appendChild(scrim)
    release = trapFocus(scrim, () => close(null))
    focus?.focus()
    focus?.select?.()
  })
}

/** @returns {Promise<boolean>} */
export function confirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}) {
  return openModal((panel, close) => {
    const confirm = h('button', {
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      type: 'button',
      text: confirmLabel,
      onclick: () => close(true),
    })
    if (danger) confirm.style.borderColor = 'var(--danger)'

    panel.appendChild(h('h2', { text: title }))
    if (body) panel.appendChild(h('p', { text: body }))
    panel.appendChild(
      h(
        'div',
        { class: 'modal__foot' },
        h('button', { class: 'btn', type: 'button', text: cancelLabel, onclick: () => close(false) }),
        confirm,
      ),
    )

    // Focus the safe option: for a destructive dialog, Enter should not delete.
    return { focus: danger ? panel.querySelector('.btn') : confirm }
  }).then((v) => v === true)
}

/**
 * Text prompt. `validate` returns an error string to keep the dialog open,
 * or null/undefined to accept.
 *
 * `dismissible: false` only hides the Cancel button -- Escape and a scrim click
 * still resolve null. Deliberate: the first-run name prompt should not be a
 * trap, and its caller falls back to a default name instead.
 *
 * @returns {Promise<string|null>} null if dismissed
 */
export function promptDialog({
  title,
  body,
  label,
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  maxlength = 200,
  required = false,
  dismissible = true,
  validate,
}) {
  return openModal((panel, close) => {
    const error = h('p', { class: 'modal__error', role: 'alert' })
    const input = h('input', {
      class: 'input',
      type: 'text',
      value,
      placeholder,
      maxlength: String(maxlength),
      autocomplete: 'off',
      'aria-label': label || title,
    })

    function submit() {
      const text = input.value.trim()
      if (required && !text) {
        error.textContent = 'This cannot be empty.'
        input.focus()
        return
      }
      const problem = validate?.(text)
      if (problem) {
        error.textContent = problem
        input.focus()
        return
      }
      close(text)
    }

    input.addEventListener('input', () => {
      error.textContent = ''
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    })

    panel.appendChild(h('h2', { text: title }))
    if (body) panel.appendChild(h('p', { text: body }))
    if (label) panel.appendChild(h('label', { class: 'field__label', text: label }))
    panel.appendChild(input)
    panel.appendChild(error)
    panel.appendChild(
      h(
        'div',
        { class: 'modal__foot' },
        dismissible &&
          h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => close(null) }),
        h('button', { class: 'btn btn--primary', type: 'button', text: confirmLabel, onclick: submit }),
      ),
    )

    return { focus: input }
  })
}
