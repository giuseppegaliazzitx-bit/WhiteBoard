# Security

Read this before putting anything on the board that would matter if a stranger
read it, changed it, or deleted it.

## What the design actually gives you

There is no login. The Supabase anon key is compiled into the page source,
where anyone who loads the page can read it. The RLS policy in
`supabase/schema.sql` grants that key full read and write access to every card
on every board:

```sql
create policy "board access" on public.cards
  for all to anon, authenticated
  using (true) with check (true);
```

So the honest summary is: **anyone who can reach the URL can read every card,
edit every card, and delete every card** — from the page, or from `curl`.

There is no way around this for a static page with no login. The key has to be
in the page for the page to talk to the database.

### When that is fine

- The board is internal and low-stakes
- The URL is not published anywhere
- Nothing on it would hurt if it leaked
- You could recover from someone wiping it

### When it is not

- It holds anything confidential — customer names, incident detail, credentials
- A stranger deleting the board would be a real problem
- You need to know who actually wrote something

Deploying to Cloudflare Pages gives you a public `*.pages.dev` URL. It is
unguessable, but it is not private, and it is not access control.

## Identity is self-asserted

Your name lives in `localStorage` and is attached to notes you write. Nothing
verifies it. Anyone can type someone else's name and post as them. For a few
people who trust each other this is fine; treat note authorship as a
convenience, not as evidence.

## What the app does defend against

These are real and worth having even in a trusting setup, because a board with
open writes is one where a bad string arrives eventually.

**No user content ever reaches `innerHTML`.** Titles, tags, notes and names go
through `textContent` or `setAttribute`. `src/ui/dom.js` exists to make that
the only convenient way to build DOM.

**Every row is normalized on read.** `normalizeCard` in `src/model.js` is the
single trust boundary. Rows from `localStorage`, from `jsonb` columns edited by
hand in the Supabase table view, and from realtime payloads are all coerced to
a valid shape before anything else sees them. It never throws.

**The client cannot write columns it does not own.** The Supabase adapter sends
an allowlist — `title, body, status, tag, assignees, notes, position` — so a
patch cannot rewrite `id`, `board` or `created_at`. `updated_at` is set by a
database trigger, not by the client, because client clocks disagree.

**The database enforces its own invariants.** `schema.sql` adds check
constraints on `status`, on the `jsonb` shapes, on field lengths, and on
`position` being finite. The client is not the only thing that can write to
this table, so the constraints are not decorative.

**A `service_role` key is refused at startup.** Pasting the service key instead
of the anon key is the one configuration mistake here with real consequences —
it bypasses RLS entirely, giving anyone who loads the page unrestricted
database access rather than access to `cards`. `src/config.js` decodes the key,
checks the role claim, and falls back to local storage with a visible error
instead of starting.

**A CSP ships with the build.** `public/_headers` restricts scripts to same
origin and connections to Supabase, so an injected string has nowhere to send
anything even if one slipped through.

## Locking it down

The upgrade path is Supabase Auth with magic links:

1. Turn on email auth in the Supabase dashboard.
2. Change the policy from `to anon, authenticated` to `to authenticated`.
3. Add a sign-in screen and use the session's user for identity instead of the
   `localStorage` name.

The data model does not change — no migration, no rewrite. Roughly an
afternoon.

If you want per-person visibility rather than just "logged in", that is a
larger change: it needs an owner or membership column and a policy that reads
`auth.uid()`.

## Reporting

This is an internal tool with no external users. If you find something, open an
issue on the repository.
