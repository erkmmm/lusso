-- Delivery receipts for outbound messages.
--
-- Every outbound row was written with status 'sent' the moment Twilio or
-- Resend *accepted* the request. Acceptance is not delivery: a hard bounce, a
-- disconnected mobile or a spam rejection all looked exactly like a message
-- the customer had read. A quote that bounced sat in "Out — awaiting
-- customer" until it expired.
--
-- Twilio now posts to a StatusCallback and Resend to a delivery webhook, both
-- landing on comms-inbound, which matches on external_id and updates the row.

-- Room for the states the providers actually report. 'failed' is kept for the
-- rows already using it.
alter table public.communications
  drop constraint if exists communications_status_check;

alter table public.communications
  add constraint communications_status_check
  check (status = any (array[
    'queued'::text,      -- accepted by the provider, not yet handed on
    'sent'::text,        -- handed to the carrier / mail server
    'delivered'::text,   -- confirmed delivered to the recipient
    'delayed'::text,     -- deferred, still being retried
    'bounced'::text,     -- rejected outright — the address is bad
    'complained'::text,  -- delivered, then marked as spam by the recipient
    'failed'::text,      -- provider gave up
    'received'::text     -- inbound
  ]));

-- Why it ended up in that state ("550 5.1.1 user unknown", Twilio error 30003)
-- and when we were told, so staff get something they can act on rather than a
-- bare red badge.
alter table public.communications
  add column if not exists status_detail text,
  add column if not exists status_at timestamptz;

-- The webhooks look rows up by provider id and nothing else, on every event.
create index if not exists communications_external_id_idx
  on public.communications (external_id)
  where external_id is not null;

comment on column public.communications.status is
  'Delivery state. Set to sent/queued at send time, then advanced by the provider webhooks in comms-inbound.';
comment on column public.communications.status_detail is
  'Provider reason for the current status — a bounce message or carrier error. Null when nothing went wrong.';
comment on column public.communications.status_at is
  'When the provider last reported this status.';
