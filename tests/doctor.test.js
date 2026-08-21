import { describe, it, expect } from 'vitest'
import { parseEnv, projectRef, extractAssetUrls } from '../scripts/doctor.mjs'

describe('parseEnv', () => {
  it('reads simple assignments', () => {
    expect(parseEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' })
  })

  it('ignores comments and blank lines', () => {
    expect(parseEnv('# note\n\nA=1\n   \n# another')).toEqual({ A: '1' })
  })

  it('keeps a value containing = signs, like a JWT', () => {
    expect(parseEnv('K=eyJhbGci.abc=def==').K).toBe('eyJhbGci.abc=def==')
  })

  it('trims surrounding whitespace', () => {
    expect(parseEnv('  A =  spaced  ')).toEqual({ A: 'spaced' })
  })

  it('strips one layer of matching quotes', () => {
    expect(parseEnv('A="quoted"').A).toBe('quoted')
    expect(parseEnv("B='quoted'").B).toBe('quoted')
  })

  it('leaves mismatched quotes alone', () => {
    expect(parseEnv('A="unbalanced').A).toBe('"unbalanced')
  })

  it('treats an empty value as empty, not missing', () => {
    expect(parseEnv('A=')).toEqual({ A: '' })
  })

  it('handles CRLF', () => {
    expect(parseEnv('A=1\r\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('ignores a commented-out assignment', () => {
    expect(parseEnv('# A=1\nB=2')).toEqual({ B: '2' })
  })
})

describe('projectRef', () => {
  it('pulls the ref out of a project URL', () => {
    expect(projectRef('https://riaxuvnubhdiadtofjia.supabase.co')).toBe('riaxuvnubhdiadtofjia')
  })

  it('handles regional domains and trailing paths', () => {
    expect(projectRef('https://abc.supabase.in/rest/v1')).toBe('abc')
  })

  it('returns null for anything else', () => {
    for (const bad of ['', null, undefined, 'http://abc.supabase.co', 'https://example.com']) {
      expect(projectRef(bad)).toBeNull()
    }
  })
})

describe('extractAssetUrls', () => {
  const BASE = 'https://board.pages.dev/'

  it('finds module scripts and resolves them against the page', () => {
    const html = '<script type="module" crossorigin src="/assets/index-abc.js"></script>'
    expect(extractAssetUrls(html, BASE)).toEqual(['https://board.pages.dev/assets/index-abc.js'])
  })

  it('finds modulepreload links, which is where Vite puts split chunks', () => {
    const html = '<link rel="modulepreload" crossorigin href="/assets/supabase-xyz.js">'
    expect(extractAssetUrls(html, BASE)).toContain('https://board.pages.dev/assets/supabase-xyz.js')
  })

  it('handles relative paths from a base:./ build', () => {
    const html = '<script src="./assets/index-abc.js"></script>'
    expect(extractAssetUrls(html, BASE)).toEqual(['https://board.pages.dev/assets/index-abc.js'])
  })

  it('deduplicates', () => {
    const html = '<script src="/a.js"></script><link href="/a.js">'
    expect(extractAssetUrls(html, BASE)).toHaveLength(1)
  })

  it('ignores stylesheets', () => {
    const html = '<link rel="stylesheet" href="/assets/index.css">'
    expect(extractAssetUrls(html, BASE)).toEqual([])
  })

  it('returns empty for a page with no scripts', () => {
    expect(extractAssetUrls('<html><body>hi</body></html>', BASE)).toEqual([])
  })

  it('skips an unparseable href rather than throwing', () => {
    const html = '<script src="ht tp://bad url"></script><script src="/ok.js"></script>'
    expect(() => extractAssetUrls(html, BASE)).not.toThrow()
    expect(extractAssetUrls(html, BASE)).toContain('https://board.pages.dev/ok.js')
  })
})
