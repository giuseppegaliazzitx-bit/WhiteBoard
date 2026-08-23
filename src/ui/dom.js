/**
 * Minimal DOM helpers.
 *
 * Deliberately no innerHTML for anything user-supplied. Card titles, tags,
 * note text and names are all attacker-controlled in the threat model of
 * "anyone with the URL can write" (see SECURITY.md), so they only ever reach
 * the DOM through textContent or setAttribute.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * h('div', { class: 'x', onclick: fn }, child, child)
 * - `class`, `id`, `type`, ... set as attributes
 * - `on<event>` keys bind listeners
 * - `dataset` / `style` take objects
 * - null/undefined/false children are skipped, so `cond && h(...)` works
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag)
  applyProps(node, props)
  append(node, children)
  return node
}

function applyProps(node, props) {
  if (!props) return
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'dataset') {
      for (const [d, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) node.dataset[d] = v
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [p, v] of Object.entries(value)) node.style.setProperty(p, v)
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value)
    } else if (key === 'text') {
      node.textContent = value
    } else if (value === true) {
      node.setAttribute(key, '')
    } else {
      node.setAttribute(key, value)
    }
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment()
  append(f, children)
  return f
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function replace(node, ...children) {
  clear(node)
  append(node, children)
  return node
}

/** Icon paths, kept here so the SVG markup stays out of component code. */
const ICONS = {
  plus:   'M10 4v12M4 10h12',
  close:  'M5 5l10 10M15 5L5 15',
  x:      'M6 6l8 8M14 6l-8 8',
  trash:  'M4 6h12M8 6V4.5A.5.5 0 0 1 8.5 4h3a.5.5 0 0 1 .5.5V6M6 6l.7 9.1a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6',
  note:   'M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H8l-4 3V5.5Z',
  text:   'M5 6h10M5 10h10M5 14h6',
  arrow:  'M4 10h12M11 5l5 5-5 5',
  check:  'M4.5 10.5l3.5 3.5 7.5-8',
  copy:    'M7 7V5.5A1.5 1.5 0 0 1 8.5 4h6A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H13M4 8.5A1.5 1.5 0 0 1 5.5 7h6A1.5 1.5 0 0 1 13 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 4 14.5v-6Z',
  pointer: 'M5 3.5 15 11l-4.2 1.2L13 17l-2.2.8-2.2-4.8L5 16.5V3.5Z',
  pen:     'M13.2 3.5l3.3 3.3-9.4 9.4H3.8v-3.3l9.4-9.4z',
  sticky:  'M5 3.5h7.5L16 7v9.5H5V3.5z M12.5 3.5V7H16',
  image:   'M3.5 5h13v10H3.5z M7 8.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z M3.5 13.5l3.4-3.2 2.4 2.3 2.2-2.1 4.5 3',
  move:    'M10 3v14M3 10h14M6.5 6.5 10 3l3.5 3.5M6.5 13.5 10 17l3.5-3.5',
}

/** Stroked line icon. `fill` variants pass { fill: true }. */
export function icon(name, opts = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', ICONS[name] || ICONS.plus)
  if (opts.fill) {
    path.setAttribute('fill', 'currentColor')
  } else {
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', opts.weight || '1.7')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
  }
  svg.appendChild(path)
  return svg
}

export function iconButton(name, label, onClick, extraClass = '') {
  return h(
    'button',
    {
      class: `icon-btn ${extraClass}`.trim(),
      type: 'button',
      'aria-label': label,
      title: label,
      onclick: onClick,
    },
    icon(name),
  )
}
