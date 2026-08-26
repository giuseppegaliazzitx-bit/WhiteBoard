/**
 * Small rich-text helpers for the notepad. Only b/i/u (and the old
 * synonyms strong/em) survive sanitizing, so a shared board cannot
 * store scripts. Caret math is in plain-text offsets so indent and
 * click-to-line keep working on top of marks.
 */

const MARK = {
  bold: { tags: ['B', 'STRONG'], el: 'b' },
  italic: { tags: ['I', 'EM'], el: 'i' },
  underline: { tags: ['U'], el: 'u' },
}

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U'])
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'LINK'])

export const FORMAT_KEYS = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
}

export function plainText(el) {
  return el ? String(el.textContent || '') : ''
}

function copyAllowed(node, into) {
  if (node.nodeType === 3) {
    into.appendChild(document.createTextNode(node.data.replace(/\u200b/g, '')))
    return
  }
  if (node.nodeType !== 1) return
  const name = node.nodeName
  if (name === 'BR') {
    into.appendChild(document.createTextNode('\n'))
    return
  }
  if (name === 'DIV' || name === 'P') {
    if (into.childNodes.length) into.appendChild(document.createTextNode('\n'))
    for (const child of node.childNodes) copyAllowed(child, into)
    return
  }
  if (SKIP.has(name)) return
  if (!ALLOWED.has(name)) {
    for (const child of node.childNodes) copyAllowed(child, into)
    return
  }
  const tag = name === 'STRONG' ? 'b' : name === 'EM' ? 'i' : name.toLowerCase()
  const wrap = document.createElement(tag)
  for (const child of node.childNodes) copyAllowed(child, wrap)
  into.appendChild(wrap)
}

/** Strip anything that is not b/i/u/text. Safe to persist. */
export function sanitizeHtml(html) {
  const src = String(html || '')
  const out = document.createElement('div')
  if (!/<[a-z]/i.test(src)) {
    out.textContent = src
    return out.innerHTML
  }
  const tmp = document.createElement('div')
  tmp.innerHTML = src
  for (const child of [...tmp.childNodes]) copyAllowed(child, out)
  return out.innerHTML
}

export function serializeRich(el) {
  const out = document.createElement('div')
  if (!el) return ''
  for (const child of [...el.childNodes]) copyAllowed(child, out)
  return out.innerHTML
}

export function setRich(el, html) {
  const clean = sanitizeHtml(html)
  const tmp = document.createElement('div')
  tmp.innerHTML = clean
  while (el.firstChild) el.removeChild(el.firstChild)
  while (tmp.firstChild) el.appendChild(tmp.firstChild)
}

function pointAt(root, index) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let left = Math.max(0, index)
  let last = null
  let node
  while ((node = walker.nextNode())) {
    last = node
    const len = node.data.length
    if (left <= len) return { node, offset: left }
    left -= len
  }
  if (last) return { node: last, offset: last.data.length }
  return { node: root, offset: 0 }
}

export function caretOffsets(root) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) {
    const n = plainText(root).length
    return { start: n, end: n }
  }
  const { anchorNode, anchorOffset, focusNode, focusOffset } = sel
  if (!anchorNode || (!root.contains(anchorNode) && anchorNode !== root)) {
    const n = plainText(root).length
    return { start: n, end: n }
  }
  const a = offsetIn(root, anchorNode, anchorOffset)
  const b = offsetIn(root, focusNode, focusOffset)
  return { start: Math.min(a, b), end: Math.max(a, b) }
}

function offsetIn(root, node, offset) {
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return plainText(root).length
  }
  return range.toString().length
}

export function setCaretOffsets(root, start, end = start) {
  root.focus()
  const sel = window.getSelection()
  if (!root.firstChild) {
    const range = document.createRange()
    range.setStart(root, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    return
  }
  const a = pointAt(root, start)
  const b = pointAt(root, end)
  if (typeof sel.setBaseAndExtent === 'function') {
    sel.setBaseAndExtent(a.node, a.offset, b.node, b.offset)
    return
  }
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

export function insertTextAt(root, offset, text) {
  if (!text) return
  const point = pointAt(root, offset)
  if (point.node.nodeType === 3) {
    point.node.insertData(point.offset, text)
    return
  }
  const node = document.createTextNode(text)
  if (!root.firstChild) root.appendChild(node)
  else root.insertBefore(node, root.childNodes[point.offset] || null)
}

function parentMark(node, root, tags) {
  let cur = node && node.nodeType === 3 ? node.parentNode : node
  while (cur && cur !== root) {
    if (tags.includes(cur.nodeName)) return cur
    cur = cur.parentNode
  }
  return null
}

function wrapRange(range, kind) {
  const el = document.createElement(MARK[kind].el)
  el.appendChild(range.extractContents())
  range.insertNode(el)
  const sel = window.getSelection()
  const next = document.createRange()
  next.selectNodeContents(el)
  sel.removeAllRanges()
  sel.addRange(next)
}

function unwrapMark(mark) {
  const parent = mark.parentNode
  if (!parent) return
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
  parent.removeChild(mark)
}

function toggleCollapsed(root, range, kind) {
  const tags = MARK[kind].tags
  const mark = parentMark(range.startContainer, root, tags)
  const sel = window.getSelection()
  if (mark) {
    const after = document.createTextNode('\u200b')
    if (mark.nextSibling) mark.parentNode.insertBefore(after, mark.nextSibling)
    else mark.parentNode.appendChild(after)
    const next = document.createRange()
    next.setStart(after, 1)
    next.collapse(true)
    sel.removeAllRanges()
    sel.addRange(next)
    return
  }
  const el = document.createElement(MARK[kind].el)
  el.appendChild(document.createTextNode('\u200b'))
  range.insertNode(el)
  const next = document.createRange()
  next.setStart(el.firstChild, 1)
  next.collapse(true)
  sel.removeAllRanges()
  sel.addRange(next)
}

/** Toggle bold/italic/underline on the current selection inside `root`. */
export function toggleMark(root, kind) {
  if (!MARK[kind] || !root) return
  root.focus()
  const sel = window.getSelection()
  if (!sel) return
  if (!sel.rangeCount || (!root.contains(sel.anchorNode) && sel.anchorNode !== root)) {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  const range = sel.getRangeAt(0)
  const tags = MARK[kind].tags
  const mark =
    parentMark(range.commonAncestorContainer, root, tags) ||
    parentMark(range.startContainer, root, tags)
  if (range.collapsed) {
    toggleCollapsed(root, range, kind)
    return
  }
  if (mark) unwrapMark(mark)
  else wrapRange(range, kind)
}

export function formatFromKey(key) {
  return FORMAT_KEYS[String(key || '').toLowerCase()] || null
}
