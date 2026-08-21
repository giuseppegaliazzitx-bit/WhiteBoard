# Board

A shared work board with four stages: **Problem → Idea → In progress → Done**.
Cards can be created in any stage, assigned to people, and carry a running
thread of notes. Everyone with the URL sees the same board, live.

One static page, one database table, free hosting.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

That runs against **browser storage** — fully working, but private to your
browser. To make it shared, connect Supabase (below).

```bash
npm test             # 358 tests
npm run build        # -> dist/
npm run preview      # serve the build
```

---

## Connecting Supabase

### Option A — scripted

```bash
# 1. Create a Personal Access Token: https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN=sbp_...        # PowerShell: $env:SUPABASE_ACCESS_TOKEN="sbp_..."

# 2. See what it would do, without creating anything
npm run setup:supabase -- --dry-run

# 3. Go
npm run setup:supabase
```

It creates the project, waits for the database, applies `supabase/schema.sql`,
reads the anon key and writes `.env`. It asks before creating anything, and
re-running reuses a project of the same name rather than making a second one.

| Flag | Default | |
|---|---|---|
| `--dry-run` | | check the token and report, create nothing |
| `--name` | `board` | project name |
| `--org` | your only org | required if you are in more than one |
| `--region` | `us-east-1` | e.g. `eu-west-1`, `ap-southeast-2` |
| `--yes` | | skip the confirmation prompt |

If any step fails it prints the manual equivalent for that step, so a partial
run is recoverable rather than a dead end.

### Option B — by hand

1. Create a project at [supabase.com](https://supabase.com).
2. *SQL Editor* → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
   Safe to re-run.
3. `cp .env.example .env`, then fill in from *Project Settings → API*:

```ini
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### Checking it worked

```bash
npm run doctor                                        # local setup
npm run doctor -- --url https://your-board.pages.dev  # and the deployed one
```

It reports exactly what is missing and how to fix it. With `--url` it also
fetches the deployed JavaScript and confirms the Supabase values were baked
into it — see the Cloudflare section for why that matters.

Restart the dev server. The indicator top-right should read **Live** instead of
*This browser only*.

> Use the **anon / public** key, never `service_role`. The app decodes the key
> and refuses to start with a service key — it bypasses row level security and
> would be published in the page source. See [SECURITY.md](SECURITY.md).

Leaving both values blank is a supported configuration, not a broken one: the
board runs on `localStorage` and never loads the Supabase library at all.

---

## Deploying to Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and pick the repo.
3. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. **Environment variables** → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` with the same values as your `.env`. Vite reads
   them at build time, so a change needs a redeploy, not just a refresh.
5. Deploy.

> **The step that silently breaks things:** `.env` is gitignored, so Cloudflare
> never sees it. If you skip step 4, the build runs with blank values and every
> visitor gets their own private `localStorage` board. It looks like it works —
> cards save, nothing errors — but nobody is sharing anything. Set the two
> variables for **both Production and Preview**, then **Deployments → Retry
> deployment**: Vite reads env vars at build time, so an existing build will not
> pick them up.
>
> `npm run doctor -- --url https://your-board.pages.dev` checks this for you.

`public/_headers` ships a CSP and cache policy that Cloudflare applies
automatically. Assets are hashed and cached for a year; `index.html` is not
cached, so a deploy reaches people immediately.

The same build works unchanged on Netlify, Vercel or GitHub Pages — only
Cloudflare reads `_headers`, so on the others you would set headers their way.

---

## How it works

```
browser (one page, no framework)
      │
      ├── store interface ──┬── localStorage adapter    (blank .env)
      │                     └── Supabase adapter        (.env filled in)
      │
      └── sync controller: realtime socket + poll fallback + wake-on-visible
```

**Everything goes through one store interface** — `list / create / update /
remove / subscribe / onStatus`. Both adapters are held to the same contract
suite (`tests/helpers/store-contract.js`), which is what makes "the UI cannot
tell them apart" a checkable claim rather than a hope.

**Ordering is fractional.** Each card has a float `position`. Dropping a card
between two others sets its position to their midpoint, so a move is always a
single-row write — no reindexing, no cascade when two people drag at once.
Splitting the same gap ~50 times exhausts the float; the code detects that and
renumbers the one affected column rather than silently writing duplicates.

**Writes are optimistic.** The local copy changes first and the write follows.
A failure rolls the change back and says so, so the UI never shows a state the
database rejected.

**Notes and assignees live in `jsonb` on the card**, not in separate tables. A
card is always loaded whole and they are never queried independently, so this
keeps the whole app to one read and one write.

### Layout

```
index.html
src/
  main.js          wiring: state, mutations, event handlers
  model.js         stages, card shape, normalizeCard (the trust boundary)
  position.js      fractional ordering
  filters.js       search and filter logic
  selectors.js     grouping, people, progress
  sync.js          realtime + poll + backoff
  config.js        .env reading and validation
  store/           index.js (factory), local.js, supabase.js
  ui/              board, card, detail, dnd, modal, toast, identity, theme
supabase/schema.sql
tests/             358 tests
```

---

## Keyboard

| Key | Does |
|---|---|
| `n` | New card |
| `/` | Focus search |
| `Esc` | Clear filters · close drawer · cancel a drag |
| `Ctrl`/`Cmd` + `←` `→` | Move the focused card between columns |
| `Ctrl`/`Cmd` + `↑` `↓` | Move the focused card within its column |
| `Ctrl`/`Cmd` + `Enter` | Post a note |

Dragging is a pointer gesture, so the arrow-key moves exist to make reordering
possible without one.

## Search

| Type | Gets |
|---|---|
| `csv` | anything matching, across title, tag, description, assignees and notes |
| `tag:infra` | cards tagged infra |
| `@sam` | cards assigned to someone matching "sam" |
| `is:done` | cards in Done (`is:wip`, `is:todo` also work) |

Terms combine with AND. Repeating one prefix ORs — `is:idea is:progress` means
either.

---

## Known limitations

**Concurrent note posts can drop one.** `notes` is a `jsonb` array updated by
read-modify-write, so two people posting within the same round trip can lose
one of the two. The fix is a Postgres function that appends server-side; it was
not worth the extra setup step at this size, but that is the path if it starts
biting.

**Names are self-asserted.** There is no login. Nothing stops someone typing a
different name on a note. See [SECURITY.md](SECURITY.md).

**Touch dragging is best-effort.** A long press starts a drag, but if the
browser has already claimed the gesture for scrolling it cancels. The stage
buttons in the card detail panel are the reliable way to move a card on a
phone, and that is why they exist.

**Free Supabase projects pause** after a week of no activity. Opening the board
un-pauses it, but the first load after that takes a minute.

---

## Testing

```bash
npm test              # once
npm run test:watch    # watch
```

Unit tests cover the pure logic (ordering, normalization, filters, formatting).
DOM tests cover the detail drawer and the drag controller against stubbed
geometry. `tests/app.smoke.test.js` boots the real `main.js` against the real
store and drives it end to end — that is the one that catches a bad import or a
handler wired to the wrong element.

The Supabase adapter runs the same contract suite as the localStorage one,
against an in-memory fake client that models column defaults, the `updated_at`
trigger, immutable `created_at` and PostgREST's `PGRST116`.
