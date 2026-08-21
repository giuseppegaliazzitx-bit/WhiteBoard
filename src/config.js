/**
 * Configuration, read from the .env file at build time.
 *
 * Vite inlines `import.meta.env.VITE_*` into the bundle, so these values are
 * baked into the deployed JavaScript and are public. That is fine for the anon
 * key -- which is meant to be public and is constrained by RLS -- and is
 * exactly why `looksLikeServiceKey` exists below.
 */

/** A Supabase project URL: https://<ref>.supabase.co */
const URL_SHAPE = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in|red)$/i

/**
 * Is this a service_role key?
 *
 * Pasting the service key instead of the anon key is the one configuration
 * mistake here with real consequences: it bypasses RLS entirely, so anyone who
 * loads the page gets unrestricted database access, not just access to `cards`.
 * Legacy Supabase keys are unsigned-readable JWTs, so the role is right there
 * in the payload and we can refuse to start.
 */
export function looksLikeServiceKey(key) {
  if (typeof key !== 'string') return false
  if (key.startsWith('sb_secret_')) return true // newer secret-key format

  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function looksLikeAnonKey(key) {
  if (typeof key !== 'string' || !key) return false
  // Legacy anon keys are JWTs; the current format is sb_publishable_...
  return key.startsWith('eyJ') || key.startsWith('sb_publishable_')
}

/**
 * @returns {{ mode: 'supabase'|'local', problems: string[] }}
 *   `problems` is non-empty only when the values are present but wrong --
 *   blank values are a valid choice, not an error.
 */
export function validateSupabaseConfig(url, key) {
  const hasUrl = Boolean(url)
  const hasKey = Boolean(key)
  const problems = []

  if (!hasUrl && !hasKey) return { mode: 'local', problems }

  if (hasUrl !== hasKey) {
    problems.push(
      hasUrl
        ? 'VITE_SUPABASE_URL is set but VITE_SUPABASE_ANON_KEY is missing.'
        : 'VITE_SUPABASE_ANON_KEY is set but VITE_SUPABASE_URL is missing.',
    )
    return { mode: 'local', problems }
  }

  if (!URL_SHAPE.test(url)) {
    problems.push(
      `VITE_SUPABASE_URL does not look like a Supabase project URL: "${url}". ` +
        'Expected something like https://abcdefgh.supabase.co',
    )
  }

  if (looksLikeServiceKey(key)) {
    problems.push(
      'VITE_SUPABASE_ANON_KEY is a service_role key. That key bypasses row ' +
        'level security and would be published in the page source. Use the ' +
        'anon / public key instead.',
    )
  } else if (!looksLikeAnonKey(key)) {
    problems.push('VITE_SUPABASE_ANON_KEY does not look like a Supabase anon key.')
  }

  return { mode: problems.length ? 'local' : 'supabase', problems }
}

function env(name, fallback = '') {
  const value = import.meta.env?.[name]
  return typeof value === 'string' ? value.trim() : fallback
}

const supabaseUrl = env('VITE_SUPABASE_URL')
const supabaseAnonKey = env('VITE_SUPABASE_ANON_KEY')
const { mode, problems } = validateSupabaseConfig(supabaseUrl, supabaseAnonKey)

export const config = {
  supabaseUrl,
  supabaseAnonKey,
  boardId: env('VITE_BOARD_ID') || 'main',
  /** 'supabase' when both values are present and sane, otherwise 'local'. */
  mode,
  /** Misconfiguration to surface to the user; empty when all is well. */
  problems,
}
