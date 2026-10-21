-- The two BUZ mapping tables were localStorage-only, so the inventory codes
-- someone entered in the office simply did not exist on the iPad — and an
-- export from the wrong device produced a file with every INVENTORY CODE blank,
-- which BUZ rejects with a deserialization error that names no fabric. Shared
-- reference data belongs on the server.
--
-- Mirrors measure_sheet_options: small config rows, hard-deleted, readable and
-- writable by any active user. The UPDATE policy is NOT optional — leaving it
-- out is what made re-scoping a measure-sheet option fail silently, correct
-- locally and absent on the server.

create table if not exists public.buz_fabric_codes (
  id          text primary key,
  range       text not null,
  code        text not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  deleted_at  timestamptz
);

create table if not exists public.buz_value_maps (
  id          text primary key,
  field       text not null,          -- controltype | rolldir | bottomtrim
  from_value  text not null,          -- lower-cased Lusso option
  to_value    text not null,          -- exact BUZ wording
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  deleted_at  timestamptz
);

-- One override per Lusso value per field, so a re-save replaces rather than
-- stacking up duplicates that silently shadow each other.
create unique index if not exists buz_value_maps_field_from_idx
  on public.buz_value_maps (field, from_value);

alter table public.buz_fabric_codes enable row level security;
alter table public.buz_value_maps   enable row level security;

create policy bfc_select on public.buz_fabric_codes for select using      ((select public.is_active_user()));
create policy bfc_insert on public.buz_fabric_codes for insert with check ((select public.is_active_user()));
create policy bfc_update on public.buz_fabric_codes for update using      ((select public.is_active_user())) with check ((select public.is_active_user()));
create policy bfc_delete on public.buz_fabric_codes for delete using      ((select public.is_active_user()));

create policy bvm_select on public.buz_value_maps for select using      ((select public.is_active_user()));
create policy bvm_insert on public.buz_value_maps for insert with check ((select public.is_active_user()));
create policy bvm_update on public.buz_value_maps for update using      ((select public.is_active_user())) with check ((select public.is_active_user()));
create policy bvm_delete on public.buz_value_maps for delete using      ((select public.is_active_user()));

notify pgrst, 'reload schema';
