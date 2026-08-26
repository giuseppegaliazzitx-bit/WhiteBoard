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
import { createSheetsView } from './ui/sheets.js'
import { initTheme } from './ui/theme.js'
import { toast, errorToast } from './ui/toast.js'
import { confirmDialog } from './ui/modal.js'
import { h, clear, icon } from './ui/dom.js'
import { avatar } from './ui/card.js'
import { plural } from './ui/format.js'
import { createStore } from './store/index.js'
import { createSync } from './sync.js'
import { groupByStage, peopleFrom, progressOf, tagsFrom } from './selectors.js'
import { applyFilters, isFiltering, describeFilters, removeFromQuery, parseQuery } from './filters.js'
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
import { createUndoStack } from './undo.js'

const VIEWS = ['board', 'whiteboard', 'notepad']
const VIEW_EL = { board: 'board', whiteboard: 'pad', notepad: 'sheets' }
const VIEW_ALIAS = { pad: 'whiteboard', sheets: 'notepad' }

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

/** @type {import('./sheet-model.js').Sheet[]} */
let sheets = []

let currentView = 'board'

const padUndo = createUndoStack()
const sheetsUndo = createUndoStack()

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
    openCard(created)
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
    if (card) openCard(card)
  },
  onAdd: (status, where) => createCard(status, where),
  onAdvance: (id) => {
    const card = find(id)
    if (!card) return
    const next = STAGE_IDS[stageIndex(card.status) + 1]
    if (!next) return
    moveCard(id, next, columnCards(next, id).length)
  },
  onClaim: (id) => claimCard(id),
  onFilterTag: (tag) => toggleQueryToken('tag', String(tag).toLowerCase(), `tag:${String(tag).toLowerCase()}`),
  onFilterStale: () => toggleQueryToken('flag', 'stale', 'is:stale'),
  getMe: () => (identity.isDefault ? '' : identity.name),
  onHideDone: () => render(),
  onMoveTo: (id, status) => {
    const card = find(id)
    if (!card || card.status === status) return
    moveCard(id, status, columnCards(status, id).length)
  },
  onDelete: async (id) => {
    const card = find(id)
    if (!card) return
    const ok = await confirmDialog({
      title: 'Delete this card?',
      body: card.title.trim()
        ? `"${card.title.trim()}" and its ${plural(card.notes.length, 'note')} will be removed.`
        : 'This untitled card will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    if (detail.currentId === id) detail.close()
    await deleteCard(card)
  },
})

const detail = createDetail({
  identity,
  onPatch: patchCard,
  onDelete: deleteCard,
  onError: (err) => errorToast(err),
  onClose: () => {
    if (parseHash().cardId) replaceHash(`#${currentView}`)
  },
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

const noopView = { render() {}, focusLast() {}, get currentId() { return null }, flush() {}, focusTitle() {}, focusBody() {} }

function mountView(id, factory) {
  const el = document.getElementById(id)
  if (!el) {
    console.warn(`[board] #${id} is missing from the page — that view will stay off.`)
    return noopView
  }
  try {
    return factory(el)
  } catch (err) {
    console.error(`[board] ${id} failed to start`, err)
    return noopView
  }
}

const pad = mountView('pad', (el) =>
  createPadView(el, {
    onCreate: createPadObject,
    onPatch: patchPadObject,
    onRemove: removePadObject,
    onRemoveMany: removePadObjects,
    onError: (err) => errorToast(err),
  }),
)

async function createPadObject(patch, { record = true } = {}) {
  try {
    const created = await store.createCanvasObject(patch)
    padObjects = [...padObjects, created]
    pad.render(padObjects)
    if (created.kind === 'sticky' || created.kind === 'text') pad.focusLast(created.kind)
    if (record) {
      const id = created.id
      padUndo.push(() => removePadObject(id, { record: false }))
    }
    return created
  } catch (err) {
    errorToast(err, 'Could not add that to the pad.')
  }
}

async function patchPadObject(id, patch, { record = true } = {}) {
  const before = padObjects.find((o) => o.id === id)
  if (!before) return
  if (record) {
    const snapshot = { x: before.x, y: before.y, w: before.w, h: before.h, data: { ...before.data } }
    padUndo.push(() => patchPadObject(id, snapshot, { record: false }))
  }
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

async function removePadObject(id, { record = true } = {}) {
  const removed = padObjects.find((o) => o.id === id)
  const before = padObjects
  padObjects = padObjects.filter((o) => o.id !== id)
  pad.render(padObjects)
  try {
    await store.removeCanvasObject(id)
  } catch (err) {
    padObjects = before
    pad.render(padObjects)
    errorToast(err, 'Could not delete that.')
    return
  }
  if (record && removed) {
    padUndo.push(() => createPadObject(removed, { record: false }))
  }
}

async function removePadObjects(ids, { record = true } = {}) {
  const unique = [...new Set(ids)].filter(Boolean)
  if (!unique.length) return
  if (unique.length === 1) {
    await removePadObject(unique[0], { record })
    return
  }
  const removed = unique.map((id) => padObjects.find((o) => o.id === id)).filter(Boolean)
  const before = padObjects
  padObjects = padObjects.filter((o) => !unique.includes(o.id))
  pad.render(padObjects)
  try {
    for (const id of unique) await store.removeCanvasObject(id)
  } catch (err) {
    padObjects = before
    pad.render(padObjects)
    errorToast(err, 'Could not delete that.')
    return
  }
  if (record && removed.length) {
    padUndo.push(async () => {
      for (const obj of removed) await createPadObject(obj, { record: false })
    })
  }
}

const sheetsView = mountView('sheets', (el) =>
  createSheetsView(el, {
    onCreate: () => createSheet(),
    onPatch: patchSheet,
    onRemove: deleteSheet,
  }),
)

async function createSheet(patch = {}, { record = true } = {}) {
  try {
    const created = await store.createSheet({
      title: '',
      body: '',
      position: positionForAppend(sortByPosition(sheets)),
      ...patch,
    })
    sheets = [...sheets, created]
    sheetsView.render(sortByPosition(sheets), { selectId: created.id })
    sheetsView.focusTitle()
    if (record) {
      const id = created.id
      sheetsUndo.push(() => deleteSheet(id, { record: false, confirm: false }))
    }
    return created
  } catch (err) {
    errorToast(err, 'Could not create the notepad.')
  }
}

async function patchSheet(id, patch, { record = true } = {}) {
  const before = sheets.find((s) => s.id === id)
  if (!before) return
  if (record) {
    const snapshot = { title: before.title, body: before.body }
    sheetsUndo.push(() => patchSheet(id, snapshot, { record: false }))
  }
  const next = { ...before, ...patch }
  sheets = sheets.map((s) => (s.id === id ? next : s))
  sheetsView.render(sortByPosition(sheets), { selectId: id })
  try {
    const saved = await store.updateSheet(id, patch)
    sheets = sheets.map((s) => (s.id === id ? saved : s))
    sheetsView.render(sortByPosition(sheets), { selectId: id })
  } catch (err) {
    sheets = sheets.map((s) => (s.id === id ? before : s))
    sheetsView.render(sortByPosition(sheets), { selectId: id })
    errorToast(err, 'Could not save the notepad.')
  }
}

async function deleteSheet(id, { record = true, confirm = true } = {}) {
  const removed = sheets.find((s) => s.id === id)
  if (!removed) return
  if (confirm) {
    const ok = await confirmDialog({
      title: 'Delete this notepad?',
      body: removed.title.trim()
        ? `"${removed.title.trim()}" will be removed.`
        : 'This untitled notepad will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
  }
  const before = sheets
  sheets = sheets.filter((s) => s.id !== id)
  sheetsView.render(sortByPosition(sheets))
  try {
    await store.removeSheet(id)
  } catch (err) {
    sheets = before
    sheetsView.render(sortByPosition(sheets), { selectId: id })
    errorToast(err, 'Could not delete the notepad.')
    return
  }
  if (record) {
    sheetsUndo.push(() => createSheet(removed, { record: false }))
  }
}

function parseHash(raw = location.hash) {
  const value = String(raw || '').replace(/^#/, '')
  const cardMatch = value.match(/^c\/([^/]+)$/)
  if (cardMatch) return { view: 'board', cardId: decodeURIComponent(cardMatch[1]) }
  const view = VIEWS.includes(value) ? value : VIEW_ALIAS[value] || 'board'
  return { view, cardId: null }
}

function replaceHash(hash) {
  if (location.hash === hash) return
  try {
    history.replaceState(null, '', hash)
  } catch {
    /* ignore: some embedded previews block history */
  }
}

function openCard(card, opts) {
  detail.open(card, opts)
  if (currentView !== 'board') setView('board')
  replaceHash(`#c/${encodeURIComponent(card.id)}`)
}

async function claimCard(id) {
  const card = find(id)
  const name = identity.name
  if (!card || identity.isDefault || !name) return
  if (card.assignees.some((a) => personKey(a) === personKey(name))) return
  try {
    await patchCard(id, { assignees: [...card.assignees, name] })
    announce(card.assignees.length ? `Joined "${card.title.trim() || 'Untitled'}"` : `Took "${card.title.trim() || 'Untitled'}"`)
  } catch (err) {
    errorToast(err, 'Could not take the card.')
  }
}

function setView(name) {
  const next = VIEWS.includes(name) ? name : VIEW_ALIAS[name] || 'board'
  currentView = next
  document.body.dataset.view = currentView
  for (const viewName of VIEWS) {
    const el = document.getElementById(VIEW_EL[viewName])
    if (el) el.hidden = viewName !== currentView
    document.getElementById(`tab-${viewName}`)?.setAttribute('aria-selected', String(currentView === viewName))
  }
  const hash = detail.currentId && next === 'board' ? `#c/${encodeURIComponent(detail.currentId)}` : `#${currentView}`
  replaceHash(hash)
  if (next !== 'board') view.hideMenu?.()
  if (next === 'notepad') {
    if (store && !sheets.length) createSheet({ record: false })
    else sheetsView.focusBody?.()
  }
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
  sheetsView.render(sortByPosition(sheets))
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

function queryHas(kind, value) {
  const parsed = parseQuery(filters.query)
  if (kind === 'flag') return parsed.flags.includes(value)
  if (kind === 'tag') return parsed.tags.includes(value)
  return false
}

function flagChip(label, flag, title) {
  return h('button', {
    class: 'people__chip',
    type: 'button',
    'aria-pressed': String(queryHas('flag', flag)),
    title,
    text: label,
    onclick: () => toggleQueryToken('flag', flag, `is:${flag}`),
  })
}

function renderPeople() {
  const roster = peopleFrom(cards, people)
  clear(peopleEl)

  if (!identity.isDefault) {
    const mineOn = filters.people.some((n) => personKey(n) === personKey(identity.name))
    peopleEl.appendChild(
      h('button', {
        class: 'people__chip',
        type: 'button',
        'aria-pressed': String(mineOn),
        title: 'Show cards assigned to you',
        text: 'Mine',
        onclick: () => togglePerson(identity.name),
      }),
    )
  }

  peopleEl.appendChild(flagChip('Free', 'unassigned', 'Cards with nobody on them'))
  peopleEl.appendChild(flagChip('Stale', 'stale', 'Open cards sitting idle'))

  let firstAvatar = true
  for (const person of roster.slice(0, MAX_PEOPLE_SHOWN)) {
    const active = filters.people.some((n) => personKey(n) === personKey(person.name))
    const chip = avatar(person.name, 'avatar--sm')
    chip.removeAttribute('title')

    peopleEl.appendChild(
      h(
        'button',
        {
          class: `people__btn${firstAvatar ? ' people__btn--lead' : ''}`,
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
    firstAvatar = false
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

function toggleQueryToken(kind, value, token) {
  if (queryHas(kind, value)) setQuery(removeFromQuery(filters.query, { kind, value }), { syncInput: true })
  else setQuery(`${filters.query} ${token}`.trim(), { syncInput: true })
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
  try {
    sheets = await store.listSheets()
  } catch {
    sheets = []
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

document.getElementById('btn-new')?.addEventListener('click', () => createCard(DEFAULT_STAGE, 'top'))

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
  render()
  // Suggestions and note ownership both key off the name.
  if (detail.currentId) {
    const card = find(detail.currentId)
    if (card) detail.update(card)
  }
})

document.getElementById('tab-board')?.addEventListener('click', () => setView('board'))
document.getElementById('tab-whiteboard')?.addEventListener('click', () => setView('whiteboard'))
document.getElementById('tab-notepad')?.addEventListener('click', () => setView('notepad'))
window.addEventListener('hashchange', () => {
  const loc = parseHash()
  if (loc.view !== currentView) setView(loc.view)
  if (loc.cardId) {
    if (detail.currentId !== loc.cardId) {
      const card = find(loc.cardId)
      if (card) openCard(card)
    }
  } else if (detail.currentId) {
    detail.close()
  }
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

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    if (currentView === 'whiteboard') padUndo.undo()
    else if (currentView === 'notepad') sheetsUndo.undo()
    return
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === 'n' && currentView === 'board') {
    e.preventDefault()
    createCard(DEFAULT_STAGE, 'top')
  } else if (e.key === 't' && currentView === 'board' && focusedCard) {
    e.preventDefault()
    claimCard(focusedCard.dataset.id)
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
  const loc = parseHash()
  setView(loc.view)
  if (loc.cardId) {
    const card = find(loc.cardId)
    if (card) openCard(card)
  }
}

// Release the realtime channel promptly rather than waiting for a socket timeout.
window.addEventListener('pagehide', () => {
  sync?.destroy()
  store?.close?.()
})

boot().catch((err) => {
  console.error(err)
  const board = document.getElementById('board')
  if (!board) return
  setView('board')
  board.hidden = false
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
