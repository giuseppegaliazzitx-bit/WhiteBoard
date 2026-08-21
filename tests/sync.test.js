import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSync, FAST_POLL_MS, SLOW_POLL_MS, MAX_BACKOFF_MS } from '../src/sync.js'

/** A store stub exposing just the two channels sync consumes. */
function fakeStore(mode = 'supabase') {
  const data = new Set()
  const status = new Set()
  return {
    mode,
    subscribe(fn) {
      data.add(fn)
      return () => data.delete(fn)
    },
    onStatus(fn) {
      status.add(fn)
      fn(mode === 'local' ? 'local' : 'connecting')
      return () => status.delete(fn)
    },
    emitData: () => data.forEach((fn) => fn()),
    emitStatus: (s) => status.forEach((fn) => fn(s)),
    get statusListeners() {
      return status.size
    },
    get dataListeners() {
      return data.size
    },
  }
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

function setOnline(online) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

let sync
let refresh
let setState

function start(store = fakeStore()) {
  refresh = vi.fn(async () => {})
  setState = vi.fn()
  sync = createSync({ store, refresh, setState })
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  sync?.destroy()
  sync = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('polling', () => {
  it('polls on the fast interval while realtime is not connected', async () => {
    start()
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('drops to the slow interval once realtime is live', async () => {
    const store = start()
    store.emitStatus('live')
    refresh.mockClear()

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 2)
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('goes back to fast polling when the socket drops', async () => {
    const store = start()
    store.emitStatus('live')
    store.emitStatus('offline')
    refresh.mockClear()

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not poll at all on a localStorage board', async () => {
    start(fakeStore('local'))
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 10)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('realtime events', () => {
  it('refreshes as soon as a row changes', async () => {
    const store = start()
    store.emitData()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on reconnect, since anything sent while down was missed', async () => {
    const store = start()
    store.emitStatus('live')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh again on a repeated live status', async () => {
    const store = start()
    store.emitStatus('live')
    await vi.advanceTimersByTimeAsync(0)
    store.emitStatus('live')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('coalescing', () => {
  it('does not start a second overlapping read', async () => {
    const store = fakeStore()
    let release
    refresh = vi.fn(() => new Promise((r) => { release = r }))
    setState = vi.fn()
    sync = createSync({ store, refresh, setState })

    sync.pull()
    sync.pull()
    sync.pull()
    expect(refresh).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(0)

    // The calls that arrived mid-flight collapse into exactly one re-run.
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('settles rather than looping forever', async () => {
    start()
    sync.pull()
    sync.pull()
    await vi.advanceTimersByTimeAsync(0)
    const settled = refresh.mock.calls.length

    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(settled)
  })
})

describe('visibility', () => {
  it('stops polling while the tab is hidden', async () => {
    start()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 5)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes immediately on return, since a hidden tab goes stale', async () => {
    start()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 5)

    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('resumes polling after returning', async () => {
    start()
    setVisibility('hidden')
    setVisibility('visible')
    refresh.mockClear()

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalled()
  })
})

describe('network', () => {
  it('reports offline and stops polling', async () => {
    start()
    setOnline(false)
    expect(sync.state).toBe('offline')

    refresh.mockClear()
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 3)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes the moment the network returns', async () => {
    start()
    setOnline(false)
    refresh.mockClear()

    setOnline(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(sync.state).not.toBe('offline')
  })
})

describe('failure backoff', () => {
  it('backs off after repeated failures instead of hammering', async () => {
    const store = fakeStore()
    refresh = vi.fn(async () => {
      throw new Error('down')
    })
    setState = vi.fn()
    sync = createSync({ store, refresh, setState })

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)

    // The next attempt is now at 2x, so the fast interval alone is not enough.
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('caps the backoff', async () => {
    const store = fakeStore()
    refresh = vi.fn(async () => {
      throw new Error('down')
    })
    setState = vi.fn()
    sync = createSync({ store, refresh, setState })

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 12)
    const calls = refresh.mock.calls.length

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS)
    expect(refresh.mock.calls.length).toBeGreaterThan(calls)
  })

  it('returns to the normal interval after a success', async () => {
    const store = fakeStore()
    let fail = true
    refresh = vi.fn(async () => {
      if (fail) throw new Error('down')
    })
    setState = vi.fn()
    sync = createSync({ store, refresh, setState })

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    fail = false
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 2)
    const afterRecovery = refresh.mock.calls.length

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS)
    expect(refresh.mock.calls.length).toBe(afterRecovery + 1)
  })

  it('does not let a failed refresh escape as an unhandled rejection', async () => {
    const store = fakeStore()
    refresh = vi.fn(async () => {
      throw new Error('down')
    })
    setState = vi.fn()
    sync = createSync({ store, refresh, setState })

    await expect(sync.pull()).resolves.not.toThrow()
  })
})

describe('reported state', () => {
  it('starts as polling for a remote board and local for a local one', () => {
    start()
    expect(setState).toHaveBeenCalledWith('polling')

    sync.destroy()
    start(fakeStore('local'))
    expect(setState).toHaveBeenCalledWith('local')
  })

  it('reports live once the socket connects', () => {
    const store = start()
    store.emitStatus('live')
    expect(sync.state).toBe('live')
  })

  it('prefers offline over live when the network is down', () => {
    const store = start()
    store.emitStatus('live')
    setOnline(false)
    expect(sync.state).toBe('offline')
  })
})

describe('destroy', () => {
  it('stops polling', async () => {
    start()
    sync.destroy()
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 5)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('releases both store subscriptions', () => {
    const store = start()
    expect(store.dataListeners).toBe(1)
    expect(store.statusListeners).toBe(1)

    sync.destroy()
    expect(store.dataListeners).toBe(0)
    expect(store.statusListeners).toBe(0)
  })

  it('stops responding to visibility and network events', async () => {
    start()
    sync.destroy()
    refresh.mockClear()

    setVisibility('visible')
    setOnline(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).not.toHaveBeenCalled()
  })
})
