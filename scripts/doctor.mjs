#!/usr/bin/env node
/**
 * Checks the setup and says exactly what is still missing.
 *
 *   npm run doctor
 *   npm run doctor -- --url https://your-board.pages.dev
 *
 * Local checks: .env is present, the values are the right shape, the Supabase
 * project answers, and the cards table exists and is readable.
 *
 * With --url it also fetches the deployed JavaScript and checks the Supabase
 * values were actually baked into it. That catches the one Cloudflare failure
 * that looks like success: .env is gitignored, so if the environment variables
 * are not also set in the Pages dashboard, the deploy builds with blank values
 * and every visitor silently gets their own private localStorage board.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { validateSupabaseConfig } from '../src/config.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
}

const say = (m = '') => console.log(m)
const pass = (m) => say(`  ${c.green('✓')} ${m}`)
const fail = (m) => say(`  ${c.red('✗')} ${m}`)
const warn = (m) => say(`  ${c.yellow('!')} ${m}`)
const hint = (m) => say(`      ${c.dim(m)}`)

// ---------------------------------------------------------------- pure helpers

/** Minimal .env parser: KEY=value, ignoring comments and blank lines. */
export function parseEnv(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    // Strip one layer of matching quotes, the way dotenv does.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

/** Project ref from a Supabase URL: https://abc.supabase.co -> abc */
export function projectRef(url) {
  const match = String(url || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\./i)
  return match ? match[1] : null
}

/** Script/module URLs referenced by an HTML document. */
export function extractAssetUrls(html, base) {
  const urls = new Set()
  const patterns = [/<script[^>]+src="([^"]+)"/gi, /<link[^>]+href="([^"]+\.js)"/gi]
  for (const pattern of patterns) {
    for (const [, href] of html.matchAll(pattern)) {
      try {
        urls.add(new URL(href, base).href)
      } catch {
        /* skip anything unparseable */
      }
    }
  }
  return [...urls]
}

// ---------------------------------------------------------------- checks

async function checkEnv() {
  say(c.bold('\n1. Local .env'))

  let raw
  try {
    raw = await readFile(resolve(ROOT, '.env'), 'utf8')
  } catch {
    fail('No .env file')
    hint('cp .env.example .env, then fill in the two Supabase values')
    return null
  }

  const env = parseEnv(raw)
  const url = env.VITE_SUPABASE_URL || ''
  const key = env.VITE_SUPABASE_ANON_KEY || ''

  if (!url && !key) {
    warn('Both Supabase values are blank — the board will run on localStorage only')
    hint('That is a valid setup, just not a shared one')
    return null
  }

  const { mode, problems } = validateSupabaseConfig(url, key)
  if (problems.length) {
    for (const problem of problems) fail(problem)
    return null
  }

  pass(`URL  ${url}`)
  pass(`Key  ${key.slice(0, 18)}… ${c.dim(`(${key.length} chars)`)}`)
  pass(`Mode ${mode}`)
  return { url, key }
}

async function checkProject({ url, key }) {
  say(c.bold('\n2. Supabase project'))

  let response
  let body = ''
  try {
    response = await fetch(`${url}/rest/v1/cards?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    body = await response.text()
  } catch (err) {
    fail(`Could not reach the project — ${err.message}`)
    hint('A free project pauses after a week idle; open the dashboard to wake it')
    return false
  }

  let payload = null
  try {
    payload = body ? JSON.parse(body) : null
  } catch {
    /* not JSON */
  }

  if (response.status === 401 || response.status === 403) {
    fail(`Supabase rejected the key (${response.status})`)
    hint(payload?.message || 'Check VITE_SUPABASE_ANON_KEY against Project Settings → API')
    return false
  }

  if (payload?.code === 'PGRST205' || response.status === 404) {
    fail('The cards table does not exist yet')
    const ref = projectRef(url)
    hint('Run supabase/schema.sql:')
    hint(`  https://supabase.com/dashboard/project/${ref}/sql/new`)
    return false
  }

  if (!response.ok) {
    fail(`Unexpected response ${response.status}: ${payload?.message || body.slice(0, 160)}`)
    return false
  }

  pass('cards table exists')
  pass(`RLS allows the anon key to read it ${c.dim(`(${(payload || []).length} row(s) sampled)`)}`)
  hint('The policy is "for all", so writes use the same rule as reads')
  return true
}

async function checkDeployment(siteUrl, { url }) {
  say(c.bold('\n3. Deployed build'))

  const ref = projectRef(url)
  let html

  try {
    const response = await fetch(siteUrl, { redirect: 'follow' })
    if (!response.ok) {
      fail(`${siteUrl} returned HTTP ${response.status}`)
      return false
    }
    html = await response.text()
  } catch (err) {
    fail(`Could not fetch ${siteUrl} — ${err.message}`)
    return false
  }

  pass(`${siteUrl} is up`)

  const assets = extractAssetUrls(html, siteUrl)
  if (!assets.length) {
    warn('No script tags found — is that the right URL?')
    return false
  }

  let found = false
  for (const asset of assets) {
    try {
      const js = await fetch(asset).then((r) => (r.ok ? r.text() : ''))
      if (js.includes(ref)) {
        found = true
        break
      }
    } catch {
      /* try the next asset */
    }
  }

  if (found) {
    pass('The Supabase project is baked into the deployed JavaScript')
    pass('Everyone visiting this URL shares one board')
    return true
  }

  fail('The deployed build has NO Supabase configuration in it')
  hint('.env is gitignored, so Cloudflare never saw those values.')
  hint('Every visitor is silently getting their own private localStorage board.')
  hint('')
  hint('Fix: Cloudflare dashboard → your Pages project → Settings →')
  hint('     Environment variables → add for Production AND Preview:')
  hint(`       VITE_SUPABASE_URL       ${url}`)
  hint('       VITE_SUPABASE_ANON_KEY  <your anon key>')
  hint('     then Deployments → Retry deployment (Vite reads env at BUILD time,')
  hint('     so an existing build will not pick them up).')
  return false
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2)
  const urlIndex = args.findIndex((a) => a === '--url' || a.startsWith('--url='))
  const siteUrl =
    urlIndex === -1
      ? null
      : args[urlIndex].includes('=')
        ? args[urlIndex].split('=').slice(1).join('=')
        : args[urlIndex + 1]

  say(c.bold('\nBoard — setup check'))

  const env = await checkEnv()
  if (!env) {
    say(c.dim('\nStopping here — fix the above, then re-run.\n'))
    process.exitCode = 1
    return
  }

  const projectOk = await checkProject(env)

  let deployOk = null
  if (siteUrl) deployOk = await checkDeployment(siteUrl, env)
  else {
    say(c.bold('\n3. Deployed build'))
    say(c.dim('  Skipped. Pass --url https://your-board.pages.dev to check it.'))
  }

  say('')
  if (projectOk && deployOk !== false) {
    say(c.green(c.bold('  Everything checks out.')))
    if (deployOk === null) say(c.dim('  Deployment not checked — pass --url to include it.'))
  } else {
    say(c.yellow(c.bold('  Not ready yet — see above.')))
    process.exitCode = 1
  }
  say('')
}

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
    say(c.red(`\n${err.message}\n`))
    process.exitCode = 1
  })
}
