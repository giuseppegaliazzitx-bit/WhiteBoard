import { h, clear, icon } from './dom.js'
import { renderCard } from './card.js'
import { STAGES } from '../model.js'

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

    const column = h(
      'section',
      { class: 'column', dataset: { stage: stage.id }, style: { '--dot': `var(--stage-${stage.id})` } },
      h(
        'header',
        { class: 'column__head' },
        h('span', { class: 'column__swatch' }),
        h('h2', { class: 'column__name', text: stage.name, title: stage.blurb }),
        count,
        addTop,
      ),
      body,
      h('div', { class: 'column__foot' }, addBottom),
    )

    root.appendChild(column)
    columns.set(stage.id, { column, body, count })
  }

  /**
   * @param {Map<string, object[]>} byStage  stage id -> cards, already sorted and filtered
   * @param {object} opts  { filtering: boolean } -- changes the empty-state copy
   */
  function render(byStage, opts = {}) {
    for (const stage of STAGES) {
      const { body, count } = columns.get(stage.id)
      const cards = byStage.get(stage.id) || []
      const scrollTop = body.scrollTop

      count.textContent = String(cards.length)
      clear(body)

      if (!cards.length) {
        body.appendChild(
          h('p', {
            class: 'column__empty',
            text: opts.filtering ? 'Nothing matches here' : 'Nothing here yet',
          }),
        )
      } else {
        for (const card of cards) {
          const node = renderCard(card, handlers)
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
