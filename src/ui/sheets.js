/**
 * Lined notepad. A thin tab bar up top (+ to add a page), a title, and
 * a ruled page you type on.
 */
import { h, clear, icon } from './dom.js'
import { fillLinked, hasLinks } from '../linkify.js'
import { SHEET_LIMITS, SHEET_LINE, padToLine, offsetAtLine } from '../sheet-model.js'

const AUTOSAVE_MS = 450

export function createSheetsView(root, handlers) {
  let sheets = []
  let currentId = null
  let saveTimer = null
  let pending = {}

  const tabs = h('div', { class: 'sheets__tabs', role: 'tablist', 'aria-label': 'Notepads' })
  const title = h('input', {
    class: 'sheets__title',
    type: 'text',
    placeholder: 'Name this notepad',
    maxlength: String(SHEET_LIMITS.title),
    'aria-label': 'Notepad title',
    oninput: (e) => queue({ title: e.target.value }),
    onblur: flush,
  })
  const body = h('textarea', {
    class: 'sheets__body',
    placeholder: 'Click a line and type…',
    spellcheck: 'true',
    maxlength: String(SHEET_LIMITS.body),
    'aria-label': 'Notepad',
    oninput: (e) => {
      queue({ body: e.target.value })
      paintLinks(e.target.value)
    },
    onblur: flush,
  })
  body.addEventListener('pointerdown', (e) => goToClickedLine(e))
  const links = h('div', { class: 'sheets__links' })
  const delBtn = h(
    'button',
    {
      class: 'icon-btn icon-btn--danger sheets__del',
      type: 'button',
      'aria-label': 'Delete this notepad',
      title: 'Delete this notepad',
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
        'aria-label': 'New notepad',
        title: 'New notepad',
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
  paper.addEventListener('pointerdown', (e) => {
    if (e.target === title || e.target.closest('a')) return
    if (e.target === body) return
    goToClickedLine(e)
  })

  const empty = h(
    'div',
    { class: 'sheets__empty' },
    h('p', { text: 'No notepads yet.' }),
    h(
      'button',
      { class: 'btn btn--primary', type: 'button', onclick: () => handlers.onCreate() },
      icon('plus'),
      h('span', { text: 'New notepad' }),
    ),
  )

  const stage = h('div', { class: 'sheets__stage' }, paper, empty)

  root.classList.add('sheets')
  clear(root)
  root.append(bar, stage)

  function current() {
    return sheets.find((s) => s.id === currentId) || null
  }

  function lineFromPointer(e) {
    const box = body.getBoundingClientRect()
    const padTop = parseFloat(getComputedStyle(body).paddingTop) || 0
    const y = e.clientY - box.top + body.scrollTop - padTop
    return Math.max(0, Math.floor(y / SHEET_LINE))
  }

  function goToClickedLine(e) {
    const line = lineFromPointer(e)
    const parts = body.value.split('\n')
    if (line < parts.length) {
      if (e.target !== body) {
        const pos = offsetAtLine(body.value, line)
        body.focus()
        body.setSelectionRange(pos, pos)
      }
      return
    }
    e.preventDefault()
    const next = padToLine(body.value, line).slice(0, SHEET_LIMITS.body)
    if (next !== body.value) {
      body.value = next
      queue({ body: next })
    }
    const pos = offsetAtLine(body.value, line)
    body.focus()
    body.setSelectionRange(pos, pos)
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
            title: `${label} — middle-click to delete`,
            onclick: () => select(sheet.id),
            onpointerdown: (e) => {
              if (e.button !== 1) return
              e.preventDefault()
              e.stopPropagation()
              handlers.onRemove(sheet.id)
            },
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
