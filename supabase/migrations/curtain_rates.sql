-- Rate card for the curtain cost calculator (src/lib/curtainCalc.js) — the
-- fullness, making, track and fitting rates ported from the Excel workbook.
--
-- Deliberately NOT stored in business_settings: that row is readable by `anon`
-- so the public customer quote page can render, and these are supplier cost
-- rates that must not be public.
--
-- Applied to production 2026-08-27 as migration `create_curtain_rates`.
-- created_at / deleted_at are required by the app's hydration layer
-- (src/store/db.js queries every manifest table with `deleted_at=is.null` and
-- `order=created_at.asc`); without them PostgREST returns 400 and the rate card
-- silently never syncs.
create table if not exists public.curtain_rates (
  id         text primary key,
  rates      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.curtain_rates
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table public.curtain_rates enable row level security;

drop policy if exists curtain_rates_select_all on public.curtain_rates;
create policy curtain_rates_select_all on public.curtain_rates
  for select using ((select is_active_user()));

drop policy if exists curtain_rates_write_am on public.curtain_rates;
create policy curtain_rates_write_am on public.curtain_rates
  for all using ((select is_account_manager()))
  with check ((select is_account_manager()));

-- Single shared rate card. Left empty so the app's defaults apply until
-- someone edits them in Settings.
insert into public.curtain_rates (id, rates)
values ('default', '{}'::jsonb)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
