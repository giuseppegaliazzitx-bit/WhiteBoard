/**
 * Lined notepad. A thin tab bar up top (+ to add a page), a title, and
 * a ruled page you type on.
 */
import { h, clear, icon } from './dom.js'
import { fillLinked, hasLinks } from '../linkify.js'
import { SHEET_LIMITS } from '../sheet-model.js'

const AUTOSAVE_MS = 450

export function createSheetsView(root, handlers) {
  let sheets = []
  let currentId = null
  let saveTimer = null
  let pending = {}

  const tabs = h('div', { class: 'sheets__tabs', role: 'tablist', 'aria-label': 'Sheets' })
  const title = h('input', {
    class: 'sheets__title',
    type: 'text',
    placeholder: 'Name this sheet',
    maxlength: String(SHEET_LIMITS.title),
    'aria-label': 'Sheet title',
    oninput: (e) => queue({ title: e.target.value }),
    onblur: flush,
  })
  const body = h('textarea', {
    class: 'sheets__body',
    placeholder: 'Start writing…',
    spellcheck: 'true',
    maxlength: String(SHEET_LIMITS.body),
    'aria-label': 'Sheet body',
    oninput: (e) => {
      queue({ body: e.target.value })
      paintLinks(e.target.value)
    },
    onblur: flush,
  })
  const links = h('div', { class: 'sheets__links' })
  const delBtn = h(
    'button',
    {
      class: 'icon-btn icon-btn--danger sheets__del',
      type: 'button',
      'aria-label': 'Delete this sheet',
      title: 'Delete this sheet',
      onclick: () => currentId && handlers.onRemove(currentId),
    },
    icon('trash'),
  )

  const bar = h(
    'div',
    { class: 'sheets__bar' },
    h(
      'button',
      {
        class: 'sheets__add',
        type: 'button',
        'aria-label': 'New sheet',
        title: 'New sheet',
        onclick: () => handlers.onCreate(),
      },
      icon('plus'),
    ),
    tabs,
    delBtn,
  )

  const paper = h(
    'div',
    { class: 'sheets__paper' },
    title,
    links,
    body,
  )

  const empty = h(
    'div',
    { class: 'sheets__empty' },
    h('p', { text: 'No sheets yet.' }),
    h(
      'button',
      { class: 'btn btn--primary', type: 'button', onclick: () => handlers.onCreate() },
      icon('plus'),
      h('span', { text: 'New sheet' }),
    ),
  )

  const stage = h('div', { class: 'sheets__stage' }, paper, empty)

  root.classList.add('sheets')
  clear(root)
  root.append(bar, stage)

  function current() {
    return sheets.find((s) => s.id === currentId) || null
  }

  function queue(patch) {
    Object.assign(pending, patch)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, AUTOSAVE_MS)
    if ('title' in patch) paintTabs()
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

  function paintLinks(text) {
    if (!hasLinks(text)) {
      clear(links)
      links.hidden = true
      return
    }
    links.hidden = false
    fillLinked(links, text)
  }

  function paintTabs() {
    const scroll = tabs.scrollLeft
    clear(tabs)
    for (const sheet of sheets) {
      const label = sheet.title.trim() || 'Untitled'
      tabs.appendChild(
        h(
          'button',
          {
            class: 'sheets__tab',
            type: 'button',
            role: 'tab',
            'aria-selected': String(sheet.id === currentId),
            title: label,
            onclick: () => select(sheet.id),
          },
          h('span', { text: label }),
        ),
      )
    }
    tabs.scrollLeft = scroll
  }

  function paintPaper() {
    const sheet = current()
    const has = Boolean(sheet)
    paper.hidden = !has
    empty.hidden = has
    delBtn.hidden = !has
    if (!sheet) return
    if (document.activeElement !== title) title.value = sheet.title
    if (document.activeElement !== body) body.value = sheet.body
    paintLinks(sheet.body)
  }

  async function select(id) {
    if (id === currentId) return
    await flush()
    currentId = id
    paintTabs()
    paintPaper()
  }

  return {
    render(nextSheets, { selectId } = {}) {
      sheets = nextSheets
      if (selectId) currentId = selectId
      if (currentId && !sheets.some((s) => s.id === currentId)) currentId = null
      if (!currentId && sheets[0]) currentId = sheets[0].id
      paintTabs()
      paintPaper()
    },
    get currentId() {
      return currentId
    },
    async flush() {
      await flush()
    },
    focusTitle() {
      title.focus()
    },
  }
}
