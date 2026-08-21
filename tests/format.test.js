import { describe, it, expect } from 'vitest'
import { relativeTime, absoluteTime, plural } from '../src/ui/format.js'

const NOW = Date.parse('2026-08-21T12:00:00.000Z')
const ago = (ms) => new Date(NOW - ms).toISOString()

describe('relativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now')
    expect(relativeTime(ago(59_000), NOW)).toBe('just now')
  })

  it('counts minutes, then hours, then days', () => {
    expect(relativeTime(ago(60_000), NOW)).toBe('1m ago')
    expect(relativeTime(ago(59 * 60_000), NOW)).toBe('59m ago')
    expect(relativeTime(ago(60 * 60_000), NOW)).toBe('1h ago')
    expect(relativeTime(ago(23 * 3_600_000), NOW)).toBe('23h ago')
    expect(relativeTime(ago(24 * 3_600_000), NOW)).toBe('1d ago')
    expect(relativeTime(ago(6 * 86_400_000), NOW)).toBe('6d ago')
  })

  it('switches to a calendar date past a week', () => {
    expect(relativeTime(ago(8 * 86_400_000), NOW)).toMatch(/Aug/)
  })

  it('includes the year only for a different year', () => {
    expect(relativeTime('2025-03-04T00:00:00.000Z', NOW)).toMatch(/2025/)
    expect(relativeTime('2026-03-04T00:00:00.000Z', NOW)).not.toMatch(/2026/)
  })

  it('reads a future timestamp as "just now" rather than "-3m ago"', () => {
    // Two browsers with skewed clocks will do this to each other constantly.
    expect(relativeTime(new Date(NOW + 120_000).toISOString(), NOW)).toBe('just now')
  })

  it('returns empty string for an unparseable timestamp', () => {
    expect(relativeTime('not a date', NOW)).toBe('')
    expect(relativeTime(null, NOW)).toBe('')
    expect(relativeTime(undefined, NOW)).toBe('')
  })

  it('defaults to the real clock when no reference time is passed', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now')
  })
})

describe('absoluteTime', () => {
  it('renders a parseable timestamp', () => {
    expect(absoluteTime('2026-08-21T12:00:00.000Z')).toMatch(/2026/)
  })

  it('returns empty string for junk', () => {
    expect(absoluteTime('nope')).toBe('')
    expect(absoluteTime(null)).toBe('')
  })
})

describe('plural', () => {
  it('does not say "1 notes"', () => {
    expect(plural(1, 'note')).toBe('1 note')
    expect(plural(0, 'note')).toBe('0 notes')
    expect(plural(2, 'note')).toBe('2 notes')
  })

  it('accepts an irregular plural', () => {
    expect(plural(2, 'person', 'people')).toBe('2 people')
    expect(plural(1, 'person', 'people')).toBe('1 person')
  })
})
