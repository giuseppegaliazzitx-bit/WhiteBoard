/**
 * Shared notepad: an infinite canvas of stickies, text, strokes and images.
 *
 * Wheel zooms toward the cursor. Drag empty space to pan. Space+drag also
 * pans, so you can move around without switching tools.
 */
import { h, clear, icon } from './dom.js'
import {
  STICKY_COLORS,
  INK_COLORS,
  brushSize,
  fontSize,
  nextZ,
  CANVAS_LIMITS,
} from '../canvas-model.js'
import { screenToWorld, zoomAt, panBy } from '../camera.js'
import { fillLinked } from '../linkify.js'

const STICKY_MIN = 80
const IMAGE_MIN = 64

const TOOLS = [
  { id: 'select', label: 'Select', icon: 'pointer' },
  { id: 'sticky', label: 'Sticky', icon: 'sticky' },
  { id: 'text',   label: 'Text',   icon: 'text' },
  { id: 'draw',   label: 'Draw',   icon: 'pen' },
  { id: 'image',  label: 'Image',  icon: 'image' },
]

export function createPadView(root, handlers) {
  const state = {
    tool: 'select',
    stickyColor: STICKY_COLORS[0],
    inkColor: INK_COLORS[0],
    size: 3,
    camera: { x: 64, y: 64, zoom: 1 },
    selectedId: null,
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

  // ---------------------------------------------------------------- objects

  function findObj(id) {
    return state.objects.find((o) => o.id === id) || null
  }

  function select(id) {
    state.selectedId = id
    for (const node of world.querySelectorAll('[data-id]')) {
      node.classList.toggle('is-selected', node.dataset.id === id)
    }
    paintHint()
  }

  function paintHint() {
    if (state.objects.length) {
      hint.hidden = true
      return
    }
    hint.hidden = false
    hint.textContent = 'Scroll to zoom · drag empty space to pan · lock tools while typing'
  }

  function renderObject(obj) {
    if (obj.kind === 'sticky') return renderSticky(obj)
    if (obj.kind === 'text') return renderText(obj)
    if (obj.kind === 'image') return renderImage(obj)
    return renderStroke(obj)
  }

  function handlePx(w, h) {
    return Math.round(Math.max(14, Math.min(40, Math.min(w, h) * 0.14)))
  }

  function startMove(e, obj) {
    if (e.button !== 0) return
    if (spaceHeld || state.tool === 'draw') return
    e.stopPropagation()
    e.preventDefault()
    select(obj.id)
    const start = worldPoint(e)
    gesture = {
      type: 'move',
      id: obj.id,
      dx: start.x - obj.x,
      dy: start.y - obj.y,
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
    if (obj.id === state.selectedId) node.classList.add('is-selected')
    node.addEventListener('pointerdown', (e) => {
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
    if (obj.id === state.selectedId) node.classList.add('is-selected')
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
    if (obj.id === state.selectedId) node.classList.add('is-selected')
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
    if (obj.id === state.selectedId) svg.classList.add('is-selected')
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

  // ---------------------------------------------------------------- tools

  function setTool(tool) {
    if (state.locked) return
    state.tool = tool
    root.dataset.tool = tool
    for (const btn of root.querySelectorAll('.pad-tool')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tool === tool))
    }
    paintSwatches()
    if (tool === 'image') fileInput.click()
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

  async function placeSticky(pt) {
    const size = 200
    await handlers.onCreate({
      kind: 'sticky',
      x: pt.x - 16,
      y: pt.y - 16,
      w: size,
      h: size,
      z: nextZ(state.objects),
      data: { text: '', color: state.stickyColor, fontSize: fontSize(state.size) },
    })
  }

  async function placeText(pt) {
    await handlers.onCreate({
      kind: 'text',
      x: pt.x,
      y: pt.y - 12,
      w: 280,
      h: 48,
      z: nextZ(state.objects),
      data: { text: '', color: state.inkColor, fontSize: fontSize(state.size) },
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

  function clearLiveStroke() {
    liveStroke?.remove()
    liveStroke = null
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
      setTool('select')
      fileInput.value = ''
    }
  }

  // ---------------------------------------------------------------- pointer

  function isOff() {
    const view = document.body.dataset.view
    return root.hidden || view === 'board' || view === 'notepad'
  }

  function onPointerDown(e) {
    if (isOff()) return
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

    if (state.tool === 'sticky') {
      e.preventDefault()
      placeSticky(pt)
      return
    }

    if (state.tool === 'text') {
      e.preventDefault()
      placeText(pt)
      setTool('select')
      return
    }

    if (state.tool === 'select' && e.target === viewport) {
      select(null)
      gesture = { type: 'pan', x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      viewport.setPointerCapture(e.pointerId)
      viewport.classList.add('is-panning')
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
    if (gesture.type === 'move') {
      const pt = worldPoint(e)
      const node = world.querySelector(`[data-id="${CSS.escape(gesture.id)}"]`)
      if (node) {
        node.style.left = `${pt.x - gesture.dx}px`
        node.style.top = `${pt.y - gesture.dy}px`
      }
      gesture.lastX = pt.x - gesture.dx
      gesture.lastY = pt.y - gesture.dy
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
    if (done.type === 'move' && typeof done.lastX === 'number') {
      const obj = findObj(done.id)
      if (!obj) return
      const dx = done.lastX - obj.x
      const dy = done.lastY - obj.y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
      await handlers.onPatch(done.id, { x: done.lastX, y: done.lastY })
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

  function onKeyDown(e) {
    if (isOff()) return
    if (e.code === 'Space' && !isEditing(e.target)) {
      spaceHeld = true
      viewport.classList.add('is-space')
      e.preventDefault()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId && !isEditing(e.target)) {
      e.preventDefault()
      const id = state.selectedId
      select(null)
      handlers.onRemove(id)
    }
    if (e.key === 'Escape') {
      select(null)
      if (!state.locked) setTool('select')
      return
    }
    if (state.locked || isEditing(e.target)) return
    if (e.key === 'v') setTool('select')
    if (e.key === 's') setTool('sticky')
    if (e.key === 't') setTool('text')
    if (e.key === 'd') setTool('draw')
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceHeld = false
      viewport.classList.remove('is-space')
    }
  }

  // ---------------------------------------------------------------- build

  zoomLabel = h('span', { class: 'pad-zoom', text: '100%' })
  swatches = h('div', { class: 'pad-swatches' })
  hint = h('p', { class: 'pad-hint' })
  world = h('div', { class: 'pad__world' })
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
  )
  viewport.addEventListener('wheel', onWheel, { passive: false })

  fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'visually-hidden',
    onchange: (e) => loadImageFile(e.target.files?.[0]),
    oncancel: () => setTool('select'),
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
        'aria-label': tool.label,
        title: tool.label,
        'aria-pressed': String(tool.id === state.tool),
        onclick: () => setTool(tool.id),
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
        title: 'Lock tools while typing',
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
        onclick: () => {
          if (!state.selectedId) return
          const id = state.selectedId
          select(null)
          handlers.onRemove(id)
        },
      },
      icon('trash'),
    ),
    h('span', { class: 'pad-spacer' }),
    zoomLabel,
  )

  root.classList.add('pad')
  root.dataset.tool = state.tool
  clear(root)
  root.append(toolbar, viewport, fileInput)
  paintSwatches()
  applyCamera()
  applyLock()

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)

  return {
    render(objects) {
      state.objects = objects
      if (state.selectedId && !objects.some((o) => o.id === state.selectedId)) {
        state.selectedId = null
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
    },
  }
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
