/**
 * Turn pasted URLs into real links without ever using innerHTML.
 *
 * Only http(s) is allowed -- a board anyone with the URL can write to must
 * not honour javascript: or data: hrefs.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>[\]{}|'"`]+/gi

function stripTrailingPunct(url) {
  return url.replace(/[.,;:!?]+$/g, '').replace(/\)+$/g, (close) => {
    const open = (url.match(/\(/g) || []).length
    const extra = close.length - open
    return extra > 0 ? close.slice(0, close.length - extra) : close
  })
}

export function hrefFor(raw) {
  const trimmed = stripTrailingPunct(String(raw || '').trim())
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}

/** Split text into { type: 'text'|'link', text, href? } runs. */
export function splitLinks(text) {
  const src = String(text || '')
  if (!src) return []
  const parts = []
  const re = new RegExp(URL_RE.source, 'gi')
  let last = 0
  let match
  while ((match = re.exec(src))) {
    const raw = match[0]
    const cleaned = stripTrailingPunct(raw)
    const href = hrefFor(cleaned)
    if (match.index > last) parts.push({ type: 'text', text: src.slice(last, match.index) })
    if (href) {
      parts.push({ type: 'link', text: cleaned, href })
      last = match.index + cleaned.length
    } else {
      parts.push({ type: 'text', text: raw })
      last = match.index + raw.length
    }
  }
  if (last < src.length) parts.push({ type: 'text', text: src.slice(last) })
  return parts
}

export function hasLinks(text) {
  return splitLinks(text).some((p) => p.type === 'link')
}

/** Replace node's children with text + <a class="auto-link">. Never innerHTML. */
export function fillLinked(node, text) {
  while (node.firstChild) node.removeChild(node.firstChild)
  const parts = splitLinks(text)
  if (!parts.length) return node
  for (const part of parts) {
    if (part.type === 'link') {
      const a = document.createElement('a')
      a.className = 'auto-link'
      a.href = part.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = part.text
      a.addEventListener('pointerdown', (e) => e.stopPropagation())
      a.addEventListener('click', (e) => e.stopPropagation())
      node.appendChild(a)
    } else {
      node.appendChild(document.createTextNode(part.text))
    }
  }
  return node
}
