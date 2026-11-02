-- The quote email and SMS presets were localStorage-only, so the "default
-- messages used across quotes, emails and SMS" were nothing of the sort: each
-- staff member had their own private copy, edits made in the office never
-- reached the iPad, and the PO presets sitting in the very next card on the
-- same Settings page did sync — so the two looked identical while reaching
-- completely different distances.
--
-- Stored as ONE ROW PER PRESET, not a single jsonb blob, for the same reason
-- buz_value_maps is: the sync layer moves arrays of records keyed by id, and a
-- nested blob makes two people editing different presets overwrite each other
-- wholesale. The id IS the preset key ('quoteEmailIntro', 'smsQuoteReady', …),
-- which keeps the upsert idempotent and lets one preset be edited without
-- touching any other.
--
-- Mirrors buz_fabric_codes / measure_sheet_options: small config rows, hard
-- deleted, readable and writable by any active user — anyone who can send a
-- quote can fix the wording of the message that carries it. The UPDATE policy
-- is NOT optional: leaving it out is what made re-scoping a measure-sheet
-- option fail silently, correct locally and absent on the server.
--
-- created_at / deleted_at are required by the app's hydration layer
-- (src/store/db.js queries every manifest table with `deleted_at=is.null` and
-- `order=created_at.asc`); without them PostgREST returns 400 and the presets
-- silently never sync.

create table if not exists public.message_presets (
  id          text primary key,       -- the preset key, e.g. 'smsQuoteReady'
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- An empty body is a real answer, not a missing one. The app treats a stored ''
-- as "this preset is deliberately off" and falls back to its built-in default
-- only when there is no row at all, so '' must be storable rather than
-- constrained away.

alter table public.message_presets enable row level security;

drop policy if exists message_presets_select on public.message_presets;
create policy message_presets_select on public.message_presets
  for select using ((select public.is_active_user()));

drop policy if exists message_presets_insert on public.message_presets;
create policy message_presets_insert on public.message_presets
  for insert with check ((select public.is_active_user()));

drop policy if exists message_presets_update on public.message_presets;
create policy message_presets_update on public.message_presets
  for update using      ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists message_presets_delete on public.message_presets;
create policy message_presets_delete on public.message_presets
  for delete using ((select public.is_active_user()));

-- Deliberately seeded with nothing. An absent row means "use the built-in
-- default from DEFAULT_MESSAGE_PRESETS", so seeding the defaults here would
-- freeze today's wording into the database and stop any future correction to a
-- shipped default from ever reaching anyone.

notify pgrst, 'reload schema';
