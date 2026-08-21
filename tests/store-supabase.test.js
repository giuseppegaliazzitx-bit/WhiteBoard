import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSupabaseStore } from '../src/store/supabase.js'
import { createFakeSupabase } from './helpers/fake-supabase.js'
import { runStoreContract } from './helpers/store-contract.js'

/**
 * The same contract the localStorage adapter passes. If these two ever diverge,
 * the claim that the UI cannot tell them apart is no longer true.
 */
runStoreContract('supabase', () => {
  const { client } = createFakeSupabase()
  return createSupabaseStore({ client, boardId: 'main' })
})

function setup(opts) {
  const fake = createFakeSupabase(opts)
  const store = createSupabaseStore({ client: fake.client, boardId: 'main' })
  return { fake, store }
}

afterEach(() => vi.restoreAllMocks())

describe('supabase adapter specifics', () => {
  it('scopes reads to its own board', async () => {
    const { fake, store } = setup({
      rows: [
        { id: 'a', board: 'main', title: 'mine', status: 'idea', position: 1000, assignees: [], notes: [] },
        { id: 'b', board: 'other', title: 'theirs', status: 'idea', position: 1000, assignees: [], notes: [] },
      ],
    })
    expect(fake.rows).toHaveLength(2)
    expect((await store.list()).map((c) => c.title)).toEqual(['mine'])
  })

  it('stamps its own board onto new cards', async () => {
    const { fake, store } = setup()
    await store.create({ title: 'A', board: 'somewhere-else' })
    expect(fake.rows[0].board).toBe('main')
  })

  it('keeps the id it was given, so undo can restore a card', async () => {
    const { store } = setup()
    const card = await store.create({ id: 'fixed-id', title: 'A' })
    expect(card.id).toBe('fixed-id')
  })

  it('never sends a column the client is not allowed to write', async () => {
    const { fake, store } = setup()
    const created = await store.create({ title: 'A' })
    await store.update(created.id, {
      title: 'B',
      board: 'hijack',
      created_at: '1999-01-01T00:00:00.000Z',
      id: 'nope',
      nonsense: true,
    })

    const [row] = fake.rows
    expect(row.id).toBe(created.id)
    expect(row.board).toBe('main')
    expect(row.created_at).toBe(created.created_at)
    expect(row).not.toHaveProperty('nonsense')
    expect(row.title).toBe('B')
  })

  it('cleans a bad status rather than letting the check constraint reject it', async () => {
    const { fake, store } = setup()
    await store.create({ title: 'A', status: 'archived' })
    expect(fake.rows[0].status).toBe('problem')
  })

  it('re-reads instead of issuing an empty UPDATE', async () => {
    const { store } = setup()
    const created = await store.create({ title: 'A' })
    const result = await store.update(created.id, { board: 'ignored' })
    expect(result.title).toBe('A')
    expect(result.id).toBe(created.id)
  })

  it('lets the server own updated_at', async () => {
    const { fake, store } = setup()
    const created = await store.create({ title: 'A' })
    const updated = await store.update(created.id, { title: 'B' })

    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(created.updated_at))
    expect(fake.rows[0].updated_at).toBe(updated.updated_at)
  })
})

describe('error messages', () => {
  const failWith = async (error, run) => {
    const { fake, store } = setup()
    fake.failNext(error)
    return run(store)
  }

  it('explains a missing table by naming the file that creates it', async () => {
    await expect(
      failWith({ code: '42P01', message: 'relation "public.cards" does not exist' }, (s) => s.list()),
    ).rejects.toThrow(/schema\.sql/)
  })

  it('explains an RLS refusal by naming the policy', async () => {
    await expect(
      failWith({ code: '42501', message: 'new row violates row-level security policy' }, (s) =>
        s.create({ title: 'A' }),
      ),
    ).rejects.toThrow(/RLS policy/i)
  })

  it('explains a bad key', async () => {
    await expect(
      failWith({ message: 'Invalid API key' }, (s) => s.list()),
    ).rejects.toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('suggests a paused project when the network fails', async () => {
    await expect(
      failWith({ message: 'TypeError: Failed to fetch' }, (s) => s.list()),
    ).rejects.toThrow(/paused|offline/i)
  })

  it('reports a missing row as a missing card, not as PGRST116', async () => {
    const { store } = setup()
    await expect(store.update('nope', { title: 'x' })).rejects.toThrow(/no longer exists/i)
  })

  it('falls back to the raw message for anything unrecognised', async () => {
    await expect(
      failWith({ code: 'XX000', message: 'internal error 4711' }, (s) => s.list()),
    ).rejects.toThrow(/4711/)
  })
})

describe('realtime', () => {
  it('opens one channel however many subscribers there are', () => {
    const { fake, store } = setup()
    store.subscribe(() => {})
    store.subscribe(() => {})
    expect(fake.channelCount).toBe(1)
  })

  it('notifies every subscriber when a row changes', () => {
    const { fake, store } = setup()
    const a = vi.fn()
    const b = vi.fn()
    store.subscribe(a)
    store.subscribe(b)

    fake.emitRemote('INSERT', { id: 'z' })
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
  })

  it('reports going live through onStatus, not through subscribe', () => {
    const { store } = setup()
    const onData = vi.fn()
    const onStatus = vi.fn()
    store.subscribe(onData)
    store.onStatus(onStatus)

    expect(onStatus).toHaveBeenCalledWith('live')
    expect(onData).not.toHaveBeenCalled()
  })

  it('keeps the channel open for a status-only listener', () => {
    const { fake, store } = setup()
    const off = store.subscribe(() => {})
    store.onStatus(() => {})
    off()
    expect(fake.channelCount).toBe(1)
  })

  it('keeps the channel while any subscriber remains', () => {
    const { fake, store } = setup()
    const off = store.subscribe(() => {})
    store.subscribe(() => {})
    off()
    expect(fake.channelCount).toBe(1)
  })

  it('tears the channel down when the last subscriber leaves', () => {
    const { fake, store } = setup()
    const off = store.subscribe(() => {})
    off()
    expect(fake.channelCount).toBe(0)
  })

  it('tears the channel down on close', async () => {
    const { fake, store } = setup()
    store.subscribe(() => {})
    await store.close()
    expect(fake.channelCount).toBe(0)
  })

  it('keeps notifying the other subscribers when one throws', () => {
    const { fake, store } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = vi.fn()
    store.subscribe(() => {
      throw new Error('boom')
    })
    store.subscribe(good)

    fake.emitRemote()
    expect(good).toHaveBeenCalled()
  })
})
