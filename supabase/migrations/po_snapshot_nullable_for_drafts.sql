-- `snapshot` is the document that was ISSUED to a supplier. A purchase order
-- saved as a draft has never been issued, so it genuinely has none — its work
-- in progress lives in draft_snapshot instead.
--
-- The NOT NULL was correct while an order could only come into existence by
-- going out. Now that one can be saved first and sent later, it rejects every
-- draft: the row fails to insert, the write stays queued in the outbox forever,
-- and the draft lives only in the browser that made it.
alter table public.purchase_orders
  alter column snapshot drop not null;

-- An order that has gone out must still carry its document.
alter table public.purchase_orders
  drop constraint if exists purchase_orders_issued_has_snapshot;
alter table public.purchase_orders
  add constraint purchase_orders_issued_has_snapshot
  check (status = 'draft' or snapshot is not null) not valid;

notify pgrst, 'reload schema';
