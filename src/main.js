/**
 * Phase 1: static layout only.
 * Four columns rendered from a hardcoded fixture so the visual design can be
 * checked before any storage exists. Replaced in phase 2 by the store.
 */
import { createBoardView } from './ui/board.js'
import { initTheme } from './ui/theme.js'
import { normalizeCard, STAGES } from './model.js'

const FIXTURE = [
  { id: 'a', title: 'Invoices export drops the last row', status: 'problem', tag: 'billing',
    assignees: ['Sam Rivera'], position: 1000,
    notes: [{ id: 'n1', author: 'Sam Rivera', text: 'Reproduced on staging.', at: new Date().toISOString() }] },
  { id: 'b', title: 'Nobody knows who owns the on-call rota', status: 'problem', tag: 'infra', position: 2000 },
  { id: 'c', title: 'Batch the webhook retries', body: 'Group by endpoint, back off exponentially.',
    status: 'idea', tag: 'infra', assignees: ['Alex Chen', 'Sam Rivera'], position: 1000 },
  { id: 'd', title: 'Move the changelog into the app', status: 'idea', position: 2000 },
  { id: 'e', title: 'Rewrite the CSV parser', status: 'progress', tag: 'billing',
    assignees: ['Alex Chen'], position: 1000 },
  { id: 'f', title: 'Ship the new landing page', status: 'done', tag: 'web',
    assignees: ['Jo Park'], position: 1000 },
].map(normalizeCard)

const boardRoot = document.getElementById('board')

initTheme(document.getElementById('btn-theme'))

const view = createBoardView(boardRoot, {
  onOpen: (id) => console.log('open card', id),
  onAdd: (stage, where) => console.log('add card', stage, where),
})

const byStage = new Map(STAGES.map((s) => [s.id, []]))
for (const card of FIXTURE) byStage.get(card.status).push(card)
for (const list of byStage.values()) list.sort((a, b) => a.position - b.position)

view.render(byStage)

document.getElementById('progress').textContent =
  `${FIXTURE.filter((c) => c.status === 'done').length} of ${FIXTURE.length} done`
