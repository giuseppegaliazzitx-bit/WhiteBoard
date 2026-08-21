/**
 * Fractional ordering.
 *
 * Cards carry a float `position`. Dropping a card between two neighbours sets
 * its position to their midpoint, so a move is always a single-row write --
 * no reindexing, no cascade, no write amplification when two people drag at
 * the same time.
 *
 * The known limit is float exhaustion: repeatedly splitting the *same* gap
 * runs out of mantissa after ~50 splits. `positionForIndex` reports that via
 * `exhausted` rather than silently producing a duplicate position, and the
 * caller renumbers that one column.
 */

export const STEP = 1000

/**
 * Sort order for a column.
 *
 * Positions can legitimately collide: two clients inserting into the same gap
 * while offline both compute the same midpoint. Without a deterministic
 * tiebreak the two browsers would render those cards in different orders, so
 * we fall back to created_at and then id -- both stable across clients.
 */
export function sortByPosition(cards) {
  return [...cards].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    const at = Date.parse(a.created_at) || 0
    const bt = Date.parse(b.created_at) || 0
    if (at !== bt) return at - bt
    return String(a.id) < String(b.id) ? -1 : 1
  })
}

/** Midpoint of two positions. `null` means "no neighbour on that side". */
export function positionBetween(prev, next) {
  if (prev === null && next === null) return STEP
  if (prev === null) return next - STEP
  if (next === null) return prev + STEP
  return (prev + next) / 2
}

/**
 * Where to put a card landing at `index` in `others`.
 *
 * `others` must be sorted and must NOT contain the card being moved -- the UI
 * shows a drop indicator between the remaining cards, so the index it hands us
 * is already an index into that reduced list.
 *
 * @returns {{ position: number, exhausted: boolean }}
 */
export function positionForIndex(others, index) {
  const list = others.map((c) => (typeof c === 'number' ? c : c.position))
  const i = Math.max(0, Math.min(Math.trunc(index) || 0, list.length))

  const prev = i > 0 ? list[i - 1] : null
  const next = i < list.length ? list[i] : null
  const position = positionBetween(prev, next)

  // The midpoint collapsed onto a neighbour, or the inputs were not finite.
  const exhausted =
    !Number.isFinite(position) ||
    (prev !== null && position <= prev) ||
    (next !== null && position >= next)

  return { position, exhausted }
}

/** Position that appends to the end of a column. */
export function positionForAppend(cards) {
  return positionForIndex(cards, cards.length).position
}

/** Position that prepends to the top of a column. */
export function positionForPrepend(cards) {
  return positionForIndex(cards, 0).position
}

/**
 * Even out a column onto 1000, 2000, 3000... Returns only the cards whose
 * position actually changes, so the caller writes the minimum number of rows.
 */
export function renumberPlan(cards) {
  const sorted = sortByPosition(cards)
  const plans = []
  for (let i = 0; i < sorted.length; i++) {
    const position = (i + 1) * STEP
    if (sorted[i].position !== position) plans.push({ id: sorted[i].id, position })
  }
  return plans
}
