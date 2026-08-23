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

  return { render, columns, cardNode, flash }
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
