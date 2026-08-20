-- Threading inbound SMS to the right customer ─────────────────────────────────
-- comms-inbound matched the sender against customers.phone with a hand-written
-- list of format variants ('0428 501 838', '+61428501838', …). Roughly one in
-- eight customer records is stored in a shape that list doesn't cover — stray
-- parentheses, odd spacing, a spaced +61 — and customers.mobile was never
-- consulted at all, so those replies arrived with no customer attached and
-- never reached the customer's Comms tab.
--
-- Both sides are now reduced to the same key instead: the last 9 digits, which
-- is what an Australian number carries once the 0 or +61 is stripped.

create or replace function public.phone_key(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$$;

-- Expression indexes so the lookup stays a single index probe as the customer
-- list grows.
create index if not exists customers_phone_key_idx  on public.customers (public.phone_key(phone));
create index if not exists customers_mobile_key_idx on public.customers (public.phone_key(mobile));
create index if not exists communications_phone_key_idx
  on public.communications (public.phone_key(coalesce(to_address, from_address)));

-- Who sent this? Two passes:
--   1. any customer whose phone or mobile reduces to the same key;
--   2. failing that, whoever we last exchanged SMS with on that number — a
--      customer can reply from a second handset that isn't on their record, and
--      the conversation history knows who they are even when the field doesn't.
create or replace function public.match_customer_by_phone(p_phone text)
returns uuid language plpgsql stable as $$
declare
  k text := public.phone_key(p_phone);
  hit uuid;
begin
  -- A short or empty key would match far too much; refuse rather than guess.
  if k is null or length(k) < 9 then
    return null;
  end if;

  -- 24 numbers in the book belong to more than one customer record, so which
  -- of them matters: prefer whoever we've most recently exchanged SMS with,
  -- and only fall back to the most recently touched record.
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

-- Called by comms-inbound with the service role only.
revoke all on function public.match_customer_by_phone(text) from anon, authenticated;
