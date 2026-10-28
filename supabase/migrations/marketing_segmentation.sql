-- Email marketing, part 1 of 2: segmentation, suppression and unsubscribe.
--
-- The list is ~1,670 emailable contacts spanning 2015–2026. The last campaign
-- went to all of them in one week and came back as a wave of "can you fix my
-- blinds" — good demand, arriving faster than the install diary could absorb.
-- Everything here exists to make that demand deliberate rather than accidental:
-- segment on how old the customer's blinds actually are, so the repair-heavy
-- cohorts can be mailed in waves sized to capacity, and never mail anyone who
-- has opted out.
--
-- Part 2 (marketing_campaigns.sql) adds the campaign and send-log tables.


-- ───────────────────────────────────────────────────────────────────────────
-- Merge-field helpers
--
-- These feed personalisation, so every one of them returns NULL rather than a
-- guess. A blank that the template can fall back on ("Hi there") is invisible;
-- a wrong first name or a suburb that is really a street address is the most
-- visible possible error in a marketing email.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.marketing_first_name(p_name text)
returns text language sql immutable as $fn$
  with raw as (select btrim(coalesce(p_name, '')) n),
  -- Joint accounts and businesses have no single first name. Bail rather than
  -- greet "John & Mary Smith" as "Hi John".
  guard as (
    select case
      when n = '' then null
      when n ~* '(&| and |/|,|\mpty\M|\mltd\M|\mgroup\M|\mhomes\M|\mconstructions?\M|\mbuilders?\M|\mdesigns?\M|\mprojects?\M)' then null
      else n
    end n
    from raw
  ),
  tok as (
    select n,
           regexp_replace(btrim(split_part(n, ' ', 1)), '^(mr|mrs|ms|miss|dr)\.?$', '', 'i') t
    from guard
  )
  select case
    when n is null then null
    -- Leading title: take the next token instead ("Mr John" → "John").
    when t = '' then nullif(btrim(split_part(n, ' ', 2)), '')
    when length(t) < 2 then null
    -- Only re-case when the source is shouting or whispering; leave names that
    -- already carry deliberate capitals (McLeod, O'Brien) alone.
    when t = upper(t) or t = lower(t) then initcap(t)
    else t
  end
  from tok;
$fn$;

comment on function public.marketing_first_name is
  'First name for an email greeting, or NULL when it cannot be determined confidently (joint accounts, businesses, initials).';


create or replace function public.marketing_suburb(p_address text)
returns text language sql immutable as $fn$
  with cleaned as (
    select btrim(regexp_replace(coalesce(p_address, ''), ',\s*australia\s*$', '', 'i')) a
  ),
  parts as (
    select btrim(p) p, ord
    from cleaned, unnest(string_to_array(a, ',')) with ordinality u(p, ord)
    where btrim(p) <> ''
  ),
  -- The suburb is the comma-part carrying the state abbreviation
  -- ("Main Beach QLD 4215"); failing that, the last part, which is how the
  -- shorter imported addresses are written ("532 Trees Road, Tallebudgera").
  pick as (
    select coalesce(
      (select p from parts where p ~* '\m(QLD|NSW|VIC|SA|WA|NT|TAS|ACT)\M' order by ord limit 1),
      (select p from parts order by ord desc limit 1)
    ) p
  ),
  stripped as (
    select btrim(regexp_replace(p, '\s*\m(QLD|NSW|VIC|SA|WA|NT|TAS|ACT)\M\s*\d{0,4}\s*$', '', 'i')) s
    from pick
  )
  select case
    when s is null or s = '' then null
    when s ~ '\d' then null                                   -- still a street or box number
    when s ~* '^(p\.?\s*o\.?|po box|unit|level|lot|shop|suite|apt)\M' then null
    when length(s) < 3 then null
    -- Mail centres and the region itself are not a suburb worth naming back.
    when s ~* '^(australia|gold coast|gold coast mc|qld|queensland)$' then null
    when s = upper(s) or s = lower(s) then initcap(s)
    else s
  end
  from stripped;
$fn$;

comment on function public.marketing_suburb is
  'Best-effort suburb from a free-text address, or NULL when the address is too messy to be sure. Used for "your place in X" personalisation.';


-- Product family for a quote line. A SQL port of categorizeProduct() in
-- src/lib/productCategories.js, including its matching ORDER — services first,
-- then an anchored code prefix (with a leading MOT/MT stripped, because
-- "MOT RB40 Block" is a roller blind that happens to be motorised), then parts,
-- then looser code and title matches. Keep the two in step.
create or replace function public.marketing_product_family(p_code text, p_name text)
returns text language sql immutable as $fn$
  with h as (
    select lower(btrim(coalesce(p_code, ''))) c,
           lower(coalesce(p_name, '')) n
  ),
  d as (
    select c, n, c || ' ' || n all_hay,
           btrim(regexp_replace(c, '^(mot|mt)\M\s*', '')) base
    from h
  )
  select case
    when all_hay ~* '\m(serv|labou?r|removal|repair|call ?out|freight|delivery)\M' then 'Service & Install'

    -- Anchored code prefix: the strongest signal available.
    when base ~* '^curt\M'     then 'Curtains & Sheers'
    when base ~* '^roman\M'    then 'Roman Blinds'
    when base ~* '^ven\M'      then 'Venetians'
    when base ~* '^vert\M'     then 'Verticals'
    when base ~* '^shut\M'     then 'Shutters'
    when base ~* '^ext\M'      then 'External & Awnings'
    when base ~* '^rb[0-9]*\M' then 'Roller Blinds'

    -- Parts named in the code beat any product the code name-drops
    -- ("Acmeda USB Wall Charger (Curtains)").
    when c ~* '\m(clips?|tensioner|rem|remotes?|hub|charger|wand|battery|dock|spline|parts?)\M' then 'Parts & Accessories'

    when c ~* '\m(curt|curtains?|sheers?|ripple|wave ?fold|s-?fold|knife pleat|pencil pleat|drapes?)\M' then 'Curtains & Sheers'
    when c ~* 'roman'                                      then 'Roman Blinds'
    when c ~* '\m(ven|venetians?)\M'                       then 'Venetians'
    when c ~* '\m(vert|verticals?)\M'                      then 'Verticals'
    when c ~* '\m(shut|shutters?|therm)\M'                 then 'Shutters'
    when c ~* '\m(ext|awnings?)\M' or c ~* 'folding arm|straight drop|widescreen|zip ?screen' then 'External & Awnings'
    when c ~* '\m(rb[0-9]*|rollers?|dual blind)\M' or c ~* 'block ?out|sunscreen|privacy' then 'Roller Blinds'
    when c ~* 'pleated|cellular|honeycomb'                 then 'Pleated & Cellular'

    when n ~* '\m(clips?|tensioner|remotes?|charger|wand|battery)\M' then 'Parts & Accessories'
    when n ~* 'curtain|sheer|ripple|wave ?fold|s-?fold|drape'        then 'Curtains & Sheers'
    when n ~* 'roman'                                               then 'Roman Blinds'
    when n ~* 'venetian'                                            then 'Venetians'
    when n ~* 'vertical'                                            then 'Verticals'
    when n ~* 'shutter'                                             then 'Shutters'
    when n ~* 'awning|folding arm|straight drop|widescreen|zip ?screen' then 'External & Awnings'
    when n ~* 'pleated|cellular|honeycomb'                          then 'Pleated & Cellular'
    when n ~* 'roller|block ?out|sunscreen|screen'                  then 'Roller Blinds'

    -- A motor with no identifiable product under it.
    when all_hay ~* '\m(mot|mt|motoris\w*|motors?|somfy|automate|glydea)\M' then 'Motors & Controls'
    else null
  end
  from d;
$fn$;

comment on function public.marketing_product_family is
  'Product family for a quote line item. SQL port of categorizeProduct() in src/lib/productCategories.js — keep the two in step.';


-- Product families are UI labels ("External & Awnings", "Curtains & Sheers").
-- Dropped into a sentence they read as a database field rather than as
-- something a person wrote — "We fitted your External & Awnings in 2018". This
-- gives each family the noun a human would actually use.
create or replace function public.marketing_product_phrase(p_family text)
returns text language sql immutable as $fn$
  select case p_family
    when 'Roller Blinds'       then 'roller blinds'
    when 'Roman Blinds'        then 'roman blinds'
    when 'Venetians'           then 'venetian blinds'
    when 'Verticals'           then 'vertical blinds'
    when 'Shutters'            then 'shutters'
    when 'Curtains & Sheers'   then 'curtains'
    when 'Pleated & Cellular'  then 'pleated blinds'
    when 'External & Awnings'  then 'outdoor blinds and awnings'
    -- A motor with no identifiable product under it tells us nothing worth
    -- saying back, so fall through and let the template use its fallback.
    when 'Motors & Controls'   then null
    else null
  end;
$fn$;

comment on function public.marketing_product_phrase is
  'Product family as a noun that reads naturally mid-sentence. NULL where the family is too vague to name, so the template falls back.';


-- ───────────────────────────────────────────────────────────────────────────
-- Suppression list
--
-- The one table that must be consulted before every single send. Unsubscribes
-- are a legal obligation under the Spam Act 2003 (Cth); hard bounces and
-- complaints belong here for the same practical reason — a 2015 address that
-- no longer exists costs sender reputation every time it is retried, and that
-- reputation is shared with the domain that delivers quotes.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.marketing_suppressions (
  email       text primary key,
  customer_id text references public.customers(id) on delete set null,
  reason      text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'manual')),
  source      text,
  created_at  timestamptz not null default now()
);

comment on table public.marketing_suppressions is
  'Do-not-mail list for marketing email. Checked by customer_marketing_profile.emailable. Never send to an address in here.';

alter table public.marketing_suppressions enable row level security;

drop policy if exists marketing_suppressions_select on public.marketing_suppressions;
create policy marketing_suppressions_select on public.marketing_suppressions
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists marketing_suppressions_insert on public.marketing_suppressions;
create policy marketing_suppressions_insert on public.marketing_suppressions
  for insert to authenticated with check ((select public.is_active_user()));

drop policy if exists marketing_suppressions_delete on public.marketing_suppressions;
create policy marketing_suppressions_delete on public.marketing_suppressions
  for delete to authenticated using ((select public.is_account_manager()));


-- Stable per-address unsubscribe tokens.
--
-- Keyed on the address, not the send, so the link in a two-year-old email
-- still works. Opaque and unguessable, because the endpoint it drives is
-- necessarily unauthenticated.
create table if not exists public.marketing_unsub_tokens (
  token      text primary key,
  email      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.marketing_unsub_tokens enable row level security;

drop policy if exists marketing_unsub_tokens_select on public.marketing_unsub_tokens;
create policy marketing_unsub_tokens_select on public.marketing_unsub_tokens
  for select to authenticated using ((select public.is_active_user()));

comment on table public.marketing_unsub_tokens is
  'Maps the ?t= in an unsubscribe link back to an address. One stable token per address so old emails keep working. Service role writes; anon reads only through marketing_unsubscribe().';


-- Mint-or-fetch, called by the sender with the service key.
create or replace function public.marketing_ensure_unsub_token(p_email text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_email text := lower(btrim(p_email));
  v_token text;
begin
  if v_email is null or v_email = '' then return null; end if;

  select token into v_token from marketing_unsub_tokens where email = v_email;
  if v_token is not null then return v_token; end if;

  -- gen_random_uuid() is core since PG13, so this needs no extension on the
  -- function's search_path. 32 hex chars, 122 bits of entropy.
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into marketing_unsub_tokens (token, email) values (v_token, v_email)
    on conflict (email) do nothing;

  -- A concurrent send beat us to it; use theirs.
  select token into v_token from marketing_unsub_tokens where email = v_email;
  return v_token;
end;
$fn$;

revoke all on function public.marketing_ensure_unsub_token(text) from public, anon, authenticated;


-- The unsubscribe endpoint's only database verb. SECURITY DEFINER and granted
-- to anon: the person clicking has no account, and requiring one would make
-- the opt-out unreachable, which is precisely what the Spam Act forbids.
-- Deliberately idempotent, so a second click is not an error.
create or replace function public.marketing_unsubscribe(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_email text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid token');
  end if;

  select email into v_email from marketing_unsub_tokens where token = p_token;
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid token');
  end if;

  insert into marketing_suppressions (email, customer_id, reason, source)
  values (
    v_email,
    (select id from customers
      where lower(btrim(email)) = v_email and deleted_at is null
      order by updated_at desc nulls last limit 1),
    'unsubscribed',
    'link'
  )
  on conflict (email) do nothing;

  -- Stop any wave still queued for this address from going out.
  update marketing_sends set status = 'unsubscribed'
   where lower(email) = v_email and status = 'queued';

  return jsonb_build_object('ok', true, 'email', v_email);
exception
  -- marketing_sends does not exist until part 2 is applied; unsubscribing is
  -- more important than the queue sweep, so never fail the opt-out over it.
  when undefined_table then
    return jsonb_build_object('ok', true, 'email', v_email);
end;
$fn$;

revoke all on function public.marketing_unsubscribe(text) from public;
grant execute on function public.marketing_unsubscribe(text) to anon, authenticated;

comment on function public.marketing_unsubscribe is
  'Opt an address out of marketing email. Called unauthenticated from the link in every campaign email. Idempotent.';


-- ───────────────────────────────────────────────────────────────────────────
-- The segmentation view
--
-- One row per live customer, carrying everything a campaign needs to pick an
-- audience and personalise it. security_invoker so the caller's own RLS on
-- customers and quotes applies — this is customer PII and must not become
-- readable through a view that the base tables would have refused.
--
-- Segments, by how long since the customer last accepted a quote:
--   A  0–2 yrs   recent — do not sell them blinds; ask for the review
--   B  2–5 yrs   rooms they skipped, motorisation retrofit
--   C  5–8 yrs   the service window; repairs are the POINT here
--   D  8 yrs +   replacement cycle
--   E  quoted, never bought
--   F  no quote on record (imported contact)
-- ───────────────────────────────────────────────────────────────────────────

drop view if exists public.customer_marketing_profile cascade;
create view public.customer_marketing_profile
with (security_invoker = true) as
with accepted as (
  select q.customer_id, q.accepted_at, q.grand_total, q.line_items
  from public.quotes q
  where q.deleted_at is null and q.accepted_at is not null
),
money as (
  select customer_id,
         min(accepted_at)  first_purchase_at,
         max(accepted_at)  last_purchase_at,
         count(*)::int     purchase_count,
         sum(grand_total)  lifetime_value
  from accepted
  group by 1
),
lines as (
  select a.customer_id,
         public.marketing_product_family(li ->> 'description', li ->> 'productNameSnapshot') family,
         coalesce(nullif(li ->> 'quantity', '')::numeric, 1) qty,
         coalesce(li ->> 'description', '') || ' ' || coalesce(li ->> 'productNameSnapshot', '') hay
  from accepted a
  cross join lateral jsonb_array_elements(a.line_items) li
  where jsonb_typeof(a.line_items) = 'array'
),
prod as (
  select customer_id,
         array_agg(distinct family) filter (
           where family is not null and family not in ('Service & Install', 'Parts & Accessories')
         ) families,
         coalesce(sum(qty) filter (
           where family in ('Roller Blinds', 'Roman Blinds', 'Venetians', 'Verticals', 'Pleated & Cellular')
         ), 0)::int blind_count,
         coalesce(sum(qty) filter (where family = 'Curtains & Sheers'), 0)::int curtain_count,
         -- Motorised and battery-powered blinds have their own service clock:
         -- rechargeable motors fade at roughly 5–8 years, which is the single
         -- most answerable reason to get back in touch.
         coalesce(bool_or(hay ~* '\m(mot|mt|motoris\w*|motors?|somfy|automate|glydea)\M'), false) has_motorised,
         coalesce(bool_or(hay ~* '\mbattery\M'), false) has_battery
  from lines
  group by 1
),
primary_prod as (
  select distinct on (customer_id) customer_id, family primary_product
  from (
    select customer_id, family, sum(qty) q
    from lines
    where family is not null and family not in ('Service & Install', 'Parts & Accessories')
    group by 1, 2
  ) x
  order by customer_id, q desc, family
),
quoted as (
  select customer_id,
         count(*)::int quote_count,
         max(coalesce(sent_at, created_at)) last_quoted_at
  from public.quotes
  where deleted_at is null
  group by 1
)
select
  c.id                                       as customer_id,
  c.name,
  public.marketing_first_name(c.name)        as first_name,
  lower(btrim(c.email))                      as email,
  nullif(btrim(c.business_name), '')         as business_name,
  public.marketing_suburb(coalesce(nullif(btrim(c.address), ''), c.billing_address)) as suburb,
  -- business_name alone missed the builders in the book under a personal name
  -- with a company email — the sample that caught it had eleven quotes and
  -- $199k against "Cameron". Five or more separate accepted quotes is the
  -- tell: homeowners do not buy five times.
  (nullif(btrim(c.business_name), '') is not null
   or coalesce(m.purchase_count, 0) >= 5)    as is_trade,

  m.first_purchase_at,
  m.last_purchase_at,
  coalesce(m.purchase_count, 0)              as purchase_count,
  coalesce(m.lifetime_value, 0)              as lifetime_value,
  extract(year from m.last_purchase_at)::int as last_purchase_year,
  to_char(m.last_purchase_at, 'FMMonth YYYY') as last_purchase_label,
  -- Whole years elapsed. Floor, not round: never tell someone their blinds are
  -- older than they are.
  case when m.last_purchase_at is null then null
       else floor(extract(epoch from (now() - m.last_purchase_at)) / 31557600)::int
  end                                        as years_since_purchase,

  coalesce(q.quote_count, 0)                 as quote_count,
  q.last_quoted_at,

  coalesce(p.families, '{}')                 as product_families,
  coalesce(p.blind_count, 0)                 as blind_count,
  coalesce(p.curtain_count, 0)               as curtain_count,
  coalesce(p.has_motorised, false)           as has_motorised,
  coalesce(p.has_battery, false)             as has_battery,
  pp.primary_product,
  public.marketing_product_phrase(pp.primary_product) as product_phrase,

  case
    when m.last_purchase_at is null and coalesce(q.quote_count, 0) > 0 then 'E'
    when m.last_purchase_at is null                                    then 'F'
    when m.last_purchase_at > now() - interval '2 years'               then 'A'
    when m.last_purchase_at > now() - interval '5 years'               then 'B'
    when m.last_purchase_at > now() - interval '8 years'               then 'C'
    else                                                                    'D'
  end                                        as segment,

  -- The only gate the sender needs: a plausible address that has not opted out.
  (c.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' and s.email is null) as emailable,
  s.reason                                   as suppressed_reason

from public.customers c
left join money        m  on m.customer_id  = c.id
left join prod         p  on p.customer_id  = c.id
left join primary_prod pp on pp.customer_id = c.id
left join quoted       q  on q.customer_id  = c.id
left join public.marketing_suppressions s on s.email = lower(btrim(c.email))
where c.deleted_at is null;

comment on view public.customer_marketing_profile is
  'One row per live customer with the recency, value and product facts a campaign needs. Segments A–F by years since last accepted quote. Always filter on emailable.';

grant select on public.customer_marketing_profile to authenticated;


-- Pin search_path on the invoker-side helpers. All are SECURITY INVOKER so the
-- exposure is small, but a mutable search_path on a function that resolves
-- unqualified names is a schema-shadowing foothold. The two SECURITY DEFINER
-- functions above already set theirs inline.
alter function public.marketing_first_name(text)           set search_path = public;
alter function public.marketing_suburb(text)               set search_path = public;
alter function public.marketing_product_family(text, text) set search_path = public;
alter function public.marketing_product_phrase(text)       set search_path = public;
