import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStore } from '../src/store/local.js'
import { runStoreContract } from './helpers/store-contract.js'

const KEY = 'board:cards:v1'

/**
 * Every store attaches a `storage` listener to the shared window. Left open,
 * one test's subscriber fires during the next test -- so all stores made here
 * are tracked and closed between tests.
 */
const open = []
function makeStore(boardId = 'main') {
  const store = createLocalStore({ boardId })
  open.push(store)
  return store
}

beforeEach(() => localStorage.clear())
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
  vi.restoreAllMocks()
})

runStoreContract('localStorage', () => {
  localStorage.clear()
  return makeStore()
})

describe('localStorage adapter specifics', () => {
  it('only lists cards belonging to its own board', async () => {
    const main = makeStore()
    const other = makeStore('other')

    await main.create({ title: 'on main' })
    await other.create({ title: 'on other' })

    expect((await main.list()).map((c) => c.title)).toEqual(['on main'])
    expect((await other.list()).map((c) => c.title)).toEqual(['on other'])
  })

  it('stamps its own board id onto new cards, ignoring a spoofed one', async () => {
    const store = makeStore()
    const card = await store.create({ title: 'A', board: 'somewhere-else' })
    expect(card.board).toBe('main')
  })

  it('survives a corrupt payload instead of wedging the board', async () => {
    localStorage.setItem(KEY, '{not json')
    const store = makeStore()
    expect(await store.list()).toEqual([])
    await expect(store.create({ title: 'A' })).resolves.toBeTruthy()
  })

  it('survives a payload that parses but is the wrong shape', async () => {
    localStorage.setItem(KEY, '{"cards":[]}')
    const store = makeStore()
    expect(await store.list()).toEqual([])
  })

  it('repairs individual malformed rows rather than dropping the board', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'x', board: 'main', title: 'ok', position: 'not-a-number', assignees: 'nope' },
      ]),
    )
    const store = makeStore()
    const [card] = await store.list()
    expect(card.title).toBe('ok')
    expect(card.position).toBe(1000)
    expect(card.assignees).toEqual([])
  })

  it('reports a full quota as an actionable message', async () => {
    const store = makeStore()
    // Spy on the instance, not Storage.prototype: happy-dom's localStorage
    // exposes setItem as an own property, so a prototype spy silently misses.
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('full')
      err.name = 'QuotaExceededError'
      throw err
    })
    await expect(store.create({ title: 'A' })).rejects.toThrow(/storage is full/i)
  })

  it('reports a non-quota write failure without blaming quota', async () => {
    const store = makeStore()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    await expect(store.create({ title: 'A' })).rejects.toThrow(/could not save/i)
  })

  it('degrades to empty rather than throwing when reads are blocked', async () => {
    // Seed real data first, so this cannot pass just because storage is empty.
    const seeded = makeStore()
    await seeded.create({ title: 'A' })
    expect(await seeded.list()).toHaveLength(1)

    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const store = makeStore()
    expect(await store.list()).toEqual([])
  })

  it('notifies subscribers when another tab writes', async () => {
    const store = makeStore()
    const handler = vi.fn()
    store.subscribe(handler)

    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(handler).toHaveBeenCalledTimes(1)

    // An unrelated key must not trigger a board reload.
    window.dispatchEvent(new StorageEvent('storage', { key: 'board:theme' }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('keeps notifying the other subscribers when one throws', async () => {
    const store = makeStore()
    const good = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.subscribe(() => {
      throw new Error('boom')
    })
    store.subscribe(good)

    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('detaches its window listener on close', async () => {
    const store = makeStore()
    const handler = vi.fn()
    store.subscribe(handler)
    await store.close()

    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(handler).not.toHaveBeenCalled()
  })
})
