/**
 * Pure derivations over the card list. No DOM, no store -- so they are cheap
 * to test and safe to call on every render.
 */
import { STAGES, DONE_STAGE, personKey } from './model.js'
import { sortByPosition } from './position.js'

/** stage id -> sorted cards. Always contains every stage, even empty ones. */
export function groupByStage(cards) {
  const byStage = new Map(STAGES.map((s) => [s.id, []]))
  for (const card of cards) {
    const list = byStage.get(card.status)
    if (list) list.push(card)
  }
  for (const [id, list] of byStage) byStage.set(id, sortByPosition(list))
  return byStage
}

/**
 * Everyone who appears on the board, most-assigned first.
 * There is no user table by design -- the roster is whoever has been assigned.
 */
export function peopleFrom(cards) {
  const counts = new Map()
  for (const card of cards) {
    for (const name of card.assignees) {
      const key = personKey(name)
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { name, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** { done, total, pct } -- pct is 0 for an empty board, not NaN. */
export function progressOf(cards) {
  const total = cards.length
  const done = cards.filter((c) => c.status === DONE_STAGE).length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Tags already in use, for the datalist on the tag field. */
export function tagsFrom(cards) {
  const seen = new Map()
  for (const card of cards) {
    if (!card.tag) continue
    const key = card.tag.toLowerCase()
    seen.set(key, (seen.get(key) || { tag: card.tag, count: 0 }))
    seen.get(key).count++
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
