-- =============================================================================
-- Board schema
--
-- Run once against your Supabase project:
--   Dashboard -> SQL Editor -> paste -> Run
--
-- Safe to re-run: every statement is guarded.
-- =============================================================================

create table if not exists public.cards (
  id         uuid primary key default gen_random_uuid(),
  title      text        not null default '',
  body       text        not null default '',
  status     text        not null default 'problem',
  tag        text        not null default '',
  assignees  jsonb       not null default '[]'::jsonb,
  notes      jsonb       not null default '[]'::jsonb,
  position   double precision not null default 1000,
  board      text        not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Older installs predate the board column.
alter table public.cards add column if not exists board text not null default 'main';

-- -----------------------------------------------------------------------------
-- Constraints
--
-- The client normalizes everything it writes, but the client is not the only
-- thing that can write here -- the anon key works from curl too. These are the
-- guarantees the application actually relies on.
-- -----------------------------------------------------------------------------
do $$ begin
  alter table public.cards
    add constraint cards_status_check
    check (status in ('problem', 'idea', 'progress', 'done'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cards
    add constraint cards_assignees_is_array check (jsonb_typeof(assignees) = 'array');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cards
    add constraint cards_notes_is_array check (jsonb_typeof(notes) = 'array');
exception when duplicate_object then null; end $$;

-- A runaway client should not be able to write a 10MB card.
do $$ begin
  alter table public.cards
    add constraint cards_size_check check (
      length(title) <= 300 and length(body) <= 5000 and length(tag) <= 40
      and pg_column_size(notes) <= 262144
      and pg_column_size(assignees) <= 8192
    );
exception when duplicate_object then null; end $$;

-- position is `double precision`, so NaN and Infinity are representable and
-- would corrupt ordering for everyone.
do $$ begin
  alter table public.cards
    add constraint cards_position_finite check (position = position and abs(position) < 1e300);
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Index: every read is "one board, ordered within a column".
-- -----------------------------------------------------------------------------
create index if not exists cards_board_status_position_idx
  on public.cards (board, status, position);

-- -----------------------------------------------------------------------------
-- updated_at is maintained server-side. Client clocks disagree, and on a board
-- where "who edited last" decides conflicts, that matters.
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  -- created_at is immutable; ignore any client attempt to change it.
  new.created_at = old.created_at;
  return new;
end;
$$;

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security
--
-- This policy grants every anonymous visitor full read and write access to
-- every card. That is the documented v1 trade-off -- see SECURITY.md. It is
-- appropriate only for a board whose URL is not published and whose contents
-- would not hurt if a stranger wiped them.
--
-- To lock it down later, swap `to anon` for `to authenticated` and turn on
-- Supabase Auth. The table does not change.
-- -----------------------------------------------------------------------------
alter table public.cards enable row level security;

drop policy if exists "board access" on public.cards;
create policy "board access"
  on public.cards
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.cards;
exception when duplicate_object then null; end $$;

-- Realtime delivers the old row on delete only when the replica identity is
-- full; without this, a delete event carries just the primary key.
alter table public.cards replica identity full;

-- =============================================================================
-- People
--
-- Anyone who sets a name on this board is stored here, so the assignee picker
-- can offer real names even before that person has been put on a card.
-- Unique on (board, lower(name)): "Sam" and "sam" are one person.
-- =============================================================================

create table if not exists public.people (
  id         uuid primary key default gen_random_uuid(),
  board      text        not null default 'main',
  name       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.people
    add constraint people_name_len check (length(name) > 0 and length(name) <= 60);
exception when duplicate_object then null; end $$;

create unique index if not exists people_board_name_idx
  on public.people (board, lower(name));

drop trigger if exists people_touch_updated_at on public.people;
create trigger people_touch_updated_at
  before update on public.people
  for each row execute function public.touch_updated_at();

alter table public.people enable row level security;

drop policy if exists "board access" on public.people;
create policy "board access"
  on public.people
  for all
  to anon, authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table public.people;
exception when duplicate_object then null; end $$;

alter table public.people replica identity full;

-- =============================================================================
-- Pad (shared notepad / whiteboard)
--
-- One row per sticky, text box, stroke or image. Two people dragging at once
-- only collide if they edit the same object.
-- =============================================================================

create table if not exists public.canvas_objects (
  id         uuid primary key default gen_random_uuid(),
  board      text             not null default 'main',
  kind       text             not null default 'sticky',
  x          double precision not null default 0,
  y          double precision not null default 0,
  w          double precision not null default 0,
  h          double precision not null default 0,
  z          integer          not null default 0,
  data       jsonb            not null default '{}'::jsonb,
  created_at timestamptz      not null default now(),
  updated_at timestamptz      not null default now()
);

do $$ begin
  alter table public.canvas_objects
    add constraint canvas_kind_check
    check (kind in ('sticky', 'text', 'stroke', 'image'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.canvas_objects
    add constraint canvas_finite check (
      x = x and y = y and w = w and h = h
      and abs(x) < 1e8 and abs(y) < 1e8
      and w >= 0 and h >= 0 and w < 1e5 and h < 1e5
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.canvas_objects
    add constraint canvas_data_is_object check (jsonb_typeof(data) = 'object');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.canvas_objects
    add constraint canvas_size_check check (pg_column_size(data) <= 786432);
exception when duplicate_object then null; end $$;

create index if not exists canvas_objects_board_z_idx
  on public.canvas_objects (board, z);

drop trigger if exists canvas_objects_touch_updated_at on public.canvas_objects;
create trigger canvas_objects_touch_updated_at
  before update on public.canvas_objects
  for each row execute function public.touch_updated_at();

alter table public.canvas_objects enable row level security;

drop policy if exists "board access" on public.canvas_objects;
create policy "board access"
  on public.canvas_objects
  for all
  to anon, authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table public.canvas_objects;
exception when duplicate_object then null; end $$;

alter table public.canvas_objects replica identity full;

-- =============================================================================
-- Sheets (lined notepad pages)
-- =============================================================================

create table if not exists public.sheets (
  id         uuid primary key default gen_random_uuid(),
  board      text             not null default 'main',
  title      text             not null default '',
  body       text             not null default '',
  position   double precision not null default 1000,
  created_at timestamptz      not null default now(),
  updated_at timestamptz      not null default now()
);

do $$ begin
  alter table public.sheets
    add constraint sheets_size_check check (
      length(title) <= 200 and length(body) <= 100000
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sheets
    add constraint sheets_position_finite check (position = position and abs(position) < 1e300);
exception when duplicate_object then null; end $$;

create index if not exists sheets_board_position_idx
  on public.sheets (board, position);

drop trigger if exists sheets_touch_updated_at on public.sheets;
create trigger sheets_touch_updated_at
  before update on public.sheets
  for each row execute function public.touch_updated_at();

alter table public.sheets enable row level security;

drop policy if exists "board access" on public.sheets;
create policy "board access"
  on public.sheets
  for all
  to anon, authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table public.sheets;
exception when duplicate_object then null; end $$;

alter table public.sheets replica identity full;
