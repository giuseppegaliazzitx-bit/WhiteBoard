/**
 * The handful of mount points the UI modules look up by id.
 * Mirrors index.html; kept minimal so a markup change that breaks a module
 * shows up as a test failure rather than a silent null.
 */
export function installShell() {
  document.body.innerHTML = `
    <p id="progress"></p>
    <input id="search" type="search" />
    <button id="search-clear" hidden></button>
    <div id="people"></div>
    <button id="btn-new"></button>
    <button id="btn-identity"><span id="identity-avatar"></span><span id="identity-name"></span></button>
    <button id="btn-theme"></button>
    <span id="conn"><i class="conn__dot"></i><span class="conn__label"></span></span>
    <div id="filter-bar" hidden><div id="filter-chips"></div><button id="filter-clear"></button><span id="filter-count"></span></div>
    <button id="tab-board"></button>
    <button id="tab-whiteboard"></button>
    <button id="tab-notepad"></button>
    <div id="workspace">
      <main id="board"></main>
      <div id="pad" hidden></div>
      <div id="sheets" hidden></div>
    </div>
    <div id="detail-root"></div>
    <div id="modal-root"></div>
    <div id="toast-root"></div>
    <div id="live"></div>
    <div id="drag-layer"></div>
  `
  document.documentElement.dataset.theme = 'light'
}

export function teardownShell() {
  document.body.innerHTML = ''
}

/** Fires a click that bubbles, which is what delegated handlers expect. */
export function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** Sets a value and fires `input`, the way a real keystroke would. */
export function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function press(el, key, opts = {}) {
  return el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
}

/**
 * Finds a button inside `root` by its visible text.
 * Exact match wins; otherwise falls back to a substring match, because several
 * buttons wrap an avatar whose initials land in textContent ahead of the label.
 */
export function buttonWithText(root, text) {
  const wanted = text.trim().toLowerCase()
  const buttons = [...root.querySelectorAll('button')]
  const label = (b) => b.textContent.replace(/\s+/g, ' ').trim().toLowerCase()
  return buttons.find((b) => label(b) === wanted) || buttons.find((b) => label(b).includes(wanted))
}

/** Answers the currently-open confirm/prompt dialog. */
export function answerDialog(label) {
  const modal = document.querySelector('#modal-root .modal')
  if (!modal) throw new Error('No dialog is open')
  const btn = buttonWithText(modal, label)
  if (!btn) {
    const available = [...modal.querySelectorAll('button')].map((b) => b.textContent.trim())
    throw new Error(`No "${label}" button in dialog. Found: ${available.join(', ')}`)
  }
  click(btn)
}

export function dialogIsOpen() {
  return Boolean(document.querySelector('#modal-root .modal'))
}
