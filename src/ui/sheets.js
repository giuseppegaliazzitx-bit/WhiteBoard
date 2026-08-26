/**
 * Lined notepad. A thin tab bar up top (+ to add a page), a title, and
 * a ruled page you type on.
 */
import { h, clear, icon } from './dom.js'
import { fillLinked, hasLinks } from '../linkify.js'
import { SHEET_LIMITS, SHEET_LINE, padToLine, offsetAtLine, indentSelection, nextLineCaret } from '../sheet-model.js'
import { createTextHistory, kindFromInputType } from '../undo.js'
import {
  plainText,
  serializeRich,
  setRich,
  caretOffsets,
  setCaretOffsets,
  insertTextAt,
  toggleMark,
  formatFromKey,
} from '../rich-text.js'

const AUTOSAVE_MS = 450

export function createSheetsView(root, handlers) {
  let sheets = []
  let currentId = null
  let saveTimer = null
  let pending = {}
  const histories = new Map()

  const tabs = h('div', { class: 'sheets__tabs', role: 'tablist', 'aria-label': 'Notepads' })
  const title = h('input', {
    class: 'sheets__title',
    type: 'text',
    placeholder: 'Name this notepad',
    maxlength: String(SHEET_LIMITS.title),
    'aria-label': 'Notepad title',
    oninput: (e) => onEditorInput(e, 'title'),
    onblur: flush,
  })
  const body = h('div', {
    class: 'sheets__body',
    contenteditable: 'true',
    spellcheck: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': 'Notepad',
    'data-placeholder': 'Click a line and type…',
  })
  body.addEventListener('input', (e) => onEditorInput(e, 'body'))
  body.addEventListener('pointerdown', (e) => goToClickedLine(e))
  title.addEventListener('beforeinput', (e) => onEditorBeforeInput(e, 'title'))
  body.addEventListener('beforeinput', (e) => onEditorBeforeInput(e, 'body'))
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

  const mod = navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl'
  const keys = h(
    'div',
    { class: 'sheets__keys', 'aria-hidden': 'true' },
    ...[
      ['B', 'Bold'],
      ['I', 'Italic'],
      ['U', 'Underline'],
      ['Z', 'Undo'],
    ].map(([key, label]) =>
      h(
        'div',
        { class: 'sheets__keys-row' },
        h('span', { text: label }),
        h('kbd', { text: `${mod}+${key}` }),
      ),
    ),
  )

  const paper = h(
    'div',
    { class: 'sheets__paper' },
    keys,
    title,
    links,
    body,
  )
  paper.addEventListener('pointerdown', (e) => {
    if (e.target === title || e.target.closest('a')) return
    if (e.target === keys || keys.contains(e.target)) return
    if (body.contains(e.target)) return
    goToClickedLine(e)
  })

  function notepadOpen() {
    return document.body.dataset.view === 'notepad' && !root.hidden
  }

  function overlayOpen() {
    return Boolean(document.querySelector('#modal-root .modal, #detail-root .drawer'))
  }

  function isTab(e) {
    return e.key === 'Tab' || e.code === 'Tab' || e.keyCode === 9
  }

  function inBody() {
    return document.activeElement === body || body.contains(document.activeElement)
  }

  function applyTab(shift) {
    if (!inBody()) body.focus()
    const plain = plainText(body)
    const { start, end } = caretOffsets(body)
    if (shift) {
      const next = nextLineCaret(plain, start)
      if (next.text !== plain) {
        recordChange('edit', 'body')
        insertTextAt(body, plain.length, next.text.slice(plain.length))
      }
      setCaretOffsets(body, next.offset)
      queue({ body: serializeRich(body).slice(0, SHEET_LIMITS.body) })
      paintLinks(plainText(body))
      return
    }
    const next = indentSelection(plain, start, end)
    if (next.text === plain) return
    recordChange('indent', 'body')
    const lineStart = start === 0 ? 0 : plain.lastIndexOf('\n', start - 1) + 1
    let lineEnd = end
    if (end > start && plain[end - 1] === '\n') lineEnd = end - 1
    else {
      const nl = plain.indexOf('\n', end)
      lineEnd = nl === -1 ? plain.length : nl
    }
    const block = plain.slice(lineStart, lineEnd)
    const starts = []
    let at = lineStart
    for (const line of block.split('\n')) {
      starts.push(at)
      at += line.length + 1
    }
    for (const off of starts.reverse()) insertTextAt(body, off, '\t')
    setCaretOffsets(body, next.start, next.end)
    queue({ body: serializeRich(body).slice(0, SHEET_LIMITS.body) })
    paintLinks(plainText(body))
  }

  function applyFormat(kind) {
    if (!inBody()) body.focus()
    recordChange('format', 'body')
    toggleMark(body, kind)
    queue({ body: serializeRich(body).slice(0, SHEET_LIMITS.body) })
    paintLinks(plainText(body))
  }

  function historyFor(id) {
    if (!id) return null
    if (!histories.has(id)) histories.set(id, createTextHistory())
    return histories.get(id)
  }

  function snapshot(field) {
    const caret = field === 'title'
      ? { start: title.selectionStart ?? 0, end: title.selectionEnd ?? 0 }
      : caretOffsets(body)
    return {
      title: title.value,
      body: serializeRich(body),
      start: caret.start,
      end: caret.end,
      field,
    }
  }

  function recordChange(kind, field) {
    const hist = historyFor(currentId)
    if (!hist || !kind) return
    hist.record({ ...snapshot(field), kind })
  }

  function restore(snap) {
    title.value = snap.title
    setRich(body, snap.body)
    queue({ title: snap.title, body: snap.body })
    paintLinks(plainText(body))
    paintTabs()
    if (snap.field === 'title') {
      title.focus()
      const start = Math.max(0, Math.min(snap.start, title.value.length))
      const end = Math.max(0, Math.min(snap.end, title.value.length))
      title.setSelectionRange(start, end)
    } else {
      setCaretOffsets(body, snap.start, snap.end)
    }
  }

  function undoText() {
    const hist = historyFor(currentId)
    if (!hist) return false
    const field = document.activeElement === title ? 'title' : 'body'
    const snap = hist.undo(snapshot(field))
    if (!snap) return false
    restore(snap)
    return true
  }

  function redoText() {
    const hist = historyFor(currentId)
    if (!hist) return false
    const field = document.activeElement === title ? 'title' : 'body'
    const snap = hist.redo(snapshot(field))
    if (!snap) return false
    restore(snap)
    return true
  }

  function onEditorBeforeInput(e, field) {
    const kind = kindFromInputType(e.inputType)
    if (kind) recordChange(kind, field)
  }

  function onEditorInput(e, field) {
    if (field === 'title') queue({ title: e.target.value })
    else {
      queue({ body: serializeRich(body).slice(0, SHEET_LIMITS.body) })
      paintLinks(plainText(body))
    }
  }

  function isUndoRedo(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
    const key = e.key.toLowerCase()
    if (key === 'z' && e.shiftKey) return 'redo'
    if (key === 'z') return 'undo'
    if (key === 'y') return 'redo'
    return null
  }

  /**
   * Capture Tab, undo, and format keys before the browser can steal them
   * (Ctrl+B bookmarks, Ctrl+U view-source, Tab leaving the page).
   */
  function onKeyCapture(e) {
    if (!notepadOpen() || overlayOpen()) return

    if (isTab(e)) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      if (e.target === title) {
        if (!e.shiftKey) body.focus()
        return
      }
      applyTab(e.shiftKey)
      return
    }

    if (e.key === 'Enter' && inBody() && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation?.()
      recordChange('newline', 'body')
      const { start } = caretOffsets(body)
      insertTextAt(body, start, '\n')
      setCaretOffsets(body, start + 1)
      queue({ body: serializeRich(body).slice(0, SHEET_LIMITS.body) })
      return
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const format = formatFromKey(e.key)
      if (format) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation?.()
        if (e.target === title) return
        applyFormat(format)
        return
      }
    }

    const undoRedo = isUndoRedo(e)
    if (!undoRedo) return
    if (e.target !== title && !inBody()) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation?.()
    if (undoRedo === 'redo') redoText()
    else undoText()
  }

  window.addEventListener('keydown', onKeyCapture, true)

  function destroy() {
    window.removeEventListener('keydown', onKeyCapture, true)
  }

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
    const plain = plainText(body)
    const parts = plain.split('\n')
    if (line < parts.length) {
      if (!body.contains(e.target)) {
        const pos = offsetAtLine(plain, line)
        setCaretOffsets(body, pos)
      }
      return
    }
    e.preventDefault()
    const next = padToLine(plain, line).slice(0, SHEET_LIMITS.body)
    if (next !== plain) {
      recordChange('edit', 'body')
      insertTextAt(body, plain.length, next.slice(plain.length))
      queue({ body: serializeRich(body).slice(0, SHEET_LIMITS.body) })
    }
    setCaretOffsets(body, offsetAtLine(plainText(body), line))
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
    await handlers.onPatch(currentId, patch, { record: false })
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
    if (!inBody()) setRich(body, sheet.body)
    paintLinks(plainText(body) || sheet.body)
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
    focusBody() {
      body.focus()
    },
    destroy,
  }
}
