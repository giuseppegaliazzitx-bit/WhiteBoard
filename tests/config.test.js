import { describe, it, expect } from 'vitest'
import { validateSupabaseConfig, looksLikeServiceKey } from '../src/config.js'

/** Build a Supabase-style JWT with the given role claim. */
function jwt(role) {
  const b64 = (obj) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.sig`
}

const ANON = jwt('anon')
const SERVICE = jwt('service_role')
const URL = 'https://abcdefghijkl.supabase.co'

describe('looksLikeServiceKey', () => {
  it('spots a legacy service_role JWT', () => {
    expect(looksLikeServiceKey(SERVICE)).toBe(true)
  })

  it('spots the newer secret key format', () => {
    expect(looksLikeServiceKey('sb_secret_abc123')).toBe(true)
  })

  it('clears an anon key', () => {
    expect(looksLikeServiceKey(ANON)).toBe(false)
    expect(looksLikeServiceKey('sb_publishable_abc123')).toBe(false)
  })

  it('does not throw on junk', () => {
    for (const junk of ['', 'not.a.jwt', 'a.b', null, undefined, 42, {}]) {
      expect(() => looksLikeServiceKey(junk)).not.toThrow()
      expect(looksLikeServiceKey(junk)).toBe(false)
    }
  })
})

describe('validateSupabaseConfig', () => {
  it('treats both-blank as a deliberate choice to run locally', () => {
    expect(validateSupabaseConfig('', '')).toEqual({ mode: 'local', problems: [] })
  })

  it('accepts a well-formed pair', () => {
    expect(validateSupabaseConfig(URL, ANON)).toEqual({ mode: 'supabase', problems: [] })
  })

  it('accepts the newer publishable key format', () => {
    expect(validateSupabaseConfig(URL, 'sb_publishable_abc123').mode).toBe('supabase')
  })

  it('refuses a service_role key and says why', () => {
    const { mode, problems } = validateSupabaseConfig(URL, SERVICE)
    expect(mode).toBe('local')
    expect(problems.join(' ')).toMatch(/service_role/)
    expect(problems.join(' ')).toMatch(/row level security/i)
  })

  it('complains when only one of the pair is set', () => {
    expect(validateSupabaseConfig(URL, '').problems[0]).toMatch(/ANON_KEY is missing/)
    expect(validateSupabaseConfig('', ANON).problems[0]).toMatch(/URL is missing/)
  })

  it('rejects a URL that is not a Supabase project URL', () => {
    for (const bad of ['http://abc.supabase.co', 'https://example.com', 'abc.supabase.co', 'https://supabase.co']) {
      const { mode, problems } = validateSupabaseConfig(bad, ANON)
      expect(mode, bad).toBe('local')
      expect(problems.join(' ')).toMatch(/SUPABASE_URL/)
    }
  })

  it('accepts the regional domains', () => {
    expect(validateSupabaseConfig('https://abc.supabase.in', ANON).mode).toBe('supabase')
  })

  it('rejects a key that is not shaped like either format', () => {
    const { mode, problems } = validateSupabaseConfig(URL, 'hunter2')
    expect(mode).toBe('local')
    expect(problems.join(' ')).toMatch(/anon key/i)
  })

  it('falls back to local rather than starting with a broken connection', () => {
    expect(validateSupabaseConfig('https://example.com', 'hunter2').mode).toBe('local')
  })
})
