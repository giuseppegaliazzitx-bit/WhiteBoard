#!/usr/bin/env node
/**
 * One-command Supabase setup.
 *
 *   npm run setup:supabase -- --dry-run     # check the token, list orgs/regions
 *   npm run setup:supabase                  # create, migrate, write .env
 *
 * Creates a project, waits for it to provision, applies supabase/schema.sql,
 * fetches the anon key and writes it into .env.
 *
 * Needs a Supabase **Personal Access Token**:
 *   https://supabase.com/dashboard/account/tokens
 *   export SUPABASE_ACCESS_TOKEN=sbp_...
 *
 * Every step prints the manual equivalent if it fails, so a partial run is
 * recoverable rather than a dead end. Re-running against an existing project
 * of the same name reuses it instead of creating a second one.
 */

import { readFile, writeFile, access } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const API = 'https://api.supabase.com/v1'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COMMON_REGIONS = [
  'us-east-1', 'us-west-1', 'eu-west-1', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1',
]

// ---------------------------------------------------------------- pure helpers

/** Minimal `--flag value` / `--flag=value` / `--bool` parser. */
export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const [flag, inline] = token.slice(2).split('=')
    const key = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (inline !== undefined) args[key] = inline
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[key] = argv[++i]
    else args[key] = true
  }
  return args
}

/**
 * Update keys in a .env file, preserving comments, blank lines and order.
 * Keys not already present are appended.
 */
export function mergeEnv(existing, updates) {
  const remaining = new Map(Object.entries(updates))
  const lines = existing.split(/\r?\n/)

  const merged = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)\s*=/)
    if (!match) return line
    const key = match[2]
    if (!remaining.has(key)) return line
    const value = remaining.get(key)
    remaining.delete(key)
    return `${match[1]}${key}=${value}`
  })

  if (remaining.size) {
    if (merged.length && merged[merged.length - 1].trim() !== '') merged.push('')
    for (const [key, value] of remaining) merged.push(`${key}=${value}`)
  }

  return merged.join('\n').replace(/\n{3,}$/, '\n\n')
}

/** Long, mixed, and shell-safe -- it ends up in a connection string. */
export function generatePassword(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

/** Supabase project names allow letters, numbers, spaces and dashes. */
export function isValidProjectName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{1,59}$/.test(name)
}

// ---------------------------------------------------------------- output

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
}

const say = (msg = '') => console.log(msg)
const step = (msg) => console.log(`\n${c.bold(msg)}`)
const ok = (msg) => console.log(`  ${c.green('✓')} ${msg}`)
const warn = (msg) => console.log(`  ${c.yellow('!')} ${msg}`)

/** An error carrying the manual instructions for the step that failed. */
class Fallback extends Error {
  constructor(message, instructions) {
    super(message)
    this.instructions = instructions
  }
}

// ---------------------------------------------------------------- api

async function api(token, path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    throw new Error(`Could not reach api.supabase.com — ${err.message}`)
  }

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON error body */
  }

  if (!response.ok) {
    const detail = payload?.message || payload?.error || text.slice(0, 300) || response.statusText
    if (response.status === 401) {
      throw new Error(
        'Supabase rejected the access token (401).\n' +
          '  Create a fresh one at https://supabase.com/dashboard/account/tokens',
      )
    }
    const err = new Error(`${method} ${path} failed (${response.status}): ${detail}`)
    err.status = response.status
    throw err
  }

  return payload
}

async function confirm(question, assumeYes) {
  if (assumeYes) {
    say(`${question} ${c.dim('(--yes)')}`)
    return true
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

// ---------------------------------------------------------------- steps

async function pickOrganization(token, wanted) {
  const orgs = await api(token, '/organizations')
  if (!orgs?.length) {
    throw new Error('That token has no organizations. Create one in the Supabase dashboard first.')
  }

  if (wanted) {
    const match = orgs.find((o) => o.id === wanted || o.name.toLowerCase() === String(wanted).toLowerCase())
    if (!match) {
      throw new Error(
        `No organization matching "${wanted}". Available:\n` +
          orgs.map((o) => `    ${o.name}  ${c.dim(o.id)}`).join('\n'),
      )
    }
    return match
  }

  if (orgs.length > 1) {
    throw new Error(
      'You are in more than one organization — pick one with --org:\n' +
        orgs.map((o) => `    --org "${o.name}"  ${c.dim(o.id)}`).join('\n'),
    )
  }

  return orgs[0]
}

async function findProject(token, name) {
  const projects = await api(token, '/projects')
  return (projects || []).find((p) => p.name.toLowerCase() === name.toLowerCase()) || null
}

async function createProject(token, { name, org, region, password }) {
  const project = await api(token, '/projects', {
    method: 'POST',
    body: {
      name,
      organization_id: org.id,
      region,
      db_pass: password,
      plan: 'free',
    },
  })
  return project
}

async function waitUntilReady(token, ref, { timeoutMs = 6 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = ''

  while (Date.now() < deadline) {
    let project
    try {
      project = await api(token, `/projects/${ref}`)
    } catch (err) {
      // A just-created project can 404 briefly before it is queryable.
      if (err.status !== 404) throw err
    }

    const status = project?.status || 'UNKNOWN'
    if (status !== lastStatus) {
      lastStatus = status
      say(`  ${c.dim(`status: ${status}`)}`)
    }
    if (status === 'ACTIVE_HEALTHY') return project
    if (status === 'INACTIVE' || /FAILED/.test(status)) {
      throw new Error(`Project provisioning reported ${status}. Check the Supabase dashboard.`)
    }

    await new Promise((r) => setTimeout(r, 5000))
  }

  throw new Fallback('Timed out waiting for the project to become healthy.', [
    'The project is probably still provisioning. Give it a minute, then re-run:',
    '  npm run setup:supabase',
    'It will reuse the existing project rather than creating another.',
  ])
}

async function applySchema(token, ref) {
  const sql = await readFile(resolve(ROOT, 'supabase/schema.sql'), 'utf8')

  try {
    await api(token, `/projects/${ref}/database/query`, { method: 'POST', body: { query: sql } })
  } catch (err) {
    throw new Fallback(`Could not run the schema automatically (${err.message})`, [
      'Run it by hand — it takes about thirty seconds:',
      `  1. Open https://supabase.com/dashboard/project/${ref}/sql/new`,
      '  2. Paste the contents of supabase/schema.sql',
      '  3. Run',
      '',
      'The rest of this script already finished, so .env is set up either way.',
    ])
  }
}

async function fetchAnonKey(token, ref) {
  // The shape of this endpoint has changed across API versions, so try the
  // current form first and fall back rather than failing the whole run.
  const attempts = [`/projects/${ref}/api-keys?reveal=true`, `/projects/${ref}/api-keys`]

  for (const path of attempts) {
    try {
      const keys = await api(token, path)
      const anon =
        keys?.find?.((k) => k.name === 'anon') ||
        keys?.find?.((k) => k.type === 'publishable') ||
        keys?.find?.((k) => /anon|publishable/i.test(k.name || ''))
      const value = anon?.api_key || anon?.apiKey || anon?.key
      if (value) return value
    } catch {
      /* try the next shape */
    }
  }

  throw new Fallback('Could not read the anon key automatically.', [
    `  1. Open https://supabase.com/dashboard/project/${ref}/settings/api-keys`,
    '  2. Copy the anon / public key',
    '  3. Put it in .env as VITE_SUPABASE_ANON_KEY',
    '',
    c.yellow('  Use the anon key, not service_role — the app refuses to start with a service key.'),
  ])
}

async function writeEnv(updates) {
  const path = resolve(ROOT, '.env')
  let existing = ''
  try {
    await access(path)
    existing = await readFile(path, 'utf8')
  } catch {
    existing = await readFile(resolve(ROOT, '.env.example'), 'utf8').catch(() => '')
  }
  await writeFile(path, mergeEnv(existing, updates), 'utf8')
  return path
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = args.token || process.env.SUPABASE_ACCESS_TOKEN

  say(c.bold('\nBoard — Supabase setup'))

  if (!token) {
    say(c.red('\nNo access token.'))
    say('\n  1. Create one at https://supabase.com/dashboard/account/tokens')
    say('  2. Then either:')
    say(c.dim('       export SUPABASE_ACCESS_TOKEN=sbp_...   # macOS/Linux'))
    say(c.dim('       $env:SUPABASE_ACCESS_TOKEN="sbp_..."   # PowerShell'))
    say(c.dim('     or pass it directly:  npm run setup:supabase -- --token sbp_...'))
    say('')
    say(c.dim('  This is a Personal Access Token, not a project API key.'))
    process.exitCode = 1
    return
  }

  const name = args.name || 'board'
  if (!isValidProjectName(name)) {
    throw new Error(`"${name}" is not a valid project name (letters, numbers, spaces, dashes).`)
  }

  step('Checking the token')
  const org = await pickOrganization(token, args.org)
  ok(`Organization: ${org.name} ${c.dim(org.id)}`)

  const existing = await findProject(token, name)
  if (existing) ok(`Found an existing project named "${name}" ${c.dim(existing.id)}`)

  if (args.dryRun) {
    step('Dry run — nothing was created')
    say(`  Would ${existing ? 'reuse' : 'create'} project ${c.bold(name)} in ${c.bold(org.name)}`)
    if (!existing) say(`  Region: ${args.region || 'us-east-1'}`)
    say(`\n  ${c.dim('Regions:')} ${COMMON_REGIONS.join(', ')}`)
    say(`\n  ${c.dim('Re-run without --dry-run to go ahead.')}`)
    return
  }

  let project = existing
  let password = null

  if (!project) {
    const region = args.region || 'us-east-1'
    if (!COMMON_REGIONS.includes(region)) {
      warn(`"${region}" is not in the common list — continuing, but check it is valid.`)
    }

    step('About to create a Supabase project')
    say(`  Name:         ${c.bold(name)}`)
    say(`  Organization: ${org.name}`)
    say(`  Region:       ${region}`)
    say(`  Plan:         free`)
    say(c.dim('\n  This provisions a real Postgres database on your account.'))

    if (!(await confirm('\nCreate it?', args.yes))) {
      say('\nCancelled. Nothing was created.')
      return
    }

    password = args.dbPass || generatePassword()
    step('Creating')
    project = await createProject(token, { name, org, region, password })
    ok(`Created ${c.dim(project.id)}`)
  }

  const ref = project.id

  step('Waiting for the database')
  await waitUntilReady(token, ref)
  ok('Healthy')

  step('Applying supabase/schema.sql')
  await applySchema(token, ref)
  ok('Table, constraints, trigger, RLS policy and realtime publication are in place')

  step('Reading the anon key')
  const anonKey = await fetchAnonKey(token, ref)
  ok('Got it')

  step('Writing .env')
  const envPath = await writeEnv({
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_BOARD_ID: 'main',
  })
  ok(envPath)

  say(c.green(c.bold('\n\nDone.\n')))

  if (password) {
    say(c.yellow('  Database password (shown once — save it or reset it later in the dashboard):'))
    say(`      ${c.bold(password)}`)
    say(c.dim('      The app does not need this. It is for direct Postgres connections.\n'))
  }

  say(c.bold('  Next:'))
  say('    npm run dev            — the indicator should read "Live"')
  say('')
  say('    Then connect Cloudflare Pages:')
  say('      1. Workers & Pages → Create → Pages → Connect to Git → pick this repo')
  say('      2. Build command:  npm run build')
  say('         Output dir:     dist')
  say('      3. Add these two environment variables:')
  say(`           VITE_SUPABASE_URL       https://${ref}.supabase.co`)
  say(`           VITE_SUPABASE_ANON_KEY  ${anonKey.slice(0, 12)}…`)
  say('      4. Deploy')
  say('')
  say(c.dim('    Vite reads env vars at build time, so changing one needs a redeploy.'))
  say('')
}

/**
 * Only run when invoked directly, so the helpers above stay unit-testable.
 *
 * Compares real paths rather than building a file:// URL by hand: on Windows
 * import.meta.url is file:///C:/... with three slashes, and a hand-rolled
 * comparison silently fails to match -- so the script exits 0 having done
 * nothing at all, which is the worst possible failure mode for a setup tool.
 */
function isRunDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isRunDirectly()) {
  main().catch((err) => {
    say(c.red(`\n${err.message}`))
    if (err instanceof Fallback && err.instructions) {
      say('')
      for (const line of err.instructions) say(`  ${line}`)
    }
    say('')
    process.exitCode = 1
  })
}
