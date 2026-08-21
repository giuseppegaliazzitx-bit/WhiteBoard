/**
 * Phase 2: the board reads and writes through the store interface.
 * Card CRUD and the detail panel arrive in phase 3; for now the handlers only
 * prove the wiring.
 */
import { createBoardView } from './ui/board.js'
import { initTheme } from './ui/theme.js'
import { createStore } from './store/index.js'
import { sortByPosition, positionForAppend, positionForPrepend } from './position.js'
import { STAGES, DONE_STAGE } from './model.js'

const SEED = [
  { title: 'Invoices export drops the last row', status: 'problem', tag: 'billing', assignees: ['Sam Rivera'] },
  { title: 'Nobody knows who owns the on-call rota', status: 'problem', tag: 'infra' },
  { title: 'Batch the webhook retries', body: 'Group by endpoint, back off exponentially.', status: 'idea', tag: 'infra', assignees: ['Alex Chen', 'Sam Rivera'] },
  { title: 'Rewrite the CSV parser', status: 'progress', tag: 'billing', assignees: ['Alex Chen'] },
  { title: 'Ship the new landing page', status: 'done', tag: 'web', assignees: ['Jo Park'] },
]

const store = createStore({ boardId: 'main' })
let cards = []

initTheme(document.getElementById('btn-theme'))

const view = createBoardView(document.getElementById('board'), {
  onOpen: (id) => console.log('open card', id),
  onAdd: async (status, where) => {
    const column = cardsIn(status)
    await store.create({
      title: '',
      status,
      position: where === 'top' ? positionForPrepend(column) : positionForAppend(column),
    })
    await refresh()
  },
})

function cardsIn(status) {
  return sortByPosition(cards.filter((c) => c.status === status))
}

function render() {
  const byStage = new Map(STAGES.map((s) => [s.id, []]))
  for (const card of cards) byStage.get(card.status)?.push(card)
  for (const [id, list] of byStage) byStage.set(id, sortByPosition(list))

  view.render(byStage)

  const done = cards.filter((c) => c.status === DONE_STAGE).length
  document.getElementById('progress').textContent = cards.length
    ? `${done} of ${cards.length} done`
    : ''
}

async function refresh() {
  cards = await store.list()
  render()
}

// Other tabs write through the same key; reload when they do.
store.subscribe(refresh)

// Boot lives in a function rather than using top-level await: TLA would force
// the build target up to esnext and drop Safari 14 and friends for no gain.
async function boot() {
  await refresh()
  if (!cards.length) {
    for (const [i, seed] of SEED.entries()) {
      await store.create({ ...seed, position: (i + 1) * 1000 })
    }
    await refresh()
  }
}

boot().catch((err) => {
  console.error(err)
  document.getElementById('board').textContent = 'Could not load the board.'
})
