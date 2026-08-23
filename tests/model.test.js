import { describe, it, expect } from 'vitest'
import {
  STAGES,
  STAGE_IDS,
  LIMITS,
  isStage,
  getStage,
  stageIndex,
  nextStageId,
  daysIdle,
  STALE_DAYS,
  newId,
  personKey,
  normalizeAssignees,
  normalizeNote,
  normalizeNotes,
  normalizeCard,
  normalizePerson,
  makeNote,
  initials,
  avatarColor,
} from '../src/model.js'

describe('stages', () => {
  it('has the four stages from the plan, in order', () => {
    expect(STAGE_IDS).toEqual(['problem', 'idea', 'progress', 'done'])
  })

  it('gives every stage a name and a blurb', () => {
    for (const stage of STAGES) {
      expect(stage.name.length).toBeGreaterThan(0)
      expect(stage.blurb.length).toBeGreaterThan(0)
    }
  })

  it('recognises real stages and rejects anything else', () => {
    expect(isStage('done')).toBe(true)
    expect(isStage('DONE')).toBe(false)
    expect(isStage('archived')).toBe(false)
    expect(isStage(null)).toBe(false)
    expect(isStage(undefined)).toBe(false)
  })

  it('always returns a stage object, falling back for unknown ids', () => {
    expect(getStage('idea').name).toBe('Idea')
    expect(getStage('nonsense').id).toBe('problem')
    expect(getStage(undefined).id).toBe('problem')
  })

  it('indexes stages, clamping the unknown to 0', () => {
    expect(stageIndex('problem')).toBe(0)
    expect(stageIndex('done')).toBe(3)
    expect(stageIndex('nope')).toBe(0)
  })

  it('names the next stage, or null at Done', () => {
    expect(nextStageId('problem')).toBe('idea')
    expect(nextStageId('progress')).toBe('done')
    expect(nextStageId('done')).toBeNull()
    expect(nextStageId('nope')).toBeNull()
  })
})

describe('daysIdle', () => {
  const now = Date.parse('2026-08-23T12:00:00Z')

  it('counts whole days since the timestamp', () => {
    expect(daysIdle(new Date(now - 3 * 86400000).toISOString(), now)).toBe(3)
  })

  it('is zero for a missing or unparseable date', () => {
    expect(daysIdle('', now)).toBe(0)
    expect(daysIdle('not-a-date', now)).toBe(0)
  })

  it('does not go negative when the clock is skewed', () => {
    expect(daysIdle(new Date(now + 86400000).toISOString(), now)).toBe(0)
  })

  it('treats a week of silence as stale', () => {
    expect(STALE_DAYS).toBe(7)
    expect(daysIdle(new Date(now - 7 * 86400000).toISOString(), now)).toBe(7)
    expect(daysIdle(new Date(now - 6 * 86400000).toISOString(), now)).toBe(6)
  })
})

describe('newId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newId))
    expect(ids.size).toBe(500)
  })

  it('produces uuid-shaped ids', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})

describe('personKey', () => {
  it('folds case and surrounding whitespace so one person is one person', () => {
    expect(personKey('  Sam ')).toBe('sam')
    expect(personKey('SAM')).toBe(personKey('sam'))
  })

  it('handles junk without throwing', () => {
    expect(personKey(null)).toBe('')
    expect(personKey(undefined)).toBe('')
    expect(personKey(42)).toBe('42')
  })
})

describe('normalizeAssignees', () => {
  it('trims names', () => {
    expect(normalizeAssignees(['  Sam  '])).toEqual(['Sam'])
  })

  it('deduplicates case-insensitively, keeping the first spelling', () => {
    expect(normalizeAssignees(['Sam', 'SAM', 'sam'])).toEqual(['Sam'])
  })

  it('drops blanks and non-strings', () => {
    expect(normalizeAssignees(['Sam', '', '   ', null, {}, [], undefined])).toEqual(['Sam'])
  })

  it('returns an empty array for a non-array', () => {
    expect(normalizeAssignees('Sam')).toEqual([])
    expect(normalizeAssignees(null)).toEqual([])
    expect(normalizeAssignees({ 0: 'Sam' })).toEqual([])
  })

  it('caps the list length', () => {
    const many = Array.from({ length: 100 }, (_, i) => `P${i}`)
    expect(normalizeAssignees(many)).toHaveLength(LIMITS.assignees)
  })

  it('caps an individual name length', () => {
    expect(normalizeAssignees(['x'.repeat(500)])[0]).toHaveLength(LIMITS.assignee)
  })
})

describe('normalizeNote', () => {
  it('keeps a well-formed note', () => {
    const note = normalizeNote({ id: 'n1', author: 'Sam', text: 'hi', at: '2026-01-01T00:00:00.000Z' })
    expect(note).toEqual({ id: 'n1', author: 'Sam', text: 'hi', at: '2026-01-01T00:00:00.000Z' })
  })

  it('rejects a note with no text -- an empty note is not worth a row', () => {
    expect(normalizeNote({ author: 'Sam', text: '   ' })).toBeNull()
    expect(normalizeNote({ author: 'Sam' })).toBeNull()
    expect(normalizeNote(null)).toBeNull()
    expect(normalizeNote('hi')).toBeNull()
  })

  it('invents an id when one is missing', () => {
    expect(normalizeNote({ text: 'hi' }).id).toBeTruthy()
  })

  it('falls back to Anonymous for a missing author', () => {
    expect(normalizeNote({ text: 'hi' }).author).toBe('Anonymous')
    expect(normalizeNote({ text: 'hi', author: '  ' }).author).toBe('Anonymous')
  })

  it('replaces an unparseable timestamp rather than emitting Invalid Date', () => {
    const note = normalizeNote({ text: 'hi', at: 'yesterday-ish' })
    expect(Number.isNaN(Date.parse(note.at))).toBe(false)
  })
})

describe('normalizeNotes', () => {
  it('sorts oldest first', () => {
    const notes = normalizeNotes([
      { id: 'b', text: 'second', at: '2026-01-02T00:00:00.000Z' },
      { id: 'a', text: 'first', at: '2026-01-01T00:00:00.000Z' },
    ])
    expect(notes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('keeps insertion order for notes sharing a timestamp', () => {
    const at = '2026-01-01T00:00:00.000Z'
    const notes = normalizeNotes([
      { id: 'a', text: 'one', at },
      { id: 'b', text: 'two', at },
    ])
    expect(notes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('drops invalid entries without dropping the valid ones around them', () => {
    const notes = normalizeNotes([{ text: 'ok' }, null, 'junk', { text: '' }, { text: 'also ok' }])
    expect(notes.map((n) => n.text)).toEqual(['ok', 'also ok'])
  })

  it('returns empty for a non-array', () => {
    expect(normalizeNotes(null)).toEqual([])
    expect(normalizeNotes('[]')).toEqual([])
  })
})

describe('normalizeCard', () => {
  it('fills every field from an empty object', () => {
    const card = normalizeCard({})
    expect(card).toMatchObject({
      title: '',
      body: '',
      status: 'problem',
      tag: '',
      assignees: [],
      notes: [],
      position: 1000,
      board: 'main',
    })
    expect(card.id).toBeTruthy()
  })

  it('never throws, whatever it is handed', () => {
    for (const input of [null, undefined, 0, 'card', [], true, NaN]) {
      expect(() => normalizeCard(input)).not.toThrow()
      expect(normalizeCard(input).status).toBe('problem')
    }
  })

  it('rescues jsonb columns that arrived as JSON strings', () => {
    const card = normalizeCard({
      assignees: '["Sam","Alex"]',
      notes: '[{"id":"n1","text":"hi","at":"2026-01-01T00:00:00.000Z"}]',
    })
    expect(card.assignees).toEqual(['Sam', 'Alex'])
    expect(card.notes).toHaveLength(1)
  })

  it('falls back to empty when a jsonb string will not parse', () => {
    expect(normalizeCard({ assignees: '["Sam"' }).assignees).toEqual([])
  })

  it('coerces a numeric position sent as a string', () => {
    expect(normalizeCard({ position: '1500.5' }).position).toBe(1500.5)
  })

  it('rejects a non-numeric position', () => {
    expect(normalizeCard({ position: 'top' }).position).toBe(1000)
    expect(normalizeCard({ position: NaN }).position).toBe(1000)
    expect(normalizeCard({ position: Infinity }).position).toBe(1000)
  })

  it('does not let empty-ish values coerce to position 0', () => {
    // Number(null), Number('') and Number([]) are all 0, and 0 is a perfectly
    // valid position -- so these must be rejected explicitly or a row with a
    // null position column silently pins itself to the top of its column.
    for (const empty of [null, undefined, '', '   ', [], {}, false]) {
      expect(normalizeCard({ position: empty }).position).toBe(1000)
    }
  })

  it('still accepts a genuine zero position', () => {
    expect(normalizeCard({ position: 0 }).position).toBe(0)
    expect(normalizeCard({ position: '0' }).position).toBe(0)
  })

  it('keeps a negative position -- those are legitimate after top-inserts', () => {
    expect(normalizeCard({ position: -3000 }).position).toBe(-3000)
  })

  it('downgrades an unknown status to the default stage', () => {
    expect(normalizeCard({ status: 'archived' }).status).toBe('problem')
  })

  it('truncates oversized text instead of rejecting the card', () => {
    const card = normalizeCard({ title: 'x'.repeat(9999), body: 'y'.repeat(99999) })
    expect(card.title).toHaveLength(LIMITS.title)
    expect(card.body).toHaveLength(LIMITS.body)
  })

  it('leaves script-looking text exactly as written -- escaping is the DOM layer’s job', () => {
    const nasty = '<img src=x onerror=alert(1)>'
    expect(normalizeCard({ title: nasty }).title).toBe(nasty)
  })

  it('is idempotent', () => {
    const once = normalizeCard({ title: 'A', assignees: ['Sam', 'SAM'], position: '1500' })
    expect(normalizeCard(once)).toEqual(once)
  })
})

describe('makeNote', () => {
  it('stamps author, text and an ISO timestamp', () => {
    const note = makeNote('Sam', '  hello  ')
    expect(note.author).toBe('Sam')
    expect(note.text).toBe('hello')
    expect(note.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(note.id).toBeTruthy()
  })

  it('falls back to Anonymous for a blank author', () => {
    expect(makeNote('', 'hi').author).toBe('Anonymous')
  })

  it('survives round-tripping through the normalizer', () => {
    const note = makeNote('Sam', 'hello')
    expect(normalizeNote(note)).toEqual(note)
  })
})

describe('normalizePerson', () => {
  it('keeps a real name', () => {
    expect(normalizePerson({ name: 'Sam Rivera' }).name).toBe('Sam Rivera')
  })

  it('trims and caps the name', () => {
    expect(normalizePerson({ name: '  Sam  ' }).name).toBe('Sam')
    expect(normalizePerson({ name: 'x'.repeat(200) }).name).toHaveLength(LIMITS.assignee)
  })

  it('turns garbage into an empty name rather than throwing', () => {
    expect(normalizePerson(null).name).toBe('')
    expect(normalizePerson({ name: 12 }).name).toBe('12')
  })
})

describe('initials', () => {
  it('takes first and last initial for a full name', () => {
    expect(initials('Sam Rivera')).toBe('SR')
    expect(initials('Ada B. Lovelace')).toBe('AL')
  })

  it('takes the first two letters of a single name', () => {
    expect(initials('sam')).toBe('SA')
  })

  it('handles a one-character name', () => {
    expect(initials('S')).toBe('S')
  })

  it('collapses extra whitespace', () => {
    expect(initials('  Sam   Rivera  ')).toBe('SR')
  })

  it('returns a placeholder rather than blank for no name', () => {
    expect(initials('')).toBe('?')
    expect(initials(null)).toBe('?')
    expect(initials('   ')).toBe('?')
  })

  it('does not split surrogate pairs on emoji names', () => {
    const result = initials('\u{1F680}\u{1F680}')
    expect([...result]).toHaveLength(2)
    expect(result).toBe('\u{1F680}\u{1F680}')
  })

  it('handles non-latin scripts', () => {
    expect(initials('张 伟')).toBe('张伟')
  })
})

describe('avatarColor', () => {
  it('is stable for the same name, so every client agrees', () => {
    expect(avatarColor('Sam')).toBe(avatarColor('Sam'))
  })

  it('ignores case and whitespace, matching personKey', () => {
    expect(avatarColor('  SAM ')).toBe(avatarColor('sam'))
  })

  it('returns a parseable hsl() colour', () => {
    expect(avatarColor('Sam')).toMatch(/^hsl\(\d{1,3} \d{1,3}% \d{1,3}%\)$/)
  })

  it('spreads a realistic roster across many different hues', () => {
    const names = Array.from({ length: 40 }, (_, i) => `Person ${i}`)
    const hues = new Set(names.map((n) => avatarColor(n)))
    expect(hues.size).toBeGreaterThan(25)
  })

  it('keeps lightness dark enough for white text to stay readable', () => {
    for (let i = 0; i < 200; i++) {
      const [, , lightness] = avatarColor(`Person ${i}`).match(/hsl\((\d+) (\d+)% (\d+)%\)/).slice(1)
      expect(Number(lightness)).toBeLessThanOrEqual(42)
    }
  })
})
