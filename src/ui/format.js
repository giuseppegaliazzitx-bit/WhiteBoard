/** Human-facing formatting. Pure functions so they are cheap to unit test. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "just now" / "4m" / "3h" / "2d" / "12 Mar".
 * `now` is injectable so tests do not depend on the wall clock.
 */
export function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const delta = now - then

  if (delta < 0) return 'just now'          // clock skew between clients
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`

  const d = new Date(then)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function absoluteTime(iso) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** "1 note" / "2 notes" -- avoids the "1 notes" tell. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}
