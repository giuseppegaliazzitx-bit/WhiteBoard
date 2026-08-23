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
import { createPadView } from './ui/pad.js'
import { initTheme } from './ui/theme.js'
import { toast, errorToast } from './ui/toast.js'
import { h, clear, icon } from './ui/dom.js'
import { avatar } from './ui/card.js'
import { plural } from './ui/format.js'
import { createStore } from './store/index.js'
import { createSync } from './sync.js'
import { groupByStage, peopleFrom, progressOf, tagsFrom } from './selectors.js'
import { applyFilters, isFiltering, describeFilters, removeFromQuery } from './filters.js'
import { STAGE_IDS, getStage, stageIndex } from './model.js'
import {
  sortByPosition,
  positionForIndex,
  positionForAppend,
  positionForPrepend,
  renumberPlan,
} from './position.js'
import {
  normalizeCard,
  makeNote,
  initials,
  avatarColor,
  personKey,
  DEFAULT_STAGE,
} from './model.js'
import { config } from './config.js'

const SEED = [
  { title: 'Invoices export drops the last row', status: 'problem', tag: 'billing', assignees: ['Sam Rivera'] },
  { title: 'Nobody knows who owns the on-call rota', status: 'problem', tag: 'infra' },
  { title: 'Batch the webhook retries', body: 'Group by endpoint, back off exponentially.', status: 'idea', tag: 'infra', assignees: ['Alex Chen', 'Sam Rivera'] },
  { title: 'Rewrite the CSV parser', status: 'progress', tag: 'billing', assignees: ['Alex Chen'] },
  { title: 'Ship the new landing page', status: 'done', tag: 'web', assignees: ['Jo Park'] },
]

const identity = createIdentity()

/** Assigned during boot -- createStore is async so supabase-js stays lazy. */
let store = null
let sync = null

/** Card ids already rendered, so arrivals from other people can be flashed. */
let seenIds = null

/** @type {import('./model.js').Card[]} */
let cards = []

/** @type {import('./model.js').Person[]} */
let people = []

/** @type {import('./canvas-model.js').CanvasObject[]} */
let padObjects = []

let currentView = 'board'

/** Active filters. `people` holds full names; the query holds everything else. */
const filters = { query: '', people: [] }

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
  getPeople: () => peopleFrom(cards, people),
  getTags: () => tagsFrom(cards),
  /** Cards moved by the stage buttons land at the bottom of their new column. */
  positionForStage: (status, movingId) => positionForAppend(columnCards(status, movingId)),
})

const drag = createDragController({
  root: document.getElementById('board'),
  layer: document.getElementById('drag-layer'),
  onMove: (id, status, index) => moveCard(id, status, index),
})

const pad = createPadView(document.getElementById('pad'), {
  onCreate: createPadObject,
  onPatch: patchPadObject,
  onRemove: removePadObject,
  onError: (err) => errorToast(err),
})

async function createPadObject(patch) {
  try {
    const created = await store.createCanvasObject(patch)
    padObjects = [...padObjects, created]
    pad.render(padObjects)
    if (created.kind === 'sticky' || created.kind === 'text') pad.focusLast(created.kind)
    return created
  } catch (err) {
    errorToast(err, 'Could not add that to the pad.')
  }
}

async function patchPadObject(id, patch) {
  const before = padObjects.find((o) => o.id === id)
  if (!before) return
  const next = { ...before, ...patch, data: patch.data ? { ...before.data, ...patch.data } : before.data }
  padObjects = padObjects.map((o) => (o.id === id ? next : o))
  pad.render(padObjects)
  try {
    const saved = await store.updateCanvasObject(id, { ...patch, kind: before.kind })
    padObjects = padObjects.map((o) => (o.id === id ? saved : o))
    pad.render(padObjects)
  } catch (err) {
    padObjects = padObjects.map((o) => (o.id === id ? before : o))
    pad.render(padObjects)
    errorToast(err, 'Could not save the pad.')
  }
}

async function removePadObject(id) {
  const before = padObjects
  padObjects = padObjects.filter((o) => o.id !== id)
  pad.render(padObjects)
  try {
    await store.removeCanvasObject(id)
  } catch (err) {
    padObjects = before
    pad.render(padObjects)
    errorToast(err, 'Could not delete that.')
  }
}

function setView(name) {
  currentView = name === 'pad' ? 'pad' : 'board'
  document.body.dataset.view = currentView
  document.getElementById('board').hidden = currentView !== 'board'
  document.getElementById('pad').hidden = currentView !== 'pad'
  const boardTab = document.getElementById('tab-board')
  const padTab = document.getElementById('tab-pad')
  if (boardTab) boardTab.setAttribute('aria-selected', String(currentView === 'board'))
  if (padTab) padTab.setAttribute('aria-selected', String(currentView === 'pad'))
  if (currentView === 'pad') history.replaceState(null, '', '#pad')
  else history.replaceState(null, '', '#board')
}

// ------------------------------------------------------------------ chrome

const liveEl = document.getElementById('live')
const progressEl = document.getElementById('progress')
const peopleEl = document.getElementById('people')
const searchEl = document.getElementById('search')
const searchClear = document.getElementById('search-clear')
const filterBar = document.getElementById('filter-bar')
const filterChips = document.getElementById('filter-chips')
const filterCount = document.getElementById('filter-count')

const connEl = document.getElementById('conn')

const CONNECTION_LABEL = {
  live: 'Live',
  polling: 'Syncing',
  offline: 'Offline',
  local: 'This browser only',
}

function setConnection(state) {
  connEl.dataset.state = state
  connEl.querySelector('.conn__label').textContent = CONNECTION_LABEL[state] || ''
  connEl.title =
    state === 'local'
      ? 'No Supabase connection configured — cards are stored in this browser only.'
      : `Realtime: ${CONNECTION_LABEL[state]}`
}

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
  const filtering = isFiltering(filters)
  const shown = applyFilters(cards, filters)

  view.render(groupByStage(shown), { filtering })
  renderPeople()
  renderFilterBar(shown, filtering)
  renderProgress(shown, filtering)
  pad.render(padObjects)
}

function renderProgress(shown, filtering) {
  const { done, total } = progressOf(cards)
  if (!total) {
    progressEl.textContent = ''
    return
  }
  progressEl.textContent = filtering
    ? `${shown.length} of ${total} shown`
    : `${done} of ${total} done`
  progressEl.title = `${done} done, ${total - done} still open`
}

const MAX_PEOPLE_SHOWN = 5

function renderPeople() {
  const roster = peopleFrom(cards, people)
  clear(peopleEl)

  for (const person of roster.slice(0, MAX_PEOPLE_SHOWN)) {
    const active = filters.people.some((n) => personKey(n) === personKey(person.name))
    const chip = avatar(person.name, 'avatar--sm')
    chip.removeAttribute('title')

    peopleEl.appendChild(
      h(
        'button',
        {
          class: 'people__btn',
          type: 'button',
          'aria-pressed': String(active),
          title: person.count
            ? `${person.name} — ${plural(person.count, 'card')}`
            : `${person.name} — on the board`,
          'aria-label': `${active ? 'Stop filtering by' : 'Filter by'} ${person.name}`,
          onclick: () => togglePerson(person.name),
        },
        chip,
      ),
    )
  }

  if (roster.length > MAX_PEOPLE_SHOWN) {
    peopleEl.appendChild(
      h('span', {
        class: 'people__more',
        text: `+${roster.length - MAX_PEOPLE_SHOWN}`,
        title: roster.slice(MAX_PEOPLE_SHOWN).map((p) => p.name).join(', '),
      }),
    )
  }
}

function renderFilterBar(shown, filtering) {
  filterBar.hidden = !filtering
  if (!filtering) return

  clear(filterChips)
  for (const chip of describeFilters(filters)) {
    filterChips.appendChild(
      h(
        'span',
        { class: 'filter-chip' },
        h('span', { text: chip.label }),
        h(
          'button',
          { type: 'button', 'aria-label': `Remove filter ${chip.label}`, onclick: () => removeChip(chip) },
          icon('x'),
        ),
      ),
    )
  }

  filterCount.textContent = `${plural(shown.length, 'card')}`
}

// ------------------------------------------------------------------ filtering

function setQuery(value, { syncInput = false } = {}) {
  filters.query = value
  if (syncInput) searchEl.value = value
  searchClear.hidden = !searchEl.value
  render()
}

function togglePerson(name) {
  const key = personKey(name)
  const index = filters.people.findIndex((n) => personKey(n) === key)
  if (index === -1) filters.people.push(name)
  else filters.people.splice(index, 1)
  render()
}

function removeChip(chip) {
  if (chip.kind === 'person') togglePerson(chip.value)
  else setQuery(removeFromQuery(filters.query, chip), { syncInput: true })
}

function clearFilters() {
  filters.people = []
  setQuery('', { syncInput: true })
}

async function refresh() {
  cards = await store.list()
  try {
    people = await store.listPeople()
  } catch {
    people = []
  }
  try {
    padObjects = await store.listCanvas()
  } catch {
    padObjects = []
  }
  render()

  // Highlight cards that appeared since the last read. Skipped on the first
  // read, when everything is new and the whole board would flash.
  if (seenIds) {
    for (const card of cards) {
      if (!seenIds.has(card.id)) view.flash(card.id)
    }
  }
  seenIds = new Set(cards.map((c) => c.id))

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

// Typing filters live. Debounced so a long query does not re-render the whole
// board on every keystroke.
let searchTimer = null
searchEl.addEventListener('input', () => {
  searchClear.hidden = !searchEl.value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setQuery(searchEl.value), 120)
})

searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (searchEl.value) clearFilters()
    else searchEl.blur()
  }
})

searchClear.addEventListener('click', () => {
  clearTimeout(searchTimer)
  setQuery('', { syncInput: true })
  searchEl.focus()
})

document.getElementById('filter-clear').addEventListener('click', () => {
  clearFilters()
  searchEl.focus()
})

document.getElementById('btn-identity').addEventListener('click', async () => {
  await identity.change()
})

identity.onChange((name) => {
  renderIdentity()
  registerPerson(name)
  // Suggestions and note ownership both key off the name.
  if (detail.currentId) {
    const card = find(detail.currentId)
    if (card) detail.update(card)
  }
})

document.getElementById('tab-board')?.addEventListener('click', () => setView('board'))
document.getElementById('tab-pad')?.addEventListener('click', () => setView('pad'))
window.addEventListener('hashchange', () => {
  setView(location.hash === '#pad' ? 'pad' : 'board')
})

async function registerPerson(name) {
  if (!store || !name || name === 'Anonymous') return
  try {
    const person = await store.upsertPerson({ name })
    if (!people.some((p) => personKey(p.name) === personKey(person.name))) {
      people = [...people, person]
      render()
    }
  } catch (err) {
    // Older databases without the people table still run the board.
    console.warn('[people]', err)
  }
}

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

  if (e.key === 'n' && currentView === 'board') {
    e.preventDefault()
    createCard(DEFAULT_STAGE, 'top')
  } else if (e.key === '/') {
    e.preventDefault()
    searchEl.focus()
    searchEl.select()
  } else if (e.key === 'Escape' && isFiltering(filters)) {
    e.preventDefault()
    clearFilters()
  }
})

// ------------------------------------------------------------------ boot

async function boot() {
  renderIdentity()

  // Misconfiguration is loud rather than a silent fall back to a private
  // board that looks shared until someone else opens it.
  for (const problem of config.problems) {
    errorToast(new Error(problem))
    console.error(`[config] ${problem}`)
  }

  store = await createStore()
  await refresh()

  // Realtime, poll fallback, wake-on-visible and offline handling all live in
  // the sync controller so main.js does not accumulate timers.
  sync = createSync({ store, refresh, setState: setConnection })

  // Seed only a brand-new local board. A shared board that is genuinely empty
  // should stay empty rather than filling up with someone else's examples.
  if (!cards.length && store.mode === 'local') {
    for (const [i, seed] of SEED.entries()) {
      await store.create({ ...seed, position: (i + 1) * 1000 })
    }
    await refresh()
  }

  await identity.ensure()
  renderIdentity()
  await registerPerson(identity.name)
  setView(location.hash === '#pad' ? 'pad' : 'board')
}

// Release the realtime channel promptly rather than waiting for a socket timeout.
window.addEventListener('pagehide', () => {
  sync?.destroy()
  store?.close?.()
})

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
