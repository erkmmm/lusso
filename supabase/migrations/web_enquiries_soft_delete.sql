-- Deleting a web lead from the Inbox was a hard DELETE with no undo: one
-- mis-click and a lead was gone, with nothing left to recover it from.
-- Customers already soft-delete (customers.deleted_at + restoreCustomer), so
-- this brings leads in line with the rest of the app.
alter table public.web_enquiries
  add column if not exists deleted_at timestamptz;

-- The inbox reads leads newest-first and skips deleted ones.
create index if not exists web_enquiries_active_idx
  on public.web_enquiries (created_at desc)
  where deleted_at is null;

comment on column public.web_enquiries.deleted_at is
  'Soft delete. Set when a lead is removed from the Inbox; cleared by Undo. Rows are kept so a mis-click is recoverable.';
