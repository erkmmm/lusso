-- Blocker 7: re-issuing a PO bumped `revision` but wrote back to the same row,
-- replacing `snapshot`. The counter said "rev 3" while the only surviving copy
-- was rev 3's contents — revisions 1 and 2 were gone, which is precisely the
-- opposite of auditable.
--
-- Same shape takeoffs already use for plan revisions: an array of prior
-- versions on the row, newest last. The current version stays in `snapshot`, so
-- nothing reading a PO today has to change. Written by savePurchaseOrder().
alter table public.purchase_orders
  add column if not exists revisions jsonb not null default '[]'::jsonb;

comment on column public.purchase_orders.revisions is
  'Prior versions of this PO, oldest first. Each entry: { revision, snapshot, itemCount, recipient, subject, message, dateRequired, extraNotes, supersededAt }. The live version is in the row itself; this is what it replaced.';
