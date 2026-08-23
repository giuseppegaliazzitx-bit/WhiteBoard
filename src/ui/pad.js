/**
 * Shared whiteboard: stickies, pen, arrows, images.
 *
 * Right-click picks a tool. Mouse-drag draws a selection rectangle.
 * Wheel zooms; Space/middle-drag pans.
 */
import { h, clear, icon } from './dom.js'
import {
  STICKY_COLORS,
  INK_COLORS,
  brushSize,
  fontSize,
  nextZ,
  CANVAS_LIMITS,
  objectsInRect,
} from '../canvas-model.js'
import { screenToWorld, zoomAt, panBy } from '../camera.js'
import { fillLinked } from '../linkify.js'

const STICKY_MIN = 80
const IMAGE_MIN = 64

const TOOLS = [
  { id: 'select', label: 'Mouse',  icon: 'pointer', key: 'U' },
  { id: 'draw',   label: 'Pen',    icon: 'pen',     key: 'I' },
  { id: 'sticky', label: 'Sticky', icon: 'sticky',  key: 'O' },
  { id: 'arrow',  label: 'Arrow',  icon: 'arrow',   key: 'P' },
  { id: 'delete', label: 'Delete', icon: 'trash',   key: 'Y' },
  { id: 'image',  label: 'Image',  icon: 'image',   key: 'K' },
]

const KEY_TOOLS = { u: 'select', i: 'draw', o: 'sticky', p: 'arrow', y: 'delete', k: 'image' }

export function createPadView(root, handlers) {
  const state = {
    tool: 'select',
    stickyColor: STICKY_COLORS[0],
    inkColor: INK_COLORS[0],
    size: 3,
    camera: { x: 64, y: 64, zoom: 1 },
    selectedIds: new Set(),
    objects: [],
    lockPinned: false,
    editing: false,
    locked: false,
  }

  let spaceHeld = false
  let gesture = null
  let liveStroke = null
  let zoomLabel
  let world
  let viewport
  let swatches
  let fileInput
  let hint
  let lockBtn
  let menu
  let marquee

  function currentColors() {
    return state.tool === 'sticky' ? STICKY_COLORS : INK_COLORS
  }

  function currentColor() {
    return state.tool === 'sticky' ? state.stickyColor : state.inkColor
  }

  function setCurrentColor(color) {
    if (state.tool === 'sticky') state.stickyColor = color
    else state.inkColor = color
  }

  function rect() {
    return viewport.getBoundingClientRect()
  }

  function worldPoint(e) {
    return screenToWorld(e.clientX, e.clientY, state.camera, rect())
  }

  function applyCamera() {
    world.style.transform = `translate(${state.camera.x}px, ${state.camera.y}px) scale(${state.camera.zoom})`
    viewport.style.setProperty('--cam-x', `${state.camera.x}px`)
    viewport.style.setProperty('--cam-y', `${state.camera.y}px`)
    viewport.style.setProperty('--zoom', String(state.camera.zoom))
    zoomLabel.textContent = `${Math.round(state.camera.zoom * 100)}%`
  }

  function isEditing(target) {
    return Boolean(target && (target.tagName === 'TEXTAREA' || target.isContentEditable || target.closest?.('textarea')))
  }

  function applyLock() {
    state.locked = state.lockPinned || state.editing
    root.classList.toggle('is-locked', state.locked)
    if (lockBtn) {
      lockBtn.setAttribute('aria-pressed', String(state.locked))
      const label = state.locked ? 'Unlock tools' : 'Lock tools while typing'
      lockBtn.setAttribute('aria-label', label)
      lockBtn.title = label
    }
  }

  function findObj(id) {
    return state.objects.find((o) => o.id === id) || null
  }

  function paintSelection() {
    for (const node of world.querySelectorAll('[data-id]')) {
      node.classList.toggle('is-selected', state.selectedIds.has(node.dataset.id))
    }
    paintHint()
  }

  function selectIds(ids) {
    state.selectedIds = new Set(ids.filter(Boolean))
    paintSelection()
  }

  function select(id) {
    selectIds(id ? [id] : [])
  }

  function selectedList() {
    return [...state.selectedIds]
  }

  function paintHint() {
    if (state.objects.length) {
      hint.hidden = true
      return
    }
    hint.hidden = false
    hint.textContent = 'Right-click for tools · drag with Mouse to select · scroll to zoom'
  }

  function hideMenu() {
    if (menu) menu.hidden = true
  }

  function showMenu(e) {
    menu.hidden = false
    const vr = root.getBoundingClientRect()
    let x = e.clientX - vr.left
    let y = e.clientY - vr.top
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    const box = menu.getBoundingClientRect()
    if (box.right > vr.right) menu.style.left = `${Math.max(8, x - box.width)}px`
    if (box.bottom > vr.bottom) menu.style.top = `${Math.max(8, y - box.height)}px`
  }

  function renderObject(obj) {
    if (obj.kind === 'sticky') return renderSticky(obj)
    if (obj.kind === 'text') return renderText(obj)
    if (obj.kind === 'image') return renderImage(obj)
    if (obj.kind === 'arrow') return renderArrow(obj)
    return renderStroke(obj)
  }

  function handlePx(w, h) {
    return Math.round(Math.max(14, Math.min(40, Math.min(w, h) * 0.14)))
  }

  function startMove(e, obj) {
    if (e.button !== 0) return
    if (spaceHeld || state.tool === 'draw' || state.tool === 'arrow') return
    if (state.tool === 'delete') {
      e.stopPropagation()
      e.preventDefault()
      removeIds([obj.id])
      return
    }
    e.stopPropagation()
    e.preventDefault()
    const group = state.selectedIds.has(obj.id) && state.selectedIds.size > 1
      ? selectedList()
      : [obj.id]
    selectIds(group)
    const start = worldPoint(e)
    gesture = {
      type: 'move',
      origins: group.map((id) => {
        const o = findObj(id)
        return { id, x: o.x, y: o.y }
      }),
      startX: start.x,
      startY: start.y,
      pointerId: e.pointerId,
    }
    viewport.setPointerCapture(e.pointerId)
  }

  function bindMoveHandle(node, obj) {
    node.addEventListener('pointerdown', (e) => {
      if (isEditing(e.target)) return
      if (e.target.closest?.('.pad-resize, .pad-move, a, textarea')) return
      startMove(e, obj)
    })
  }

  function moveHandle(obj) {
    const size = Math.round(handlePx(obj.w, obj.h) * 1.15)
    return h(
      'button',
      {
        class: 'pad-move',
        type: 'button',
        title: 'Move',
        'aria-label': 'Move',
        style: { width: `${size}px`, height: `${Math.round(size * 0.7)}px` },
        onpointerdown: (e) => startMove(e, obj),
      },
      icon('move'),
    )
  }

  function resizeHandle(obj, { keepRatio = false } = {}) {
    const size = handlePx(obj.w, obj.h)
    return h('div', {
      class: 'pad-resize',
      title: 'Resize',
      'aria-label': 'Resize',
      style: { width: `${size}px`, height: `${size}px` },
      onpointerdown: (e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        select(obj.id)
        const pt = worldPoint(e)
        gesture = {
          type: 'resize',
          id: obj.id,
          startW: obj.w,
          startH: obj.h,
          originX: pt.x,
          originY: pt.y,
          keepRatio,
          ratio: obj.h ? obj.w / obj.h : 1,
          pointerId: e.pointerId,
        }
        viewport.setPointerCapture(e.pointerId)
      },
    })
  }

  function renderSticky(obj) {
    const area = h('textarea', {
      class: 'pad-sticky__text',
      spellcheck: 'false',
      maxlength: String(CANVAS_LIMITS.text),
      'aria-label': 'Sticky note',
      onpointerdown: (e) => e.stopPropagation(),
      onfocus: () => {
        node.classList.add('is-editing')
        state.editing = true
        applyLock()
      },
      onblur: (e) => {
        node.classList.remove('is-editing')
        state.editing = false
        applyLock()
        const text = e.target.value
        if (text !== obj.data.text) handlers.onPatch(obj.id, { data: { ...obj.data, text } })
      },
    })
    area.value = obj.data.text
    area.style.fontSize = `${obj.data.fontSize}px`

    const node = h(
      'div',
      {
        class: 'pad-sticky',
        dataset: { id: obj.id },
        style: {
          left: `${obj.x}px`,
          top: `${obj.y}px`,
          width: `${obj.w}px`,
          height: `${obj.h}px`,
          'z-index': String(obj.z),
          'background-color': obj.data.color,
        },
      },
      moveHandle(obj),
      area,
      resizeHandle(obj),
    )
    if (state.selectedIds.has(obj.id)) node.classList.add('is-selected')
    node.addEventListener('pointerdown', (e) => {
      if (state.tool === 'delete') {
        e.preventDefault()
        e.stopPropagation()
        removeIds([obj.id])
        return
      }
      if (e.target.closest('.pad-move, .pad-resize')) return
      area.focus()
    })
    return node
  }

  function renderText(obj) {
    const view = h('div', { class: 'pad-text__view' })
    fillLinked(view, obj.data.text)

    const editor = h('div', {
      class: 'pad-text__edit',
      contenteditable: 'true',
      spellcheck: 'false',
      'aria-label': 'Text',
    })
    editor.textContent = obj.data.text
    editor.addEventListener('pointerdown', (e) => e.stopPropagation())
    editor.addEventListener('focus', () => {
      node.classList.add('is-editing')
      state.editing = true
      applyLock()
    })
    editor.addEventListener('blur', () => {
      node.classList.remove('is-editing')
      state.editing = false
      applyLock()
      const text = editor.textContent || ''
      fillLinked(view, text)
      if (text !== obj.data.text) handlers.onPatch(obj.id, { data: { ...obj.data, text } })
    })

    view.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a')) return
      e.stopPropagation()
      node.classList.add('is-editing')
      editor.focus()
    })

    const node = h('div', {
      class: 'pad-text',
      dataset: { id: obj.id },
      style: {
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${obj.w}px`,
        'z-index': String(obj.z),
        color: obj.data.color,
        'font-size': `${obj.data.fontSize}px`,
      },
    }, view, editor)
    if (state.selectedIds.has(obj.id)) node.classList.add('is-selected')
    if (!obj.data.text) node.classList.add('is-editing')
    bindMoveHandle(node, obj)
    return node
  }

  function renderImage(obj) {
    const img = h('img', {
      class: 'pad-image__img',
      src: obj.data.src,
      alt: '',
      draggable: 'false',
    })
    const node = h('div', {
      class: 'pad-image',
      dataset: { id: obj.id },
      style: {
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${obj.w}px`,
        height: `${obj.h}px`,
        'z-index': String(obj.z),
      },
    }, img)
    if (state.selectedIds.has(obj.id)) node.classList.add('is-selected')
    node.appendChild(resizeHandle(obj, { keepRatio: true }))
    bindMoveHandle(node, obj)
    return node
  }

  function renderStroke(obj) {
    const pad = obj.data.size
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'pad-stroke')
    svg.dataset.id = obj.id
    svg.style.left = `${obj.x}px`
    svg.style.top = `${obj.y}px`
    svg.style.width = `${Math.max(obj.w, 1)}px`
    svg.style.height = `${Math.max(obj.h, 1)}px`
    svg.style.zIndex = String(obj.z)
    svg.setAttribute('viewBox', `0 0 ${Math.max(obj.w, 1)} ${Math.max(obj.h, 1)}`)
    svg.setAttribute('overflow', 'visible')

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', pointsToPath(obj.data.points, pad))
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', obj.data.color)
    path.setAttribute('stroke-width', String(obj.data.size))
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    if (state.selectedIds.has(obj.id)) svg.classList.add('is-selected')
    bindMoveHandle(svg, obj)
    return svg
  }

  function renderArrow(obj) {
    const { x1, y1, x2, y2, color, size } = obj.data
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'pad-arrow')
    svg.dataset.id = obj.id
    svg.style.left = `${obj.x}px`
    svg.style.top = `${obj.y}px`
    svg.style.width = `${Math.max(obj.w, 1)}px`
    svg.style.height = `${Math.max(obj.h, 1)}px`
    svg.style.zIndex = String(obj.z)
    svg.setAttribute('viewBox', `0 0 ${Math.max(obj.w, 1)} ${Math.max(obj.h, 1)}`)
    svg.setAttribute('overflow', 'visible')

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    line.setAttribute('d', arrowPath(x1, y1, x2, y2, size))
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', String(size))
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(line)
    if (state.selectedIds.has(obj.id)) svg.classList.add('is-selected')
    bindMoveHandle(svg, obj)
    return svg
  }

  function pointsToPath(points, origin) {
    if (!points.length) return ''
    const [first, ...rest] = points
    let d = `M ${first[0] + origin} ${first[1] + origin}`
    for (const [x, y] of rest) d += ` L ${x + origin} ${y + origin}`
    return d
  }

  function paintWorld() {
    if (gesture) return
    const keepFocus = document.activeElement
    const keepId = keepFocus?.closest?.('[data-id]')?.dataset.id
    const selStart = keepFocus?.selectionStart
    const selEnd = keepFocus?.selectionEnd
    const wasEditing = keepFocus && world.contains(keepFocus) && isEditing(keepFocus)

    clear(world)
    const sorted = [...state.objects].sort((a, b) => a.z - b.z)
    for (const obj of sorted) world.appendChild(renderObject(obj))
    paintHint()
    applyCamera()

    if (wasEditing && keepId) {
      const next = world.querySelector(`[data-id="${CSS.escape(keepId)}"] textarea, [data-id="${CSS.escape(keepId)}"][contenteditable]`)
      if (next) {
        next.focus()
        if (typeof selStart === 'number' && next.setSelectionRange) {
          try { next.setSelectionRange(selStart, selEnd) } catch { /* not a text field */ }
        }
      }
    }
  }

  function setTool(tool, { force = false } = {}) {
    if (state.locked && !force) return
    if (tool === 'image') {
      fileInput.click()
      return
    }
    state.tool = tool
    root.dataset.tool = tool
    for (const btn of root.querySelectorAll('.pad-tool')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tool === tool))
    }
    paintSwatches()
    hideMenu()
  }

  function paintSwatches() {
    clear(swatches)
    const active = currentColor()
    for (const color of currentColors()) {
      swatches.appendChild(
        h('button', {
          class: 'pad-swatch',
          type: 'button',
          style: { 'background-color': color },
          'aria-label': color,
          'aria-pressed': String(color === active),
          onclick: () => {
            setCurrentColor(color)
            paintSwatches()
          },
        }),
      )
    }
  }

  function removeIds(ids) {
    const list = ids.filter(Boolean)
    if (!list.length) return
    list.forEach((id) => state.selectedIds.delete(id))
    paintSelection()
    if (list.length === 1) handlers.onRemove(list[0])
    else handlers.onRemoveMany?.(list)
  }

  async function placeSticky(pt) {
    await handlers.onCreate({
      kind: 'sticky',
      x: pt.x - 16,
      y: pt.y - 16,
      w: 200,
      h: 200,
      z: nextZ(state.objects),
      data: { text: '', color: state.stickyColor, fontSize: fontSize(state.size) },
    })
  }

  async function commitStroke(points) {
    if (points.length < 2) return
    const size = brushSize(state.size)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const origin = size
    const rel = points.map(([x, y]) => [x - minX, y - minY])
    await handlers.onCreate({
      kind: 'stroke',
      x: minX - origin,
      y: minY - origin,
      w: maxX - minX + origin * 2,
      h: maxY - minY + origin * 2,
      z: nextZ(state.objects),
      data: { points: rel, color: state.inkColor, size },
    })
  }

  async function commitArrow(x1, y1, x2, y2) {
    if (Math.hypot(x2 - x1, y2 - y1) < 8) return
    const pad = brushSize(state.size)
    const x = Math.min(x1, x2) - pad
    const y = Math.min(y1, y2) - pad
    await handlers.onCreate({
      kind: 'arrow',
      x,
      y,
      w: Math.abs(x2 - x1) + pad * 2,
      h: Math.abs(y2 - y1) + pad * 2,
      z: nextZ(state.objects),
      data: {
        x1: x1 - x,
        y1: y1 - y,
        x2: x2 - x,
        y2: y2 - y,
        color: state.inkColor,
        size: pad,
      },
    })
  }

  function showLiveStroke(points) {
    if (liveStroke) liveStroke.remove()
    if (points.length < 1) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'pad-live')
    svg.style.overflow = 'visible'
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const [first, ...rest] = points
    let d = `M ${first[0]} ${first[1]}`
    for (const [x, y] of rest) d += ` L ${x} ${y}`
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', state.inkColor)
    path.setAttribute('stroke-width', String(brushSize(state.size)))
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    world.appendChild(svg)
    liveStroke = svg
  }

  function showLiveArrow(x1, y1, x2, y2) {
    if (liveStroke) liveStroke.remove()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'pad-live')
    svg.style.overflow = 'visible'
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const size = brushSize(state.size)
    path.setAttribute('d', arrowPath(x1, y1, x2, y2, size))
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', state.inkColor)
    path.setAttribute('stroke-width', String(size))
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    world.appendChild(svg)
    liveStroke = svg
  }

  function clearLiveStroke() {
    liveStroke?.remove()
    liveStroke = null
  }

  function showMarquee(sx0, sy0, sx1, sy1) {
    const r = rect()
    const left = Math.min(sx0, sx1) - r.left
    const top = Math.min(sy0, sy1) - r.top
    marquee.hidden = false
    marquee.style.left = `${left}px`
    marquee.style.top = `${top}px`
    marquee.style.width = `${Math.abs(sx1 - sx0)}px`
    marquee.style.height = `${Math.abs(sy1 - sy0)}px`
  }

  function hideMarquee() {
    marquee.hidden = true
  }

  async function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      handlers.onError?.(new Error('Pick an image file.'))
      return
    }
    try {
      const { src, w, h } = await compressImage(file)
      const center = screenToWorld(
        rect().left + rect().width / 2,
        rect().top + rect().height / 2,
        state.camera,
        rect(),
      )
      const maxW = 420
      const scale = w > maxW ? maxW / w : 1
      await handlers.onCreate({
        kind: 'image',
        x: center.x - (w * scale) / 2,
        y: center.y - (h * scale) / 2,
        w: w * scale,
        h: h * scale,
        z: nextZ(state.objects),
        data: { src },
      })
    } catch (err) {
      handlers.onError?.(err)
    } finally {
      setTool('select', { force: true })
      fileInput.value = ''
    }
  }

  function isOff() {
    const view = document.body.dataset.view
    return root.hidden || view === 'board' || view === 'notepad'
  }

  function onPointerDown(e) {
    if (isOff()) return
    hideMenu()
    if (e.button === 1 || spaceHeld) {
      e.preventDefault()
      gesture = { type: 'pan', x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      viewport.setPointerCapture(e.pointerId)
      viewport.classList.add('is-panning')
      return
    }
    if (e.button !== 0) return

    const pt = worldPoint(e)

    if (state.locked) {
      e.preventDefault()
      gesture = { type: 'pan', x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      viewport.setPointerCapture(e.pointerId)
      viewport.classList.add('is-panning')
      return
    }

    if (state.tool === 'draw') {
      e.preventDefault()
      gesture = { type: 'draw', points: [[pt.x, pt.y]], pointerId: e.pointerId }
      viewport.setPointerCapture(e.pointerId)
      showLiveStroke(gesture.points)
      return
    }

    if (state.tool === 'arrow') {
      e.preventDefault()
      gesture = { type: 'arrow', x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, pointerId: e.pointerId }
      viewport.setPointerCapture(e.pointerId)
      showLiveArrow(pt.x, pt.y, pt.x, pt.y)
      return
    }

    if (state.tool === 'sticky') {
      e.preventDefault()
      placeSticky(pt)
      return
    }

    if (state.tool === 'delete') {
      const hit = e.target.closest?.('[data-id]')
      if (hit?.dataset.id) {
        e.preventDefault()
        removeIds([hit.dataset.id])
      }
      return
    }

    if (state.tool === 'select') {
      e.preventDefault()
      gesture = {
        type: 'marquee',
        sx: e.clientX,
        sy: e.clientY,
        pointerId: e.pointerId,
      }
      viewport.setPointerCapture(e.pointerId)
    }
  }

  function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    if (gesture.type === 'pan') {
      state.camera = panBy(state.camera, e.clientX - gesture.x, e.clientY - gesture.y)
      gesture.x = e.clientX
      gesture.y = e.clientY
      applyCamera()
      return
    }
    if (gesture.type === 'draw') {
      const pt = worldPoint(e)
      const last = gesture.points[gesture.points.length - 1]
      if (Math.hypot(pt.x - last[0], pt.y - last[1]) < 1.2) return
      gesture.points.push([pt.x, pt.y])
      showLiveStroke(gesture.points)
      return
    }
    if (gesture.type === 'arrow') {
      const pt = worldPoint(e)
      gesture.x2 = pt.x
      gesture.y2 = pt.y
      showLiveArrow(gesture.x1, gesture.y1, pt.x, pt.y)
      return
    }
    if (gesture.type === 'marquee') {
      showMarquee(gesture.sx, gesture.sy, e.clientX, e.clientY)
      return
    }
    if (gesture.type === 'move') {
      const pt = worldPoint(e)
      const dx = pt.x - gesture.startX
      const dy = pt.y - gesture.startY
      for (const origin of gesture.origins) {
        const node = world.querySelector(`[data-id="${CSS.escape(origin.id)}"]`)
        if (node) {
          node.style.left = `${origin.x + dx}px`
          node.style.top = `${origin.y + dy}px`
        }
      }
      gesture.lastDx = dx
      gesture.lastDy = dy
      return
    }
    if (gesture.type === 'resize') {
      const pt = worldPoint(e)
      let w = Math.max(STICKY_MIN, gesture.startW + (pt.x - gesture.originX))
      let h = Math.max(STICKY_MIN, gesture.startH + (pt.y - gesture.originY))
      if (gesture.keepRatio && gesture.ratio) {
        w = Math.max(IMAGE_MIN, gesture.startW + (pt.x - gesture.originX))
        h = Math.max(IMAGE_MIN, w / gesture.ratio)
      }
      const node = world.querySelector(`[data-id="${CSS.escape(gesture.id)}"]`)
      if (node) {
        node.style.width = `${w}px`
        node.style.height = `${h}px`
        const size = handlePx(w, h)
        const resize = node.querySelector('.pad-resize')
        if (resize) {
          resize.style.width = `${size}px`
          resize.style.height = `${size}px`
        }
        const mover = node.querySelector('.pad-move')
        if (mover) {
          mover.style.width = `${Math.round(size * 1.15)}px`
          mover.style.height = `${Math.round(size * 0.8)}px`
        }
      }
      gesture.lastW = w
      gesture.lastH = h
    }
  }

  async function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    viewport.classList.remove('is-panning')
    const done = gesture
    gesture = null
    if (done.type === 'draw') {
      clearLiveStroke()
      await commitStroke(done.points)
      return
    }
    if (done.type === 'arrow') {
      clearLiveStroke()
      await commitArrow(done.x1, done.y1, done.x2, done.y2)
      return
    }
    if (done.type === 'marquee') {
      hideMarquee()
      const a = screenToWorld(done.sx, done.sy, state.camera, rect())
      const b = worldPoint(e)
      const box = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      }
      if (box.w < 4 && box.h < 4) {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-id]')
        select(hit?.dataset.id || null)
        return
      }
      selectIds(objectsInRect(state.objects, box).map((o) => o.id))
      return
    }
    if (done.type === 'move' && typeof done.lastDx === 'number') {
      if (Math.abs(done.lastDx) < 0.5 && Math.abs(done.lastDy) < 0.5) return
      for (const origin of done.origins) {
        await handlers.onPatch(origin.id, { x: origin.x + done.lastDx, y: origin.y + done.lastDy })
      }
      return
    }
    if (done.type === 'resize' && typeof done.lastW === 'number') {
      const obj = findObj(done.id)
      if (!obj) return
      if (Math.abs(done.lastW - obj.w) < 0.5 && Math.abs(done.lastH - obj.h) < 0.5) return
      await handlers.onPatch(done.id, { w: done.lastW, h: done.lastH })
    }
  }

  function onWheel(e) {
    if (isOff()) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    state.camera = zoomAt(state.camera, e.clientX, e.clientY, factor, rect())
    applyCamera()
  }

  function onContextMenu(e) {
    if (isOff()) return
    e.preventDefault()
    e.stopPropagation()
    if (e.target.closest?.('.pad-menu')) return
    showMenu(e)
  }

  function onKeyDown(e) {
    if (isOff()) return
    if (e.code === 'Space' && !isEditing(e.target)) {
      spaceHeld = true
      viewport.classList.add('is-space')
      e.preventDefault()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size && !isEditing(e.target)) {
      e.preventDefault()
      removeIds(selectedList())
      return
    }
    if (e.key === 'Escape') {
      hideMenu()
      select(null)
      if (!state.locked) setTool('select', { force: true })
      return
    }
    if ((e.ctrlKey || e.metaKey) && !isEditing(e.target)) {
      const letter = e.key.toLowerCase()
      if (letter === 'l') {
        e.preventDefault()
        state.lockPinned = !state.lockPinned
        applyLock()
        return
      }
      const tool = KEY_TOOLS[letter]
      if (tool) {
        e.preventDefault()
        setTool(tool, { force: true })
      }
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceHeld = false
      viewport.classList.remove('is-space')
    }
  }

  zoomLabel = h('span', { class: 'pad-zoom', text: '100%' })
  swatches = h('div', { class: 'pad-swatches' })
  hint = h('p', { class: 'pad-hint' })
  marquee = h('div', { class: 'pad-marquee', hidden: true })
  world = h('div', { class: 'pad__world' })

  menu = h(
    'div',
    { class: 'pad-menu', hidden: true, role: 'menu' },
    ...TOOLS.filter((t) => t.id !== 'image').map((tool) =>
      h(
        'button',
        {
          class: 'pad-menu__item',
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            if (tool.id === 'delete' && state.selectedIds.size) {
              hideMenu()
              removeIds(selectedList())
              return
            }
            setTool(tool.id, { force: true })
          },
        },
        icon(tool.icon),
        h('span', { text: tool.label }),
        h('kbd', { text: `Ctrl+${tool.key}` }),
      ),
    ),
  )

  const keys = h(
    'div',
    { class: 'pad-keys', 'aria-hidden': 'true' },
    ...[...TOOLS, { id: 'lock', label: 'Lock', icon: 'lock', key: 'L' }].map((tool) =>
      h(
        'div',
        { class: 'pad-keys__row' },
        icon(tool.icon),
        h('span', { text: tool.label }),
        h('kbd', { text: `Ctrl+${tool.key}` }),
      ),
    ),
  )

  viewport = h(
    'div',
    {
      class: 'pad__viewport',
      tabindex: '0',
      onpointerdown: onPointerDown,
      onpointermove: onPointerMove,
      onpointerup: onPointerUp,
      onpointercancel: onPointerUp,
    },
    world,
    hint,
    marquee,
    keys,
  )
  viewport.addEventListener('wheel', onWheel, { passive: false })
  root.addEventListener('contextmenu', onContextMenu, true)

  fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'visually-hidden',
    onchange: (e) => loadImageFile(e.target.files?.[0]),
    oncancel: () => setTool('select', { force: true }),
  })

  const sizeInput = h('input', {
    class: 'pad-size',
    type: 'range',
    min: '1',
    max: '6',
    value: String(state.size),
    'aria-label': 'Size',
    title: 'Text / brush size',
    oninput: (e) => {
      state.size = Number(e.target.value)
    },
  })

  const tools = TOOLS.map((tool) =>
    h(
      'button',
      {
        class: 'pad-tool icon-btn',
        type: 'button',
        dataset: { tool: tool.id },
        'aria-label': `${tool.label} (Ctrl+${tool.key})`,
        title: `${tool.label}  Ctrl+${tool.key}`,
        'aria-pressed': String(tool.id === state.tool),
        onclick: () => setTool(tool.id, { force: true }),
      },
      icon(tool.icon),
    ),
  )

  const toolbar = h(
    'div',
    { class: 'pad__toolbar' },
    ...tools,
    h('span', { class: 'pad-sep' }),
    swatches,
    h('span', { class: 'pad-sep' }),
    sizeInput,
    h('span', { class: 'pad-sep' }),
    (lockBtn = h(
      'button',
      {
        class: 'icon-btn pad-lock',
        type: 'button',
        'aria-pressed': 'false',
        'aria-label': 'Lock tools while typing',
        title: 'Lock tools while typing  Ctrl+L',
        onclick: () => {
          state.lockPinned = !state.lockPinned
          applyLock()
        },
      },
      icon('lock'),
    )),
    h(
      'button',
      {
        class: 'icon-btn icon-btn--danger',
        type: 'button',
        'aria-label': 'Delete selected',
        title: 'Delete selected',
        onclick: () => removeIds(selectedList()),
      },
      icon('trash'),
    ),
    h('span', { class: 'pad-spacer' }),
    zoomLabel,
  )

  root.classList.add('pad')
  root.dataset.tool = state.tool
  clear(root)
  root.append(toolbar, viewport, menu, fileInput)
  paintSwatches()
  applyCamera()
  applyLock()

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) hideMenu()
  }, true)

  return {
    render(objects) {
      state.objects = objects
      for (const id of [...state.selectedIds]) {
        if (!objects.some((o) => o.id === id)) state.selectedIds.delete(id)
      }
      paintWorld()
    },
    focusLast(kind) {
      const last = [...state.objects].reverse().find((o) => o.kind === kind)
      if (!last) return
      select(last.id)
      const node = world.querySelector(`[data-id="${CSS.escape(last.id)}"]`)
      node?.classList.add('is-editing')
      const field = node?.querySelector?.('textarea, [contenteditable]')
      field?.focus()
    },
    destroy() {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      root.removeEventListener('contextmenu', onContextMenu, true)
    },
  }
}

function arrowPath(x1, y1, x2, y2, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const len = Math.max(10, size * 2.2)
  const a1 = angle - Math.PI / 7
  const a2 = angle + Math.PI / 7
  const hx1 = x2 - Math.cos(a1) * len
  const hy1 = y2 - Math.sin(a1) * len
  const hx2 = x2 - Math.cos(a2) * len
  const hy2 = y2 - Math.sin(a2) * len
  return `M ${x1} ${y1} L ${x2} ${y2} M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 1200
      let w = img.width
      let h = img.height
      const scale = Math.min(1, max / Math.max(w, h))
      w = Math.max(1, Math.round(w * scale))
      h = Math.max(1, Math.round(h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const src = canvas.toDataURL('image/jpeg', 0.72)
      if (src.length > CANVAS_LIMITS.imageChars) {
        reject(new Error('That image is too large. Try a smaller one.'))
        return
      }
      resolve({ src, w, h })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}
