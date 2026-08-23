import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { installShell, teardownShell, click, type, buttonWithText } from './helpers/shell.js'

/**
 * Boots the real main.js against the real localStorage store.
 *
 * Every other test exercises a module in isolation with its dependencies
 * stubbed, which means none of them would catch a bad import, a handler wired
 * to the wrong element, or an exception during boot. This one would.
 */

async function waitFor(predicate, { timeout = 2000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const cardsIn = (stage) =>
  [...document.querySelectorAll(`.column__body[data-stage="${stage}"] .card`)]

const allCards = () => [...document.querySelectorAll('#board .card')]
const titles = () => allCards().map((c) => c.querySelector('.card__title').textContent)

beforeAll(async () => {
  installShell()
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0))

  await import('../src/main.js')
  await waitFor(() => allCards().length > 0, { label: 'the board to render' })
})

afterAll(() => {
  vi.unstubAllGlobals()
  teardownShell()
  localStorage.clear()
})

describe('boot', () => {
  it('renders the seed board across all four columns', () => {
    expect(cardsIn('problem')).toHaveLength(2)
    expect(cardsIn('idea')).toHaveLength(1)
    expect(cardsIn('progress')).toHaveLength(1)
    expect(cardsIn('done')).toHaveLength(1)
  })

  it('shows the progress readout', () => {
    expect(document.getElementById('progress').textContent).toBe('1 of 5 done')
  })

  it('reports that it is running on this browser only', () => {
    // No VITE_SUPABASE_* in the test env, so it must not claim to be shared.
    expect(document.getElementById('conn').dataset.state).toBe('local')
  })

  it('asks for a name on first visit', () => {
    const modal = document.querySelector('#modal-root .modal')
    expect(modal).toBeTruthy()
    expect(modal.textContent).toMatch(/what should we call you/i)
  })

  it('accepts the name and closes the prompt', async () => {
    const modal = document.querySelector('#modal-root .modal')
    modal.querySelector('input').value = 'Sam Rivera'
    click(buttonWithText(modal, 'Start'))

    await waitFor(() => !document.querySelector('#modal-root .modal'), { label: 'the prompt to close' })
    expect(document.getElementById('identity-name').textContent).toBe('Sam Rivera')
  })

  it('lists the people on the board as filter buttons', () => {
    expect(document.querySelectorAll('#people .people__btn').length).toBeGreaterThan(0)
  })

  it('registers the typed name on the people roster', async () => {
    await waitFor(() => {
      const names = [...document.querySelectorAll('#people .people__btn')].map((b) => b.getAttribute('aria-label') || b.title || '')
      return names.some((n) => /sam rivera/i.test(n))
    }, { label: 'Sam to appear in the people strip' })
  })

  it('switches to the pad without losing the board', () => {
    click(document.getElementById('tab-pad'))
    expect(document.body.dataset.view).toBe('pad')
    expect(document.getElementById('pad').hidden).toBe(false)
    click(document.getElementById('tab-board'))
    expect(document.body.dataset.view).toBe('board')
    expect(cardsIn('problem').length).toBeGreaterThan(0)
  })

  it('opens the sheets tab', () => {
    click(document.getElementById('tab-sheets'))
    expect(document.body.dataset.view).toBe('sheets')
    expect(document.getElementById('sheets').hidden).toBe(false)
    click(document.getElementById('tab-board'))
    expect(document.body.dataset.view).toBe('board')
  })
})

describe('search', () => {
  const search = () => document.getElementById('search')

  it('filters the board as you type', async () => {
    type(search(), 'csv')
    await waitFor(() => allCards().length < 5, { label: 'the board to filter' })

    expect(titles()).toEqual(['Rewrite the CSV parser'])
    expect(document.getElementById('filter-bar').hidden).toBe(false)
  })

  it('reports how many cards are showing', () => {
    expect(document.getElementById('filter-count').textContent).toBe('1 card')
    expect(document.getElementById('progress').textContent).toBe('1 of 5 shown')
  })

  it('shows an empty-state that admits it is filtered', () => {
    const empty = document.querySelector('.column__body[data-stage="done"] .column__empty')
    expect(empty.textContent).toMatch(/nothing matches/i)
  })

  it('understands the tag: prefix', async () => {
    type(search(), 'tag:infra')
    await waitFor(() => allCards().length === 2, { label: 'the tag filter' })
    expect(titles()).toContain('Batch the webhook retries')
  })

  it('restores the whole board when cleared', async () => {
    click(document.getElementById('search-clear'))
    await waitFor(() => allCards().length === 5, { label: 'the board to come back' })
    expect(document.getElementById('filter-bar').hidden).toBe(true)
    expect(search().value).toBe('')
  })
})

describe('creating and editing', () => {
  it('creates a card and opens it', async () => {
    click(document.getElementById('btn-new'))
    await waitFor(() => document.querySelector('#detail-root .drawer'), { label: 'the drawer' })

    expect(cardsIn('problem')).toHaveLength(3)
    expect(document.querySelector('.title-input').value).toBe('')
  })

  it('saves a title typed into the drawer', async () => {
    const title = document.querySelector('.title-input')
    type(title, 'A brand new problem')

    await waitFor(() => titles().includes('A brand new problem'), { label: 'the title to save' })
  })

  it('moves the card with the stage buttons', async () => {
    const picker = document.querySelector('.stage-picker')
    click(buttonWithText(picker, 'Done'))

    await waitFor(() => cardsIn('done').length === 2, { label: 'the card to move' })
    expect(document.getElementById('progress').textContent).toBe('2 of 6 done')
  })

  it('appends a note', async () => {
    const box = document.querySelector('.note-compose textarea')
    type(box, 'Looked at this today')
    click(buttonWithText(document.querySelector('.drawer'), 'Post note'))

    await waitFor(() => document.querySelectorAll('.note').length === 1, { label: 'the note' })
    expect(document.querySelector('.note__author').textContent).toBe('Sam Rivera')
    expect(document.querySelector('.note__text').textContent).toBe('Looked at this today')
  })

  it('survives a reload -- the writes actually persisted', async () => {
    const raw = JSON.parse(localStorage.getItem('board:cards:v1'))
    const saved = raw.find((c) => c.title === 'A brand new problem')

    expect(saved).toBeTruthy()
    expect(saved.status).toBe('done')
    expect(saved.notes).toHaveLength(1)
    expect(saved.notes[0].author).toBe('Sam Rivera')
  })

  it('deletes the card after confirming', async () => {
    const drawer = document.querySelector('.drawer')
    click(buttonWithText(drawer, 'Delete'))
    await waitFor(() => document.querySelector('#modal-root .modal'), { label: 'the confirm dialog' })

    click(buttonWithText(document.querySelector('#modal-root .modal'), 'Delete'))
    await waitFor(() => !titles().includes('A brand new problem'), { label: 'the card to go' })

    expect(allCards()).toHaveLength(5)
  })

  it('offers an undo, and restores the card', async () => {
    const toast = document.querySelector('#toast-root .toast')
    expect(toast.textContent).toMatch(/deleted/i)

    click(buttonWithText(toast, 'Undo'))
    await waitFor(() => titles().includes('A brand new problem'), { label: 'the card to come back' })

    // Restored whole, notes and all -- not as a blank card with the same title.
    const raw = JSON.parse(localStorage.getItem('board:cards:v1'))
    const restored = raw.find((c) => c.title === 'A brand new problem')
    expect(restored.notes).toHaveLength(1)
  })
})

describe('person filter', () => {
  it('filters to one person when their avatar is clicked', async () => {
    const before = allCards().length
    click(document.querySelector('#people .people__btn'))
    await waitFor(() => allCards().length < before, { label: 'the person filter' })

    expect(document.getElementById('filter-bar').hidden).toBe(false)
  })

  it('clears from the filter bar', async () => {
    click(document.getElementById('filter-clear'))
    await waitFor(() => document.getElementById('filter-bar').hidden === true, { label: 'the clear' })
    expect(allCards()).toHaveLength(6)
  })
})
