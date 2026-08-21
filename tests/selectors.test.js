import { describe, it, expect } from 'vitest'
import { groupByStage, peopleFrom, progressOf, tagsFrom } from '../src/selectors.js'
import { normalizeCard } from '../src/model.js'

const make = (props) => normalizeCard(props)

describe('groupByStage', () => {
  it('includes every stage, even the empty ones', () => {
    const byStage = groupByStage([])
    expect([...byStage.keys()]).toEqual(['problem', 'idea', 'progress', 'done'])
    expect([...byStage.values()].every((v) => v.length === 0)).toBe(true)
  })

  it('files each card under its stage', () => {
    const byStage = groupByStage([
      make({ id: 'a', status: 'idea' }),
      make({ id: 'b', status: 'done' }),
      make({ id: 'c', status: 'idea' }),
    ])
    expect(byStage.get('idea').map((c) => c.id).sort()).toEqual(['a', 'c'])
    expect(byStage.get('done').map((c) => c.id)).toEqual(['b'])
    expect(byStage.get('problem')).toEqual([])
  })

  it('sorts each column by position', () => {
    const byStage = groupByStage([
      make({ id: 'b', status: 'idea', position: 2000 }),
      make({ id: 'a', status: 'idea', position: 1000 }),
    ])
    expect(byStage.get('idea').map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('peopleFrom', () => {
  it('is empty for a board with nobody assigned', () => {
    expect(peopleFrom([make({})])).toEqual([])
  })

  it('counts how many cards each person is on', () => {
    const people = peopleFrom([
      make({ assignees: ['Sam', 'Alex'] }),
      make({ assignees: ['Sam'] }),
    ])
    expect(people).toEqual([
      { name: 'Sam', count: 2 },
      { name: 'Alex', count: 1 },
    ])
  })

  it('treats differently-cased spellings as one person', () => {
    const people = peopleFrom([make({ assignees: ['Sam'] }), make({ assignees: ['SAM'] })])
    expect(people).toHaveLength(1)
    expect(people[0].count).toBe(2)
    expect(people[0].name).toBe('Sam')
  })

  it('breaks count ties alphabetically so the roster does not reshuffle', () => {
    const people = peopleFrom([make({ assignees: ['Zoe', 'Alex', 'Mia'] })])
    expect(people.map((p) => p.name)).toEqual(['Alex', 'Mia', 'Zoe'])
  })
})

describe('progressOf', () => {
  it('returns zeroes and no NaN for an empty board', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, pct: 0 })
  })

  it('counts done against the total', () => {
    expect(progressOf([
      make({ status: 'done' }),
      make({ status: 'done' }),
      make({ status: 'idea' }),
      make({ status: 'problem' }),
    ])).toEqual({ done: 2, total: 4, pct: 50 })
  })

  it('rounds the percentage', () => {
    expect(progressOf([make({ status: 'done' }), make({}), make({})]).pct).toBe(33)
  })
})

describe('tagsFrom', () => {
  it('ignores untagged cards', () => {
    expect(tagsFrom([make({}), make({ tag: '' })])).toEqual([])
  })

  it('counts tags, most used first', () => {
    expect(tagsFrom([
      make({ tag: 'infra' }),
      make({ tag: 'billing' }),
      make({ tag: 'infra' }),
    ])).toEqual([
      { tag: 'infra', count: 2 },
      { tag: 'billing', count: 1 },
    ])
  })

  it('folds case so "Infra" and "infra" are one tag', () => {
    const tags = tagsFrom([make({ tag: 'Infra' }), make({ tag: 'infra' })])
    expect(tags).toHaveLength(1)
    expect(tags[0].count).toBe(2)
  })
})
