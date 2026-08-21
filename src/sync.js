/**
 * Keeping the board fresh.
 *
 * Three things can tell us the data moved, and none of them is sufficient
 * alone:
 *
 *   1. The realtime socket. Fast, but it drops -- laptop sleeps, wifi changes,
 *      Supabase recycles a connection -- and a dropped socket is silent.
 *   2. A poll. Reliable, but too slow to feel live on its own.
 *   3. The tab becoming visible again. A backgrounded tab gets throttled
 *      timers, so it comes back arbitrarily stale.
 *
 * So: poll fast while the socket is down, poll slowly as a safety net while it
 * is up, and always refetch on wake. Never poll a hidden tab -- that is pure
 * waste and, on a free Supabase tier, waste that counts.
 */

export const FAST_POLL_MS = 15_000
/** While realtime is connected, this only exists to catch a silently dead socket. */
export const SLOW_POLL_MS = 90_000
/** Failures back off from FAST_POLL_MS up to this, then stop growing. */
export const MAX_BACKOFF_MS = 120_000

/**
 * @param {object}   deps
 * @param {object}   deps.store     store with subscribe/onStatus
 * @param {Function} deps.refresh   async; re-reads and re-renders the board
 * @param {Function} deps.setState  'live' | 'polling' | 'offline' | 'local'
 */
export function createSync({ store, refresh, setState, now = () => Date.now() }) {
  let timer = null
  let destroyed = false
  let realtime = store.mode === 'local' ? 'local' : 'connecting'
  let failures = 0
  let inFlight = null
  let dirty = false
  let lastSuccess = 0

  // ------------------------------------------------------------------ state

  function currentState() {
    if (realtime === 'local') return 'local'
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
    return realtime === 'live' ? 'live' : 'polling'
  }

  function publish() {
    setState(currentState())
  }

  function pollInterval() {
    const state = currentState()
    if (state === 'local') return null // cross-tab storage events cover this
    if (state === 'offline') return null // nothing to poll until we are back
    if (failures > 0) {
      return Math.min(FAST_POLL_MS * 2 ** failures, MAX_BACKOFF_MS)
    }
    return state === 'live' ? SLOW_POLL_MS : FAST_POLL_MS
  }

  // ------------------------------------------------------------------ pump

  function schedule() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (destroyed) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    const ms = pollInterval()
    if (ms === null) return
    timer = setTimeout(() => {
      timer = null
      pull().finally(schedule)
    }, ms)
  }

  /**
   * Refresh, collapsing concurrent calls. A realtime event arriving mid-poll
   * must not start a second overlapping read; it sets `dirty` and the current
   * read is re-run once when it lands.
   */
  function pull() {
    if (inFlight) {
      dirty = true
      return inFlight
    }

    // The async IIFE runs synchronously up to its first await, so the read
    // starts now rather than a microtask later. It never rejects, so callers
    // can ignore the result without risking an unhandled rejection.
    const run = (async () => {
      try {
        await refresh()
        failures = 0
        lastSuccess = now()
      } catch (err) {
        failures++
        console.error('[sync] refresh failed', err)
      }
    })()

    inFlight = run
    run.then(() => {
      // Guarded: a re-entrant pull() may already have replaced it.
      if (inFlight === run) inFlight = null
      publish()
      if (dirty) {
        dirty = false
        pull()
      }
    })

    return run
  }

  // ------------------------------------------------------------------ events

  const offData = store.subscribe(() => {
    pull()
  })

  const offStatus = store.onStatus?.((status) => {
    const was = currentState()
    realtime = status
    // Coming back from a dropped socket, we have missed everything in between.
    if (status === 'live' && was !== 'live') pull()
    publish()
    schedule()
  })

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      pull()
      schedule()
    } else if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onOnline() {
    failures = 0
    publish()
    pull()
    schedule()
  }

  function onOffline() {
    publish()
    schedule()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }

  publish()
  schedule()

  return {
    /** Force a refresh now, e.g. after a local write that may have raced. */
    pull,
    get state() {
      return currentState()
    },
    get secondsSinceSync() {
      return lastSuccess ? Math.round((now() - lastSuccess) / 1000) : null
    },
    destroy() {
      destroyed = true
      if (timer) clearTimeout(timer)
      timer = null
      offData?.()
      offStatus?.()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      }
    },
  }
}
