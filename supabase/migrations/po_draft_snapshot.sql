-- A purchase order can now be saved as a draft and picked up later.
--
-- Until now an order was only filed when it went OUT — sent, printed,
-- downloaded or exported — so the only way to keep a half-built PO was to
-- generate a document you didn't want. `snapshot` holds the issued document
-- (what the supplier is actually holding, and what revisions are counted
-- against), so a draft must not overwrite it: an in-progress edit is not a
-- re-issue, and treating it as one would both inflate the revision number and
-- destroy the record of what was really sent.
--
-- draft_snapshot is the work in progress. Reopening prefers it over snapshot;
-- issuing promotes it to snapshot and clears it.
alter table public.purchase_orders
  add column if not exists draft_snapshot jsonb;

comment on column public.purchase_orders.draft_snapshot is
  'Work-in-progress PO document. NULL once the order has been issued from it.';

notify pgrst, 'reload schema';
