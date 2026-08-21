import { describe, it, expect } from 'vitest'
import {
  parseQuery,
  classifyToken,
  removeFromQuery,
  matchesQuery,
  applyFilters,
  isFiltering,
  describeFilters,
} from '../src/filters.js'
import { normalizeCard, makeNote } from '../src/model.js'

const card = (props) => normalizeCard(props)

const BOARD = [
  card({
    id: 'a',
    title: 'Invoices export drops the last row',
    body: 'Only on the CSV path',
    tag: 'billing',
    status: 'problem',
    assignees: ['Sam Rivera'],
    notes: [makeNote('Alex Chen', 'Reproduced on staging')],
  }),
  card({ id: 'b', title: 'On-call rota is unowned', tag: 'infra', status: 'problem' }),
  card({ id: 'c', title: 'Batch webhook retries', tag: 'infra', status: 'idea', assignees: ['Alex Chen', 'Sam Rivera'] }),
  card({ id: 'd', title: 'Rewrite the CSV parser', tag: 'billing', status: 'progress', assignees: ['Alex Chen'] }),
  card({ id: 'e', title: 'Ship the landing page', tag: 'web', status: 'done', assignees: ['Jo Park'] }),
]

const ids = (cards) => cards.map((c) => c.id)
const search = (query) => ids(applyFilters(BOARD, { query }))

describe('parseQuery', () => {
  it('treats bare words as free text', () => {
    expect(parseQuery('csv parser')).toMatchObject({ text: ['csv', 'parser'] })
  })

  it('lowercases free text', () => {
    expect(parseQuery('CSV')).toMatchObject({ text: ['csv'] })
  })

  it('pulls out tag:, @ and is:', () => {
    expect(parseQuery('tag:infra @sam is:done leftover')).toEqual({
      text: ['leftover'],
      tags: ['infra'],
      people: ['sam'],
      stages: ['done'],
    })
  })

  it('accepts friendly aliases for stages', () => {
    expect(parseQuery('is:wip').stages).toEqual(['progress'])
    expect(parseQuery('is:in-progress').stages).toEqual(['progress'])
    expect(parseQuery('is:todo').stages).toEqual(['idea'])
  })

  it('falls back to free text for an unknown is: value', () => {
    // Better than silently matching nothing and looking broken.
    const parsed = parseQuery('is:banana')
    expect(parsed.stages).toEqual([])
    expect(parsed.text).toEqual(['is:banana'])
  })

  it('ignores a bare prefix with nothing after it', () => {
    expect(parseQuery('tag:')).toMatchObject({ text: ['tag:'], tags: [] })
    expect(parseQuery('@')).toMatchObject({ text: ['@'], people: [] })
  })

  it('collapses extra whitespace', () => {
    expect(parseQuery('   csv    parser   ')).toMatchObject({ text: ['csv', 'parser'] })
  })

  it('returns an empty parse for junk input', () => {
    for (const junk of ['', '   ', null, undefined, 42]) {
      expect(parseQuery(junk)).toEqual({ text: [], tags: [], people: [], stages: [] })
    }
  })
})

describe('free-text search', () => {
  it('returns everything for an empty query', () => {
    expect(search('')).toEqual(ids(BOARD))
    expect(search('   ')).toEqual(ids(BOARD))
  })

  it('matches the title', () => {
    expect(search('rota')).toEqual(['b'])
  })

  it('is case-insensitive', () => {
    expect(search('CSV')).toEqual(['a', 'd'])
  })

  it('matches the description', () => {
    expect(search('csv path')).toEqual(['a'])
  })

  it('matches the tag', () => {
    expect(search('billing')).toEqual(['a', 'd'])
  })

  it('matches an assignee name', () => {
    expect(search('rivera')).toEqual(['a', 'c'])
  })

  it('matches note text', () => {
    expect(search('staging')).toEqual(['a'])
  })

  it('matches a note author', () => {
    expect(search('alex')).toEqual(['a', 'c', 'd'])
  })

  it('ANDs multiple terms', () => {
    expect(search('csv rewrite')).toEqual(['d'])
  })

  it('returns nothing when a term matches nothing', () => {
    expect(search('csv zzzz')).toEqual([])
  })

  it('matches on substrings', () => {
    expect(search('invoic')).toEqual(['a'])
  })
})

describe('prefix filters', () => {
  it('filters by tag', () => {
    expect(search('tag:infra')).toEqual(['b', 'c'])
  })

  it('matches a tag prefix', () => {
    expect(search('tag:bill')).toEqual(['a', 'd'])
  })

  it('filters by assignee', () => {
    expect(search('@jo')).toEqual(['e'])
  })

  it('filters by stage', () => {
    expect(search('is:problem')).toEqual(['a', 'b'])
  })

  it('ORs repeated prefixes of the same kind', () => {
    expect(search('is:done is:progress')).toEqual(['d', 'e'])
    expect(search('tag:infra tag:web')).toEqual(['b', 'c', 'e'])
  })

  it('ANDs prefixes of different kinds', () => {
    expect(search('tag:billing is:problem')).toEqual(['a'])
  })

  it('combines a prefix with free text', () => {
    expect(search('tag:billing csv')).toEqual(['a', 'd'])
  })

  it('finds nothing for a contradictory query', () => {
    expect(search('tag:web is:problem')).toEqual([])
  })
})

describe('person filter', () => {
  it('returns everything for no people', () => {
    expect(ids(applyFilters(BOARD, { people: [] }))).toEqual(ids(BOARD))
  })

  it('filters to one person', () => {
    expect(ids(applyFilters(BOARD, { people: ['Sam Rivera'] }))).toEqual(['a', 'c'])
  })

  it('ignores casing and whitespace', () => {
    expect(ids(applyFilters(BOARD, { people: ['  sam rivera '] }))).toEqual(['a', 'c'])
  })

  it('ORs several people', () => {
    expect(ids(applyFilters(BOARD, { people: ['Jo Park', 'Sam Rivera'] }))).toEqual(['a', 'c', 'e'])
  })

  it('needs a full name, unlike the @ prefix', () => {
    expect(ids(applyFilters(BOARD, { people: ['Sam'] }))).toEqual([])
    expect(ids(applyFilters(BOARD, { query: '@sam' }))).toEqual(['a', 'c'])
  })

  it('ANDs with the search query', () => {
    expect(ids(applyFilters(BOARD, { people: ['Alex Chen'], query: 'tag:billing' }))).toEqual(['d'])
  })

  it('drops blank entries rather than matching nothing', () => {
    expect(ids(applyFilters(BOARD, { people: ['', '   '] }))).toEqual(ids(BOARD))
  })
})

describe('applyFilters', () => {
  it('returns the same array reference when nothing is filtered', () => {
    // Lets the caller skip a re-render.
    expect(applyFilters(BOARD, {})).toBe(BOARD)
    expect(applyFilters(BOARD)).toBe(BOARD)
  })

  it('does not mutate the input', () => {
    const before = ids(BOARD)
    applyFilters(BOARD, { query: 'csv' })
    expect(ids(BOARD)).toEqual(before)
  })

  it('handles an empty board', () => {
    expect(applyFilters([], { query: 'anything' })).toEqual([])
  })
})

describe('isFiltering', () => {
  it('is false for nothing set', () => {
    expect(isFiltering({})).toBe(false)
    expect(isFiltering({ query: '   ' })).toBe(false)
    expect(isFiltering()).toBe(false)
  })

  it('is true for a query or a person', () => {
    expect(isFiltering({ query: 'csv' })).toBe(true)
    expect(isFiltering({ query: 'tag:infra' })).toBe(true)
    expect(isFiltering({ people: ['Sam'] })).toBe(true)
  })
})

describe('describeFilters', () => {
  it('is empty when nothing is set', () => {
    expect(describeFilters({})).toEqual([])
  })

  it('describes each active filter', () => {
    const chips = describeFilters({ query: 'tag:infra is:done @sam loose words', people: ['Jo Park'] })
    expect(chips.map((c) => c.label)).toEqual([
      'Jo Park',
      'tag:infra',
      'is:done',
      '@sam',
      '"loose words"',
    ])
  })

  it('tags each chip with its kind so it can be removed individually', () => {
    const chips = describeFilters({ query: 'tag:infra', people: ['Jo Park'] })
    expect(chips.map((c) => c.kind)).toEqual(['person', 'tag'])
  })
})

describe('classifyToken', () => {
  it('names each kind of token', () => {
    expect(classifyToken('tag:infra')).toEqual({ kind: 'tag', value: 'infra' })
    expect(classifyToken('is:done')).toEqual({ kind: 'stage', value: 'done' })
    expect(classifyToken('@sam')).toEqual({ kind: 'mention', value: 'sam' })
    expect(classifyToken('csv')).toEqual({ kind: 'text', value: 'csv' })
  })

  it('resolves a stage alias to the real stage', () => {
    expect(classifyToken('is:wip')).toEqual({ kind: 'stage', value: 'progress' })
  })
})

describe('removeFromQuery', () => {
  it('removes one prefix token and leaves the rest', () => {
    expect(removeFromQuery('tag:infra is:done csv', { kind: 'tag', value: 'infra' }))
      .toBe('is:done csv')
  })

  it('removes only the matching value when a prefix repeats', () => {
    expect(removeFromQuery('tag:infra tag:web', { kind: 'tag', value: 'web' })).toBe('tag:infra')
  })

  it('removes a stage by its resolved name, whichever alias was typed', () => {
    expect(removeFromQuery('is:wip csv', { kind: 'stage', value: 'progress' })).toBe('csv')
  })

  it('removes every free-text word at once, matching the single chip shown', () => {
    expect(removeFromQuery('tag:infra loose words', { kind: 'text', value: 'loose words' }))
      .toBe('tag:infra')
  })

  it('leaves the query alone when the chip is not in it', () => {
    expect(removeFromQuery('tag:infra', { kind: 'tag', value: 'web' })).toBe('tag:infra')
  })

  it('returns an empty string when the last chip goes', () => {
    expect(removeFromQuery('csv', { kind: 'text', value: 'csv' })).toBe('')
  })

  it('round-trips with describeFilters -- every chip is removable', () => {
    const query = 'tag:infra is:done @sam loose words'
    let remaining = query
    for (const chip of describeFilters({ query })) {
      remaining = removeFromQuery(remaining, chip)
    }
    expect(remaining).toBe('')
  })
})
