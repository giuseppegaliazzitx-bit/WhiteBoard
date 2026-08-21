/**
 * Application wiring.
 *
 * Owns the card list, renders the board, and mediates between the store and
 * the views. Every mutation is optimistic: the local copy changes first, the
 * write follows, and a failure rolls the change back and says so. On a board
 * where people drag cards around, a UI that waits for a round trip before
 * moving feels broken.
 */
import { createBoardView } from './ui/board.js'
import { createDragController } from './ui/dnd.js'
import { createDetail } from './ui/detail.js'
import { createIdentity } from './ui/identity.js'
import { initTheme } from './ui/theme.js'
import { toast, errorToast } from './ui/toast.js'
import { h, clear } from './ui/dom.js'
import { createStore } from './store/index.js'
import { groupByStage, peopleFrom, progressOf, tagsFrom } from './selectors.js'
import { STAGE_IDS, getStage, stageIndex } from './model.js'
import {
  sortByPosition,
  positionForIndex,
  positionForAppend,
  positionForPrepend,
  renumberPlan,
} from './position.js'
import { normalizeCard, makeNote, initials, avatarColor, DEFAULT_STAGE } from './model.js'

const SEED = [
  { title: 'Invoices export drops the last row', status: 'problem', tag: 'billing', assignees: ['Sam Rivera'] },
  { title: 'Nobody knows who owns the on-call rota', status: 'problem', tag: 'infra' },
  { title: 'Batch the webhook retries', body: 'Group by endpoint, back off exponentially.', status: 'idea', tag: 'infra', assignees: ['Alex Chen', 'Sam Rivera'] },
  { title: 'Rewrite the CSV parser', status: 'progress', tag: 'billing', assignees: ['Alex Chen'] },
  { title: 'Ship the new landing page', status: 'done', tag: 'web', assignees: ['Jo Park'] },
]

const store = createStore({ boardId: 'main' })
const identity = createIdentity()

/** @type {import('./model.js').Card[]} */
let cards = []

// ------------------------------------------------------------------ helpers

function find(id) {
  return cards.find((c) => c.id === id) || null
}

function columnCards(status, excludeId = null) {
  return sortByPosition(cards.filter((c) => c.status === status && c.id !== excludeId))
}

function replaceCard(next) {
  cards = cards.map((c) => (c.id === next.id ? next : c))
  render()
  detail.update(next)
}

// ------------------------------------------------------------------ mutations

/**
 * Optimistic patch. Applies locally, then persists; on failure the previous
 * card is put back so the UI never shows a state the server rejected.
 */
async function patchCard(id, patch) {
  const before = find(id)
  if (!before) throw new Error('That card no longer exists.')

  replaceCard(normalizeCard({ ...before, ...patch, updated_at: new Date().toISOString() }))

  try {
    const saved = await store.update(id, patch)
    replaceCard(saved)
    return saved
  } catch (err) {
    replaceCard(before)
    throw err
  }
}

async function createCard(status = DEFAULT_STAGE, where = 'top') {
  const column = columnCards(status)
  const position = where === 'top' ? positionForPrepend(column) : positionForAppend(column)

  try {
    const created = await store.create({ title: '', status, position })
    cards = [...cards, created]
    render()
    detail.open(created)
  } catch (err) {
    errorToast(err, 'Could not create the card.')
  }
}

async function deleteCard(card) {
  const before = cards
  cards = cards.filter((c) => c.id !== card.id)
  render()

  try {
    await store.remove(card.id)
  } catch (err) {
    cards = before
    render()
    errorToast(err, 'Could not delete the card.')
    return
  }

  toast(card.title.trim() ? `Deleted "${card.title.trim()}"` : 'Card deleted', {
    actionLabel: 'Undo',
    onAction: async () => {
      try {
        // Recreated with its original id, so any link to it still resolves.
        const restored = await store.create(card)
        cards = [...cards.filter((c) => c.id !== restored.id), restored]
        render()
        view.flash(restored.id)
      } catch (err) {
        errorToast(err, 'Could not restore the card.')
      }
    },
  })
}

/**
 * Land `id` at `index` within `status`. `index` is an index into that column
 * *without* the moved card, which is what both the drop indicator and the
 * keyboard path already produce.
 */
async function moveCard(id, status, index) {
  const card = find(id)
  if (!card) return

  let { position, exhausted } = positionForIndex(columnCards(status, id), index)

  if (exhausted) {
    // ~50 midpoint splits of one gap have used up the float. Spread this
    // column back onto round numbers and recompute against the new spacing.
    await renumberColumn(status)
    ;({ position } = positionForIndex(columnCards(status, id), index))
  }

  if (card.status === status && card.position === position) return

  try {
    await patchCard(id, { status, position })
    announce(`Moved to ${getStage(status).name}, position ${index + 1}`)
  } catch (err) {
    errorToast(err, 'Could not move the card.')
  }
}

async function renumberColumn(status) {
  const plan = renumberPlan(cards.filter((c) => c.status === status))
  for (const { id, position } of plan) {
    await patchCard(id, { position })
  }
}

/** Nudge a card one slot within its column, or one column sideways. */
async function nudgeCard(id, dx, dy) {
  const card = find(id)
  if (!card) return

  if (dx !== 0) {
    const next = STAGE_IDS[stageIndex(card.status) + dx]
    if (!next) return
    await moveCard(id, next, columnCards(next, id).length)
  } else {
    const column = columnCards(card.status)
    const from = column.findIndex((c) => c.id === id)
    const to = from + dy
    if (to < 0 || to >= column.length) return
    await moveCard(id, card.status, to)
  }

  // The board re-rendered, so the focused node was replaced.
  view.cardNode(id)?.focus()
}

// ------------------------------------------------------------------ views

const view = createBoardView(document.getElementById('board'), {
  onOpen: (id) => {
    // The drag controller swallows the click that follows a drop; this is the
    // second line of defence so a drop can never also open the card.
    if (drag.isDragging) return
    const card = find(id)
    if (card) detail.open(card)
  },
  onAdd: (status, where) => createCard(status, where),
})

const detail = createDetail({
  identity,
  onPatch: patchCard,
  onDelete: deleteCard,
  onError: (err) => errorToast(err),
  makeNote: (text) => makeNote(identity.name, text),
  getPeople: () => peopleFrom(cards),
  getTags: () => tagsFrom(cards),
  /** Cards moved by the stage buttons land at the bottom of their new column. */
  positionForStage: (status, movingId) => positionForAppend(columnCards(status, movingId)),
})

const drag = createDragController({
  root: document.getElementById('board'),
  layer: document.getElementById('drag-layer'),
  onMove: (id, status, index) => moveCard(id, status, index),
})

// ------------------------------------------------------------------ chrome

const liveEl = document.getElementById('live')
const progressEl = document.getElementById('progress')

/** Screen-reader announcement for changes with no visible text equivalent. */
function announce(message) {
  liveEl.textContent = ''
  // A same-text update is not re-announced; the empty tick forces it.
  requestAnimationFrame(() => {
    liveEl.textContent = message
  })
}
const identityName = document.getElementById('identity-name')
const identityAvatar = document.getElementById('identity-avatar')

function renderIdentity() {
  const name = identity.name
  identityName.textContent = name
  // Mutate the existing node rather than replacing it -- replaceWith would
  // leave this module holding a reference to a detached element.
  identityAvatar.textContent = initials(name)
  identityAvatar.style.setProperty('--av', avatarColor(name))
  identityAvatar.title = name
}

function render() {
  view.render(groupByStage(cards))

  const { done, total } = progressOf(cards)
  progressEl.textContent = total ? `${done} of ${total} done` : ''
}

async function refresh() {
  cards = await store.list()
  render()

  // Keep an open drawer in step with what just arrived.
  if (detail.currentId) {
    const card = find(detail.currentId)
    if (card) detail.update(card)
    else detail.notifyRemoved(detail.currentId)
  }
}

// ------------------------------------------------------------------ events

initTheme(document.getElementById('btn-theme'))

document.getElementById('btn-new').addEventListener('click', () => createCard(DEFAULT_STAGE, 'top'))

document.getElementById('btn-identity').addEventListener('click', async () => {
  await identity.change()
})

identity.onChange(() => {
  renderIdentity()
  // Suggestions and note ownership both key off the name.
  if (detail.currentId) {
    const card = find(detail.currentId)
    if (card) detail.update(card)
  }
})

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
  if (typing) return

  // Ctrl/Cmd + arrows move the focused card. Dragging is a pointer gesture,
  // so without this there would be no keyboard way to reorder a column.
  const focusedCard = e.target.closest?.('.card')
  if (focusedCard && (e.metaKey || e.ctrlKey)) {
    const delta = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }[e.key]
    if (delta) {
      e.preventDefault()
      nudgeCard(focusedCard.dataset.id, delta[0], delta[1])
      return
    }
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === 'n') {
    e.preventDefault()
    createCard(DEFAULT_STAGE, 'top')
  }
})

// A tab that was in the background may have missed writes from another tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh().catch(console.error)
})

store.subscribe(() => refresh().catch(console.error))

// ------------------------------------------------------------------ boot

async function boot() {
  renderIdentity()
  await refresh()

  if (!cards.length) {
    for (const [i, seed] of SEED.entries()) {
      await store.create({ ...seed, position: (i + 1) * 1000 })
    }
    await refresh()
  }

  await identity.ensure()
  renderIdentity()
}

boot().catch((err) => {
  console.error(err)
  const board = document.getElementById('board')
  clear(board)
  board.appendChild(
    h(
      'div',
      { class: 'fatal' },
      h('h2', { text: 'The board could not load' }),
      h('p', { text: 'The page will need a reload once this is sorted out.' }),
      h('pre', { text: String(err?.message || err) }),
    ),
  )
})
