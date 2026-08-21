import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The behaviour every storage adapter must exhibit.
 *
 * Phase 5 swaps localStorage for Supabase, and the whole point of putting a
 * store interface in phase 2 was that the UI would not notice. This suite is
 * what makes that claim checkable: both adapters run these exact assertions.
 *
 * @param {string} name
 * @param {() => Promise<object>|object} makeStore  fresh, empty store per test
 */
export function runStoreContract(name, makeStore) {
  describe(`store contract: ${name}`, () => {
    let store

    beforeEach(async () => {
      store = await makeStore()
    })

    it('starts empty', async () => {
      expect(await store.list()).toEqual([])
    })

    it('reports its mode', () => {
      expect(typeof store.mode).toBe('string')
      expect(store.mode.length).toBeGreaterThan(0)
    })

    describe('create', () => {
      it('returns a fully normalized card', async () => {
        const card = await store.create({ title: 'Ship it', status: 'idea', position: 1000 })

        expect(card.id).toBeTruthy()
        expect(card.title).toBe('Ship it')
        expect(card.status).toBe('idea')
        expect(card.position).toBe(1000)
        expect(card.body).toBe('')
        expect(card.tag).toBe('')
        expect(card.assignees).toEqual([])
        expect(card.notes).toEqual([])
        expect(Number.isNaN(Date.parse(card.created_at))).toBe(false)
        expect(Number.isNaN(Date.parse(card.updated_at))).toBe(false)
      })

      it('persists the card so a later list() sees it', async () => {
        const created = await store.create({ title: 'A' })
        const listed = await store.list()
        expect(listed).toHaveLength(1)
        expect(listed[0].id).toBe(created.id)
        expect(listed[0].title).toBe('A')
      })

      it('defaults an unknown status to the first stage', async () => {
        const card = await store.create({ title: 'A', status: 'nonsense' })
        expect(card.status).toBe('problem')
      })

      it('gives every card a distinct id', async () => {
        const a = await store.create({ title: 'A' })
        const b = await store.create({ title: 'B' })
        expect(a.id).not.toBe(b.id)
      })

      it('round-trips assignees and notes through the jsonb columns', async () => {
        const at = new Date().toISOString()
        await store.create({
          title: 'A',
          assignees: ['Sam', 'Alex'],
          notes: [{ id: 'n1', author: 'Sam', text: 'hello', at }],
        })
        const [card] = await store.list()
        expect(card.assignees).toEqual(['Sam', 'Alex'])
        expect(card.notes).toHaveLength(1)
        expect(card.notes[0].text).toBe('hello')
        expect(card.notes[0].author).toBe('Sam')
      })
    })

    describe('update', () => {
      it('applies a partial patch and leaves other fields alone', async () => {
        const created = await store.create({ title: 'A', tag: 'infra', status: 'idea' })
        const updated = await store.update(created.id, { title: 'B' })

        expect(updated.title).toBe('B')
        expect(updated.tag).toBe('infra')
        expect(updated.status).toBe('idea')
      })

      it('persists the patch', async () => {
        const created = await store.create({ title: 'A' })
        await store.update(created.id, { status: 'done' })
        const [card] = await store.list()
        expect(card.status).toBe('done')
      })

      it('moves updated_at forward', async () => {
        const created = await store.create({ title: 'A' })
        await new Promise((r) => setTimeout(r, 5))
        const updated = await store.update(created.id, { title: 'B' })
        expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at))
      })

      it('refuses to let a client rewrite the id', async () => {
        const created = await store.create({ title: 'A' })
        const updated = await store.update(created.id, { id: 'hijacked', title: 'B' })
        expect(updated.id).toBe(created.id)
        expect(await store.list()).toHaveLength(1)
      })

      it('refuses to let a client rewrite created_at', async () => {
        const created = await store.create({ title: 'A' })
        const updated = await store.update(created.id, { created_at: '1999-01-01T00:00:00.000Z' })
        expect(updated.created_at).toBe(created.created_at)
      })

      it('rejects an id that is not there', async () => {
        await expect(store.update('missing-id-0000', { title: 'x' })).rejects.toThrow()
      })

      it('writes a position as a float, not a rounded integer', async () => {
        const created = await store.create({ title: 'A', position: 1000 })
        const updated = await store.update(created.id, { position: 1500.5 })
        expect(updated.position).toBe(1500.5)
        const [card] = await store.list()
        expect(card.position).toBe(1500.5)
      })
    })

    describe('remove', () => {
      it('deletes the card', async () => {
        const created = await store.create({ title: 'A' })
        await store.remove(created.id)
        expect(await store.list()).toEqual([])
      })

      it('leaves other cards alone', async () => {
        const a = await store.create({ title: 'A' })
        const b = await store.create({ title: 'B' })
        await store.remove(a.id)
        const listed = await store.list()
        expect(listed).toHaveLength(1)
        expect(listed[0].id).toBe(b.id)
      })

      it('is idempotent -- deleting twice is not an error', async () => {
        const created = await store.create({ title: 'A' })
        await store.remove(created.id)
        await expect(store.remove(created.id)).resolves.not.toThrow()
      })
    })

    describe('subscribe', () => {
      it('hands back an unsubscribe function', () => {
        const off = store.subscribe(() => {})
        expect(typeof off).toBe('function')
        off()
      })

      it('stops calling a handler after unsubscribe', async () => {
        let calls = 0
        const off = store.subscribe(() => { calls++ })
        off()
        await store.create({ title: 'A' })
        expect(calls).toBe(0)
      })

      it('does not deliver connection status through the data channel', async () => {
        // A subscriber that reloads the board must not reload it because a
        // socket connected. Status has its own channel.
        const onData = vi.fn()
        store.subscribe(onData)
        store.onStatus(() => {})
        expect(onData).not.toHaveBeenCalled()
      })
    })

    describe('onStatus', () => {
      it('reports the current status immediately and hands back an unsubscribe', () => {
        // At least one: the current state is replayed on subscribe, and an
        // adapter that connects synchronously may follow it with a transition.
        const seen = []
        const off = store.onStatus((s) => seen.push(s))
        expect(seen.length).toBeGreaterThanOrEqual(1)
        expect(seen.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
        expect(typeof off).toBe('function')
        off()
      })

      it('stops reporting status after unsubscribe', () => {
        const seen = []
        const off = store.onStatus((s) => seen.push(s))
        const before = seen.length
        off()
        store.onStatus(() => {})
        expect(seen).toHaveLength(before)
      })
    })
  })
}
