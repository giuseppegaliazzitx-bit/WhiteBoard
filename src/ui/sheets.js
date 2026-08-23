/**
 * Lined notepad pages. A list of titled sheets, one open at a time.
 */
import { h, clear, icon } from './dom.js'
import { fillLinked } from '../linkify.js'
import { SHEET_LIMITS } from '../sheet-model.js'

const AUTOSAVE_MS = 450

export function createSheetsView(root, handlers) {
  let sheets = []
  let currentId = null
  let saveTimer = null
  let pending = {}

  const listEl = h('div', { class: 'sheets__list', role: 'list' })
  const title = h('input', {
    class: 'sheets__title',
    type: 'text',
    placeholder: 'Title',
    maxlength: String(SHEET_LIMITS.title),
    'aria-label': 'Sheet title',
    oninput: (e) => queue({ title: e.target.value }),
    onblur: flush,
  })
  const body = h('textarea', {
    class: 'sheets__body',
    placeholder: 'Write…',
    spellcheck: 'true',
    maxlength: String(SHEET_LIMITS.body),
    'aria-label': 'Sheet body',
    oninput: (e) => {
      queue({ body: e.target.value })
      paintView(e.target.value)
    },
    onfocus: () => paper.classList.add('is-editing'),
    onblur: () => {
      paper.classList.remove('is-editing')
      flush()
    },
  })
  const view = h('div', { class: 'sheets__view', 'aria-hidden': 'true' })
  view.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a')) return
    paper.classList.add('is-editing')
    body.focus()
  })

  const paper = h(
    'div',
    { class: 'sheets__paper' },
    h(
      'div',
      { class: 'sheets__paper-head' },
      title,
      h(
        'button',
        {
          class: 'icon-btn icon-btn--danger',
          type: 'button',
          'aria-label': 'Delete sheet',
          title: 'Delete sheet',
          onclick: () => currentId && handlers.onRemove(currentId),
        },
        icon('trash'),
      ),
    ),
    h('div', { class: 'sheets__stack' }, view, body),
  )
  const empty = h(
    'div',
    { class: 'sheets__empty' },
    h('p', { text: 'No sheets yet.' }),
    h('button', { class: 'btn btn--primary', type: 'button', onclick: () => handlers.onCreate() }, icon('plus'), h('span', { text: 'New sheet' })),
  )
  const stage = h('div', { class: 'sheets__stage' }, paper, empty)

  const nav = h(
    'aside',
    { class: 'sheets__nav' },
    h(
      'header',
      { class: 'sheets__nav-head' },
      h('span', { class: 'sheets__nav-label', text: 'Sheets' }),
      h(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'New sheet',
          title: 'New sheet',
          onclick: () => handlers.onCreate(),
        },
        icon('plus'),
      ),
    ),
    listEl,
  )

  root.classList.add('sheets')
  clear(root)
  root.append(nav, stage)

  function current() {
    return sheets.find((s) => s.id === currentId) || null
  }

  function queue(patch) {
    Object.assign(pending, patch)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, AUTOSAVE_MS)
    if ('title' in patch) paintList()
  }

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const patch = pending
    pending = {}
    if (!currentId || !Object.keys(patch).length) return
    await handlers.onPatch(currentId, patch)
  }

  function paintView(text) {
    fillLinked(view, text || '')
  }

  function paintList() {
    const scroll = listEl.scrollTop
    clear(listEl)
    for (const sheet of sheets) {
      const label = sheet.title.trim() || 'Untitled'
      listEl.appendChild(
        h(
          'button',
          {
            class: 'sheets__item',
            type: 'button',
            role: 'listitem',
            'aria-current': String(sheet.id === currentId),
            onclick: () => select(sheet.id),
          },
          h('span', { class: 'sheets__item-title', text: label }),
        ),
      )
    }
    listEl.scrollTop = scroll
  }

  function paintPaper() {
    const sheet = current()
    const has = Boolean(sheet)
    paper.hidden = !has
    empty.hidden = has
    if (!sheet) return
    if (document.activeElement !== title) title.value = sheet.title
    if (document.activeElement !== body) body.value = sheet.body
    paintView(sheet.body)
    if (!sheet.body && !sheet.title) {
      paper.classList.add('is-editing')
    }
  }

  async function select(id) {
    if (id === currentId) return
    await flush()
    currentId = id
    paper.classList.remove('is-editing')
    paintList()
    paintPaper()
  }

  return {
    render(nextSheets, { selectId } = {}) {
      sheets = nextSheets
      if (selectId) currentId = selectId
      if (currentId && !sheets.some((s) => s.id === currentId)) currentId = null
      if (!currentId && sheets[0]) currentId = sheets[0].id
      paintList()
      paintPaper()
    },
    get currentId() {
      return currentId
    },
    async flush() {
      await flush()
    },
    focusTitle() {
      paper.classList.add('is-editing')
      title.focus()
    },
  }
}
