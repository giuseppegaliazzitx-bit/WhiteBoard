import { h, clear, icon } from './dom.js'
import { renderCard } from './card.js'
import { STAGES, DONE_STAGE } from '../model.js'

const WIP_SOFT = 4
const HIDE_DONE_KEY = 'board:hide-done'

/**
 * The four columns.
 *
 * Rendering strategy: full re-render of a column's card list on every change.
 * At board scale (hundreds of cards) this is well under a frame, and it removes
 * a whole class of bugs where a diffing layer and the store disagree about
 * order. Scroll position is preserved manually since the nodes are replaced.
 */
export function createBoardView(root, handlers) {
  const columns = new Map()
  let hideDone = readHideDone()

  for (const stage of STAGES) {
    const count = h('span', { class: 'column__count', text: '0' })
    const body = h('div', {
      class: 'column__body',
      dataset: { stage: stage.id },
      role: 'list',
      'aria-label': `${stage.name} cards`,
    })

    const addTop = h(
      'button',
      {
        class: 'icon-btn column__add',
        type: 'button',
        'aria-label': `Add a card to ${stage.name}`,
        title: `Add a card to ${stage.name}`,
        onclick: () => handlers.onAdd(stage.id, 'top'),
      },
      icon('plus'),
    )

    const addBottom = h(
      'button',
      {
        class: 'btn btn--ghost btn--block',
        type: 'button',
        onclick: () => handlers.onAdd(stage.id, 'bottom'),
      },
      icon('plus'),
      h('span', { text: 'Add a card' }),
    )

    const hideBtn =
      stage.id === DONE_STAGE
        ? h('button', {
            class: 'btn btn--tiny column__hide',
            type: 'button',
            onclick: () => {
              hideDone = !hideDone
              writeHideDone(hideDone)
              handlers.onHideDone?.(hideDone)
            },
          })
        : null

    const headChildren = [
      h('span', { class: 'column__swatch' }),
      h('h2', { class: 'column__name', text: stage.name, title: stage.blurb }),
      count,
      hideBtn,
      addTop,
    ]

    const column = h(
      'section',
      { class: 'column', dataset: { stage: stage.id }, style: { '--dot': `var(--stage-${stage.id})` } },
      h('header', { class: 'column__head' }, ...headChildren),
      body,
      h('div', { class: 'column__foot' }, addBottom),
    )

    root.appendChild(column)
    columns.set(stage.id, { column, body, count, hideBtn })
  }

  const menu = h('div', { class: 'ctx-menu', hidden: true, role: 'menu', 'aria-label': 'Card actions' })
  document.body.appendChild(menu)

  function hideMenu() {
    menu.hidden = true
    clear(menu)
  }

  function placeMenu(clientX, clientY) {
    menu.style.left = `${clientX}px`
    menu.style.top = `${clientY}px`
    const box = menu.getBoundingClientRect()
    const pad = 8
    let x = clientX
    let y = clientY
    if (box.right > window.innerWidth - pad) x = Math.max(pad, clientX - box.width)
    if (box.bottom > window.innerHeight - pad) y = Math.max(pad, clientY - box.height)
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
  }

  function showMenu(e, cardEl) {
    const id = cardEl.dataset.id
    const status = cardEl.dataset.status
    clear(menu)

    menu.appendChild(h('div', { class: 'ctx-menu__label', text: 'Move to' }))
    for (const stage of STAGES) {
      const current = stage.id === status
      menu.appendChild(
        h(
          'button',
          {
            class: 'ctx-menu__item',
            type: 'button',
            role: 'menuitem',
            'aria-current': current ? 'true' : undefined,
            onclick: () => {
              hideMenu()
              if (!current) handlers.onMoveTo?.(id, stage.id)
            },
          },
          h('i', { class: 'ctx-menu__dot', style: { '--dot': `var(--stage-${stage.id})` } }),
          h('span', { text: stage.name }),
          current && icon('check'),
        ),
      )
    }

    menu.appendChild(h('div', { class: 'ctx-menu__sep' }))
    menu.appendChild(
      h(
        'button',
        {
          class: 'ctx-menu__item ctx-menu__item--danger',
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            hideMenu()
            handlers.onDelete?.(id)
          },
        },
        icon('trash'),
        h('span', { text: 'Delete' }),
      ),
    )

    menu.hidden = false
    placeMenu(e.clientX, e.clientY)
  }

  function onContextMenu(e) {
    // Capture-phase preventDefault so the browser menu never appears on the board.
    e.preventDefault()
    e.stopPropagation()
    if (menu.contains(e.target)) return
    const card = e.target.closest?.('.card')
    if (card && root.contains(card)) showMenu(e, card)
    else hideMenu()
  }

  function onMenuContextMenu(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  function onPointerDown(e) {
    if (menu.hidden || !menu.isConnected) return
    if (menu.contains(e.target)) return
    hideMenu()
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' || menu.hidden) return
    e.preventDefault()
    e.stopPropagation()
    hideMenu()
  }

  root.addEventListener('contextmenu', onContextMenu, true)
  menu.addEventListener('contextmenu', onMenuContextMenu, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  root.addEventListener('scroll', hideMenu, true)

  /**
   * @param {Map<string, object[]>} byStage  stage id -> cards, already sorted and filtered
   * @param {object} opts  { filtering: boolean } -- changes the empty-state copy
   */
  function render(byStage, opts = {}) {
    for (const stage of STAGES) {
      const { column, body, count, hideBtn } = columns.get(stage.id)
      const cards = byStage.get(stage.id) || []
      const scrollTop = body.scrollTop
      const tuckDone = stage.id === DONE_STAGE && hideDone && !opts.filtering && cards.length > 0

      count.textContent = String(cards.length)
      const busy = stage.id === 'progress' && cards.length >= WIP_SOFT
      column.classList.toggle('is-busy', busy)
      count.title = busy ? `${cards.length} in progress — a lot to have on the go at once` : ''
      if (hideBtn) {
        hideBtn.hidden = !cards.length
        hideBtn.textContent = tuckDone ? `Show ${cards.length}` : 'Hide'
      }

      clear(body)

      if (tuckDone) {
        body.appendChild(
          h('p', {
            class: 'column__empty',
            text: `${cards.length} finished — tucked away so the board stays scannable`,
          }),
        )
      } else if (!cards.length) {
        body.appendChild(
          h('p', {
            class: 'column__empty',
            text: opts.filtering ? 'Nothing matches here' : 'Nothing here yet',
          }),
        )
      } else {
        for (const card of cards) {
          const node = renderCard(card, { ...handlers, me: handlers.getMe?.() || '' })
          node.setAttribute('role', 'listitem')
          body.appendChild(node)
        }
      }

      body.scrollTop = scrollTop
    }
  }

  function cardNode(id) {
    return root.querySelector(`.card[data-id="${CSS.escape(id)}"]`)
  }

  /** Brief highlight -- used when a card arrives from someone else. */
  function flash(id) {
    const node = cardNode(id)
    if (!node) return
    node.classList.remove('is-flash')
    void node.offsetWidth // restart the animation
    node.classList.add('is-flash')
  }

  function destroy() {
    hideMenu()
    root.removeEventListener('contextmenu', onContextMenu, true)
    menu.removeEventListener('contextmenu', onMenuContextMenu, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    root.removeEventListener('scroll', hideMenu, true)
    menu.remove()
  }

  return { render, columns, cardNode, flash, hideMenu, destroy }
}

function readHideDone() {
  try {
    return localStorage.getItem(HIDE_DONE_KEY) === '1'
  } catch {
    return false
  }
}

function writeHideDone(value) {
  try {
    localStorage.setItem(HIDE_DONE_KEY, value ? '1' : '0')
  } catch {
    /* private mode */
  }
}
