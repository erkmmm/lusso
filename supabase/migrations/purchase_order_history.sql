-- Purchase order history.
--
-- Every PO that leaves the building (sent, printed, downloaded or exported) is
-- recorded here as a FROZEN snapshot of what was actually on the page, so the
-- workroom's copy and ours can never drift apart: the measure sheet may be
-- edited afterwards, but the PDF a supplier is holding is whatever this row
-- says it was. The snapshot carries the rendered headers/rows plus the inputs
-- (selected lines, motor sides, accessories, notes) so a past order can be
-- reopened, edited and re-issued as a new revision.

create table if not exists public.purchase_orders (
  id                text primary key,
  po_number         text,
  job_id            text,
  measure_sheet_id  text,
  customer_id       text,
  customer_name     text,
  job_number        text,
  status            text,                     -- sent | printed | downloaded | exported
  recipient         text,
  subject           text,
  message           text,
  date_ordered      text,                     -- as printed (dd/MM/yyyy)
  date_required     text,                     -- 'YYYY-MM-DD' | 'ASAP' | ''
  extra_notes       text,
  item_count        integer,
  revision          integer default 1,
  snapshot          jsonb   not null default '{}'::jsonb,
  sent_at           timestamptz,
  created_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  deleted_at        timestamptz
);

create index if not exists purchase_orders_measure_sheet_idx on public.purchase_orders (measure_sheet_id);
create index if not exists purchase_orders_job_idx           on public.purchase_orders (job_id);
create index if not exists purchase_orders_created_idx       on public.purchase_orders (created_at desc);

alter table public.purchase_orders enable row level security;

-- Same access shape as po_message_presets / suppliers.
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select using ((select is_active_user()));

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert with check (
    (select is_account_manager())
    or ((select is_active_salesperson()) and (select is_active_user()))
  );

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update using (
    (select is_account_manager())
    or ((select is_active_salesperson()) and (select is_active_user()))
  );

drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete on public.purchase_orders
  for delete using ((select is_account_manager()));

notify pgrst, 'reload schema';
