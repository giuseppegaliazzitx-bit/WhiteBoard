/**
 * Search and filtering. Pure functions over the card list.
 *
 * The query supports a few prefixes on top of plain text, because "show me
 * Sam's billing cards that are done" is the question people actually have:
 *
 *   billing            free text, matched against every field
 *   tag:infra          cards tagged infra
 *   @sam               cards assigned to someone whose name contains "sam"
 *   is:done            cards in the Done column
 *
 * Terms combine with AND. Two of the same prefix combine with OR, so
 * `is:idea is:progress` means "either", which is what you want from it.
 */
import { personKey, STAGE_IDS, isStage } from './model.js'

const STAGE_ALIASES = {
  'in-progress': 'progress',
  inprogress: 'progress',
  doing: 'progress',
  wip: 'progress',
  todo: 'idea',
  bug: 'problem',
}

/**
 * What one token means. Single source of truth, so parsing a query and
 * removing a chip from it can never disagree about which token is which.
 *
 * @returns {{ kind: 'tag'|'stage'|'mention'|'text', value: string }}
 */
export function classifyToken(token) {
  const lower = String(token).toLowerCase()

  if (lower.startsWith('tag:') && lower.length > 4) {
    return { kind: 'tag', value: lower.slice(4) }
  }
  if (lower.startsWith('is:') && lower.length > 3) {
    const value = lower.slice(3)
    const stage = STAGE_ALIASES[value] || value
    // An unknown is: value falls through to free text rather than silently
    // matching nothing.
    if (isStage(stage)) return { kind: 'stage', value: stage }
    return { kind: 'text', value: lower }
  }
  if (lower.startsWith('@') && lower.length > 1) {
    return { kind: 'mention', value: lower.slice(1) }
  }
  return { kind: 'text', value: lower }
}

function tokenize(raw) {
  if (typeof raw !== 'string') return []
  return raw.trim().split(/\s+/).filter(Boolean)
}

/** @returns {{ text: string[], tags: string[], people: string[], stages: string[] }} */
export function parseQuery(raw) {
  const parsed = { text: [], tags: [], people: [], stages: [] }
  const bucket = { tag: parsed.tags, stage: parsed.stages, mention: parsed.people, text: parsed.text }

  for (const token of tokenize(raw)) {
    const { kind, value } = classifyToken(token)
    bucket[kind].push(value)
  }

  return parsed
}

/**
 * Drop the tokens a chip stands for. Removing the free-text chip clears every
 * plain word at once, which matches how it is presented: one chip, one label.
 */
export function removeFromQuery(raw, chip) {
  return tokenize(raw)
    .filter((token) => {
      const { kind, value } = classifyToken(token)
      if (kind !== chip.kind) return true
      return kind === 'text' ? false : value !== chip.value
    })
    .join(' ')
}

/** Every field a free-text term is matched against, lowercased. */
function haystack(card) {
  return [
    card.title,
    card.tag,
    card.body,
    ...card.assignees,
    ...card.notes.map((n) => `${n.author} ${n.text}`),
  ]
    .join('\n')
    .toLowerCase()
}

export function matchesQuery(card, parsed) {
  if (parsed.stages.length && !parsed.stages.includes(card.status)) return false

  if (parsed.tags.length) {
    const tag = card.tag.toLowerCase()
    if (!parsed.tags.some((t) => tag.includes(t))) return false
  }

  if (parsed.people.length) {
    const names = card.assignees.map((a) => a.toLowerCase())
    if (!parsed.people.some((p) => names.some((n) => n.includes(p)))) return false
  }

  if (parsed.text.length) {
    const hay = haystack(card)
    if (!parsed.text.every((term) => hay.includes(term))) return false
  }

  return true
}

/**
 * @param {object[]} cards
 * @param {object}   filters
 * @param {string}   filters.query   raw search text
 * @param {string[]} filters.people  person keys; a card matches if ANY is on it
 * @returns {object[]}
 */
export function applyFilters(cards, { query = '', people = [] } = {}) {
  const parsed = parseQuery(query)
  const wanted = new Set(people.map(personKey).filter(Boolean))
  const hasQuery = parsed.text.length || parsed.tags.length || parsed.people.length || parsed.stages.length

  if (!hasQuery && !wanted.size) return cards

  return cards.filter((card) => {
    if (wanted.size) {
      const on = card.assignees.some((a) => wanted.has(personKey(a)))
      if (!on) return false
    }
    return matchesQuery(card, parsed)
  })
}

export function isFiltering({ query = '', people = [] } = {}) {
  if (people.length) return true
  const parsed = parseQuery(query)
  return Boolean(parsed.text.length || parsed.tags.length || parsed.people.length || parsed.stages.length)
}

/** Human-readable chips for the filter bar. */
export function describeFilters({ query = '', people = [] } = {}) {
  const parsed = parseQuery(query)
  const chips = []

  for (const name of people) chips.push({ kind: 'person', value: name, label: name })
  for (const tag of parsed.tags) chips.push({ kind: 'tag', value: tag, label: `tag:${tag}` })
  for (const stage of parsed.stages) chips.push({ kind: 'stage', value: stage, label: `is:${stage}` })
  for (const p of parsed.people) chips.push({ kind: 'mention', value: p, label: `@${p}` })
  if (parsed.text.length) {
    chips.push({ kind: 'text', value: parsed.text.join(' '), label: `"${parsed.text.join(' ')}"` })
  }

  return chips
}

/** Suggestions offered as you type, so the prefixes are discoverable. */
export const QUERY_HELP = [
  { token: 'tag:', hint: 'cards with a tag' },
  { token: '@', hint: 'cards assigned to someone' },
  ...STAGE_IDS.map((id) => ({ token: `is:${id}`, hint: `cards in ${id}` })),
]
