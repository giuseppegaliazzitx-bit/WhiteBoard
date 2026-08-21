import { describe, it, expect } from 'vitest'
import {
  parseArgs,
  mergeEnv,
  generatePassword,
  isValidProjectName,
} from '../scripts/setup-supabase.mjs'

describe('parseArgs', () => {
  it('reads --flag value', () => {
    expect(parseArgs(['--org', 'Acme'])).toEqual({ org: 'Acme' })
  })

  it('reads --flag=value', () => {
    expect(parseArgs(['--org=Acme'])).toEqual({ org: 'Acme' })
  })

  it('treats a trailing flag as a boolean', () => {
    expect(parseArgs(['--yes'])).toEqual({ yes: true })
    expect(parseArgs(['--dry-run', '--yes'])).toEqual({ dryRun: true, yes: true })
  })

  it('camel-cases dashed flags so --dry-run reads as dryRun', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true })
    expect(parseArgs(['--db-pass', 'hunter2'])).toEqual({ dbPass: 'hunter2' })
  })

  it('ignores stray positional arguments', () => {
    expect(parseArgs(['noise', '--org', 'Acme'])).toEqual({ org: 'Acme' })
  })

  it('returns an empty object for no arguments', () => {
    expect(parseArgs([])).toEqual({})
  })
})

describe('mergeEnv', () => {
  const EXAMPLE = [
    '# Copy this file to `.env`',
    '',
    'VITE_SUPABASE_URL=',
    'VITE_SUPABASE_ANON_KEY=',
    '',
    'VITE_BOARD_ID=main',
  ].join('\n')

  it('fills in blank values', () => {
    const out = mergeEnv(EXAMPLE, { VITE_SUPABASE_URL: 'https://x.supabase.co' })
    expect(out).toContain('VITE_SUPABASE_URL=https://x.supabase.co')
  })

  it('keeps comments and blank lines exactly where they were', () => {
    const out = mergeEnv(EXAMPLE, { VITE_SUPABASE_URL: 'https://x.supabase.co' })
    expect(out.split('\n')[0]).toBe('# Copy this file to `.env`')
    expect(out.split('\n')[1]).toBe('')
  })

  it('overwrites an existing value rather than appending a duplicate', () => {
    const out = mergeEnv('VITE_BOARD_ID=old', { VITE_BOARD_ID: 'new' })
    expect(out).toBe('VITE_BOARD_ID=new')
    expect(out.match(/VITE_BOARD_ID/g)).toHaveLength(1)
  })

  it('appends a key that is not there yet', () => {
    const out = mergeEnv('VITE_BOARD_ID=main', { NEW_KEY: 'value' })
    expect(out).toContain('VITE_BOARD_ID=main')
    expect(out).toContain('NEW_KEY=value')
  })

  it('leaves a commented-out key commented, and appends the real one', () => {
    // A commented line is not an assignment, so it must not be rewritten.
    const out = mergeEnv('# VITE_BOARD_ID=main', { VITE_BOARD_ID: 'other' })
    expect(out).toContain('# VITE_BOARD_ID=main')
    expect(out).toContain('\nVITE_BOARD_ID=other')
  })

  it('handles an empty starting file', () => {
    expect(mergeEnv('', { A: '1' })).toContain('A=1')
  })

  it('handles CRLF line endings', () => {
    const out = mergeEnv('A=1\r\nB=2', { B: '3' })
    expect(out).toContain('B=3')
    expect(out).toContain('A=1')
  })

  it('does not touch keys it was not asked about', () => {
    const out = mergeEnv('KEEP=me\nCHANGE=old', { CHANGE: 'new' })
    expect(out).toContain('KEEP=me')
    expect(out).toContain('CHANGE=new')
  })

  it('applies several updates at once', () => {
    const out = mergeEnv(EXAMPLE, {
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJabc',
      VITE_BOARD_ID: 'main',
    })
    expect(out).toContain('VITE_SUPABASE_URL=https://x.supabase.co')
    expect(out).toContain('VITE_SUPABASE_ANON_KEY=eyJabc')
    expect(out).toContain('VITE_BOARD_ID=main')
  })
})

describe('generatePassword', () => {
  it('is long enough to be worth having', () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(24)
  })

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generatePassword()))
    expect(seen.size).toBe(100)
  })

  it('avoids characters that would need quoting in a connection string', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('isValidProjectName', () => {
  it('accepts ordinary names', () => {
    expect(isValidProjectName('board')).toBe(true)
    expect(isValidProjectName('Team Board')).toBe(true)
    expect(isValidProjectName('board-2')).toBe(true)
  })

  it('rejects names Supabase would refuse', () => {
    expect(isValidProjectName('')).toBe(false)
    expect(isValidProjectName('a')).toBe(false)
    expect(isValidProjectName('-leading')).toBe(false)
    expect(isValidProjectName('has/slash')).toBe(false)
    expect(isValidProjectName('x'.repeat(100))).toBe(false)
    expect(isValidProjectName(null)).toBe(false)
  })
})
