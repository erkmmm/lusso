-- Attaching a message to the customer who sent it ─────────────────────────────
-- match_customer_by_phone already reduces both sides to the last nine digits
-- (see phone_matching.sql), but it was only ever called from comms-inbound, at
-- the moment the row was written. That leaves two holes:
--
--   1. Anything inserted by another path — a future webhook, a manual row, a
--      backfill — skips matching entirely and lands with no customer.
--   2. A text that arrives BEFORE the customer record exists, or before their
--      number is on file, is stamped null and stays null. Creating the customer
--      afterwards doesn't go back for it, so their history opens with a bare
--      phone number in the inbox and never reaches their Comms tab at all.
--
-- Matching moves into the database so it happens however the row arrives, and
-- runs a second time from the customers side so a late record collects what
-- came in before it. Both the inbox and the Comms tab already key off
-- customer_id, so stamping the row is all either needs — no per-view lookup.

-- ── 0. match_customer_by_phone returns the wrong type ────────────────────────
-- It declares `hit uuid`, but customers.id is text and 45 of the 1,945 records
-- carry an id that isn't a uuid. For those, the assignment raises
-- invalid_text_representation: comms-inbound swallowed it (logged, insert went
-- ahead unattached), which is why those customers' texts have never threaded to
-- them. Called from a BEFORE INSERT trigger the same error would abort the
-- insert and lose the message outright, so the type is corrected at the source.
-- Dropped rather than replaced — the return type is part of the signature.
drop function if exists public.match_customer_by_phone(text);

create or replace function public.match_customer_by_phone(p_phone text)
returns text language plpgsql stable as $$
declare
  k text := public.phone_key(p_phone);
  hit text;
begin
  if k is null or length(k) < 9 then
    return null;
  end if;

  select c.id into hit
  from public.customers c
  left join lateral (
    select max(cm.created_at) as last_sms
    from public.communications cm
    where cm.customer_id = c.id and cm.channel = 'sms'
  ) s on true
  where c.deleted_at is null
    and (public.phone_key(c.phone) = k or public.phone_key(c.mobile) = k)
  order by s.last_sms desc nulls last, c.updated_at desc nulls last
  limit 1;

  if hit is not null then
    return hit;
  end if;

  select cm.customer_id into hit
  from public.communications cm
  where cm.customer_id is not null
    and cm.channel = 'sms'
    and (public.phone_key(cm.to_address) = k or public.phone_key(cm.from_address) = k)
  order by cm.created_at desc
  limit 1;

  return hit;
end;
$$;

revoke all on function public.match_customer_by_phone(text) from anon, authenticated;

-- The customer's number on a row: they are the sender when it's inbound, the
-- recipient when it's outbound.
create or replace function public.comm_counterparty(p_direction text, p_from text, p_to text)
returns text language sql immutable as $$
  select case when p_direction = 'inbound' then p_from else p_to end
$$;

-- Their most recent live job, so the message reaches the job's Comms tab too.
-- Same rule comms-inbound already applies, kept in one place now. Ids on these
-- tables are text, not uuid, throughout.
create or replace function public.latest_open_job(p_customer text)
returns text language sql stable as $$
  select j.id from public.jobs j
  where j.customer_id = p_customer
    and j.status not in ('Completed', 'Cancelled')
    and j.deleted_at is null
  order by j.created_at desc
  limit 1
$$;

-- ── 1. Match on the way in ───────────────────────────────────────────────────
create or replace function public.communications_match_customer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  counterparty text;
begin
  -- Whoever wrote the row may already know who it belongs to; never second-
  -- guess an explicit customer_id.
  if new.customer_id is not null then return new; end if;
  if new.channel not in ('sms', 'call') then return new; end if;

  counterparty := public.comm_counterparty(new.direction, new.from_address, new.to_address);
  new.customer_id := public.match_customer_by_phone(counterparty);

  if new.customer_id is not null and new.job_id is null then
    new.job_id := public.latest_open_job(new.customer_id);
  end if;
  return new;
end $$;

drop trigger if exists communications_match on public.communications;
create trigger communications_match
  before insert on public.communications
  for each row execute function public.communications_match_customer();

-- ── 2. Match again when the customer turns up later ──────────────────────────
create or replace function public.customers_claim_orphan_comms()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  keys text[];
begin
  if new.deleted_at is not null then return new; end if;

  -- A short key would match far too much, so only full nine-digit ones count —
  -- and phone_key(null) is '', which must never be treated as a number.
  select array_agg(k) into keys
  from unnest(array[public.phone_key(new.phone), public.phone_key(new.mobile)]) k
  where length(k) = 9;
  if keys is null then return new; end if;

  -- Only ever claims rows that belong to nobody. A message already attached to
  -- another customer is left alone — a shared or recycled number must not drag
  -- someone else's history into this record.
  update public.communications cm
  set customer_id = new.id,
      job_id      = coalesce(cm.job_id, public.latest_open_job(new.id))
  where cm.customer_id is null
    and cm.channel in ('sms', 'call')
    and public.phone_key(
          public.comm_counterparty(cm.direction, cm.from_address, cm.to_address)
        ) = any(keys);

  return new;
end $$;

drop trigger if exists customers_claim_comms on public.customers;
create trigger customers_claim_comms
  after insert or update of phone, mobile, deleted_at on public.customers
  for each row execute function public.customers_claim_orphan_comms();

-- Keeps the claim above a single index probe rather than a scan of every
-- message each time a customer is saved.
create index if not exists communications_counterparty_key_idx
  on public.communications (
    public.phone_key(public.comm_counterparty(direction, from_address, to_address))
  );

-- ── 3. Backfill ──────────────────────────────────────────────────────────────
-- Attach anything already orphaned whose number now resolves. Ran clean on
-- 2026-08-24 (0 claimed, 1 left — an unknown US number that correctly matches
-- nobody), but it belongs here so a rebuilt database ends up in the same state.
with targets as (
  select cm.id,
         public.match_customer_by_phone(
           public.comm_counterparty(cm.direction, cm.from_address, cm.to_address)
         ) as match
  from public.communications cm
  where cm.customer_id is null
    and cm.channel in ('sms', 'call')
)
update public.communications cm
set customer_id = t.match,
    job_id      = coalesce(cm.job_id, public.latest_open_job(t.match))
from targets t
where cm.id = t.id and t.match is not null;

-- PostgREST caches function signatures; match_customer_by_phone changed its
-- return type, so the cache has to be told.
notify pgrst, 'reload schema';
