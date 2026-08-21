import { describe, it, expect } from 'vitest'
import {
  STEP,
  sortByPosition,
  positionBetween,
  positionForIndex,
  positionForAppend,
  positionForPrepend,
  renumberPlan,
} from '../src/position.js'

const card = (id, position, created_at = '2026-01-01T00:00:00.000Z') => ({ id, position, created_at })

describe('positionBetween', () => {
  it('returns STEP for an empty column', () => {
    expect(positionBetween(null, null)).toBe(STEP)
  })

  it('steps below the first card when inserting at the top', () => {
    expect(positionBetween(null, 1000)).toBe(0)
    expect(positionBetween(null, 500)).toBe(-500)
  })

  it('steps above the last card when appending', () => {
    expect(positionBetween(3000, null)).toBe(4000)
  })

  it('takes the midpoint between two neighbours', () => {
    expect(positionBetween(1000, 2000)).toBe(1500)
    expect(positionBetween(1000, 1001)).toBe(1000.5)
  })

  it('handles negative positions, which happen after repeated top-inserts', () => {
    expect(positionBetween(-2000, -1000)).toBe(-1500)
    expect(positionBetween(null, -5000)).toBe(-6000)
  })
})

describe('positionForIndex', () => {
  const others = [card('a', 1000), card('b', 2000), card('c', 3000)]

  it('places at the top', () => {
    expect(positionForIndex(others, 0)).toEqual({ position: 0, exhausted: false })
  })

  it('places between the first and second card', () => {
    expect(positionForIndex(others, 1).position).toBe(1500)
  })

  it('places at the bottom', () => {
    expect(positionForIndex(others, 3).position).toBe(4000)
  })

  it('clamps an index past the end instead of producing NaN', () => {
    expect(positionForIndex(others, 99).position).toBe(4000)
  })

  it('clamps a negative index to the top', () => {
    expect(positionForIndex(others, -5).position).toBe(0)
  })

  it('accepts bare numbers as well as card objects', () => {
    expect(positionForIndex([1000, 2000], 1).position).toBe(1500)
  })

  it('returns STEP for an empty column', () => {
    expect(positionForIndex([], 0)).toEqual({ position: STEP, exhausted: false })
  })

  it('does not flag a healthy gap as exhausted', () => {
    expect(positionForIndex(others, 1).exhausted).toBe(false)
  })

  it('flags exhaustion once the same gap has been split to death', () => {
    // Split the gap between 1000 and 2000 over and over. Doubles have 52 bits
    // of mantissa, so this must trip -- and must trip by reporting, not by
    // silently returning a position equal to its neighbour.
    let lo = 1000
    const hi = 2000
    let exhausted = false
    let splits = 0

    for (; splits < 200; splits++) {
      const result = positionForIndex([card('lo', lo), card('hi', hi)], 1)
      if (result.exhausted) { exhausted = true; break }
      expect(result.position).toBeGreaterThan(lo)
      expect(result.position).toBeLessThan(hi)
      lo = result.position
    }

    expect(exhausted).toBe(true)
    expect(splits).toBeGreaterThan(40)   // the doc claims ~50; sanity-check the order of magnitude
    expect(splits).toBeLessThan(60)
  })

  it('flags exhaustion for two cards already sharing a position', () => {
    const collided = [card('a', 1500), card('b', 1500)]
    expect(positionForIndex(collided, 1).exhausted).toBe(true)
  })

  it('flags non-finite input rather than writing NaN to the database', () => {
    expect(positionForIndex([card('a', Infinity), card('b', -Infinity)], 1).exhausted).toBe(true)
  })
})

describe('positionForAppend / positionForPrepend', () => {
  it('bookends an existing column', () => {
    const cards = [card('a', 1000), card('b', 2000)]
    expect(positionForAppend(cards)).toBe(3000)
    expect(positionForPrepend(cards)).toBe(0)
  })

  it('both return STEP when the column is empty', () => {
    expect(positionForAppend([])).toBe(STEP)
    expect(positionForPrepend([])).toBe(STEP)
  })
})

describe('sortByPosition', () => {
  it('orders by position ascending', () => {
    const out = sortByPosition([card('c', 3000), card('a', 1000), card('b', 2000)])
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const input = [card('c', 3000), card('a', 1000)]
    sortByPosition(input)
    expect(input.map((c) => c.id)).toEqual(['c', 'a'])
  })

  it('breaks ties by created_at so every client renders the same order', () => {
    const out = sortByPosition([
      card('z', 1500, '2026-05-02T00:00:00.000Z'),
      card('a', 1500, '2026-05-01T00:00:00.000Z'),
    ])
    expect(out.map((c) => c.id)).toEqual(['a', 'z'])
  })

  it('breaks a full tie by id, deterministically', () => {
    const same = '2026-05-01T00:00:00.000Z'
    const forward = sortByPosition([card('b', 1500, same), card('a', 1500, same)])
    const reverse = sortByPosition([card('a', 1500, same), card('b', 1500, same)])
    expect(forward.map((c) => c.id)).toEqual(['a', 'b'])
    expect(reverse.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('renumberPlan', () => {
  it('spreads a collapsed column back onto round numbers', () => {
    const plan = renumberPlan([card('a', 1000), card('b', 1000.0001), card('c', 1000.0002)])
    expect(plan).toEqual([
      { id: 'b', position: 2000 },
      { id: 'c', position: 3000 },
    ])
  })

  it('returns nothing when the column is already evenly spaced', () => {
    expect(renumberPlan([card('a', 1000), card('b', 2000)])).toEqual([])
  })

  it('returns nothing for an empty column', () => {
    expect(renumberPlan([])).toEqual([])
  })

  it('produces positions that survive another 50 splits', () => {
    const plan = renumberPlan([card('a', 1000), card('b', 1000.0001)])
    expect(positionForIndex([card('a', 1000), card('b', plan[0].position)], 1).exhausted).toBe(false)
  })
})
