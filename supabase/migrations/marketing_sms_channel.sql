-- Marketing: SMS as a second channel alongside email.
--
-- Shape chosen 2026-10-28: ONE CHANNEL PER CAMPAIGN, CHAINABLE. A campaign is
-- either an email campaign or an SMS campaign. An SMS campaign may name an
-- earlier campaign and skip whoever already replied to it, so texting is the
-- follow-up to silence rather than a second poke at the same person.
--
-- Why not both channels in one wave: of 1,197 customers holding a valid AU
-- mobile, only THREE have no email address. Firing both at once would double
-- the spend and the complaint exposure on an eleven-year-old list in order to
-- reach three extra people. The channels overlap almost perfectly, so the
-- useful question is never "email or SMS", it is "who didn't answer the email".

-- ── Mobile normalisation ─────────────────────────────────────────────────────
-- Twilio wants E.164 and the book holds eleven years of free-typed numbers:
-- "0412 345 678", "+61 412 345 678", "0412345678 (mob)". Anything that is not
-- an Australian mobile returns null and is simply not textable — landlines
-- included. A landline handed to Twilio bills us for a message nobody can read.
create or replace function public.marketing_mobile_e164(p_raw text)
returns text language sql immutable set search_path to 'public' as $$
  with d as (select nullif(regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g'), '') as v)
  select case
    when v ~ '^\+614[0-9]{8}$' then v
    when v ~ '^614[0-9]{8}$'   then '+' || v
    when v ~ '^04[0-9]{8}$'    then '+61' || substring(v from 2)
    when v ~ '^4[0-9]{8}$'     then '+61' || v
    else null
  end from d;
$$;

-- ── SMS suppression ──────────────────────────────────────────────────────────
-- Its own table rather than a column on marketing_suppressions, which is keyed
-- on email as its primary key: a customer can legitimately stop the texts and
-- keep the email, or have no email at all. Reason 'stop' is the inbound keyword
-- path, which the Spam Act requires us to honour.
create table if not exists public.marketing_sms_suppressions (
  mobile      text primary key,
  customer_id text references public.customers(id) on delete set null,
  reason      text not null check (reason in ('stop', 'manual', 'invalid', 'complained')),
  source      text,
  created_at  timestamptz not null default now()
);

alter table public.marketing_sms_suppressions enable row level security;

do $$ begin
  create policy marketing_sms_suppressions_select on public.marketing_sms_suppressions
    for select to authenticated using ((select is_active_user()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy marketing_sms_suppressions_insert on public.marketing_sms_suppressions
    for insert to authenticated with check ((select is_active_user()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy marketing_sms_suppressions_delete on public.marketing_sms_suppressions
    for delete to authenticated using ((select is_account_manager()));
exception when duplicate_object then null; end $$;

-- ── Campaigns gain a channel and an SMS body ─────────────────────────────────
alter table public.marketing_campaigns
  add column if not exists channel  text not null default 'email',
  add column if not exists sms_body text;

alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_channel_check;
alter table public.marketing_campaigns add constraint marketing_campaigns_channel_check
  check (channel in ('email', 'sms'));

-- An SMS campaign with no sms_body would text people an empty string.
alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_sms_body_check;
alter table public.marketing_campaigns add constraint marketing_campaigns_sms_body_check
  check (channel <> 'sms' or coalesce(btrim(sms_body), '') <> '');

comment on column public.marketing_campaigns.sms_body is
  'The whole text message. Same {{merge}} syntax as the email body, but no '
  'subject, no HTML and no layout — what is written here is what is sent, plus '
  'the opt-out line the sender appends.';

-- ── Sends record which channel reached which address ─────────────────────────
alter table public.marketing_sends
  add column if not exists channel text not null default 'email',
  add column if not exists mobile  text;

-- Email is no longer the only kind of address a send can have.
alter table public.marketing_sends alter column email drop not null;

alter table public.marketing_sends drop constraint if exists marketing_sends_channel_check;
alter table public.marketing_sends add constraint marketing_sends_channel_check
  check (channel in ('email', 'sms'));

alter table public.marketing_sends drop constraint if exists marketing_sends_address_check;
alter table public.marketing_sends add constraint marketing_sends_address_check
  check (case channel when 'sms' then mobile is not null else email is not null end);

-- The claim-before-send guarantee, now per channel. Partial indexes rather than
-- one composite: a person can be in both the email and the SMS campaign, and
-- must be stopped from receiving either one twice.
drop index if exists public.marketing_sends_once_idx;
create unique index if not exists marketing_sends_once_email_idx
  on public.marketing_sends (campaign_id, lower(email)) where channel = 'email';
create unique index if not exists marketing_sends_once_sms_idx
  on public.marketing_sends (campaign_id, mobile) where channel = 'sms';

-- ── The audience view learns about phones ────────────────────────────────────
-- marketing_audience() returns SETOF this view, so the function is dropped and
-- rebuilt around it rather than left to resolve against a changed row type.
drop function if exists public.marketing_audience(text, integer);

create or replace view public.customer_marketing_profile as
 WITH accepted AS (
         SELECT q_1.customer_id, q_1.accepted_at, q_1.grand_total, q_1.line_items
           FROM quotes q_1
          WHERE q_1.deleted_at IS NULL AND q_1.accepted_at IS NOT NULL
        ), money AS (
         SELECT accepted.customer_id,
            min(accepted.accepted_at) AS first_purchase_at,
            max(accepted.accepted_at) AS last_purchase_at,
            count(*)::integer AS purchase_count,
            sum(accepted.grand_total) AS lifetime_value
           FROM accepted GROUP BY accepted.customer_id
        ), lines AS (
         SELECT a.customer_id,
            marketing_product_family(li.value ->> 'description'::text, li.value ->> 'productNameSnapshot'::text) AS family,
            COALESCE(NULLIF(li.value ->> 'quantity'::text, ''::text)::numeric, 1::numeric) AS qty,
            (COALESCE(li.value ->> 'description'::text, ''::text) || ' '::text) || COALESCE(li.value ->> 'productNameSnapshot'::text, ''::text) AS hay
           FROM accepted a
             CROSS JOIN LATERAL jsonb_array_elements(a.line_items) li(value)
          WHERE jsonb_typeof(a.line_items) = 'array'::text
        ), prod AS (
         SELECT lines.customer_id,
            array_agg(DISTINCT lines.family) FILTER (WHERE lines.family IS NOT NULL AND (lines.family <> ALL (ARRAY['Service & Install'::text, 'Parts & Accessories'::text]))) AS families,
            COALESCE(sum(lines.qty) FILTER (WHERE lines.family = ANY (ARRAY['Roller Blinds'::text, 'Roman Blinds'::text, 'Venetians'::text, 'Verticals'::text, 'Pleated & Cellular'::text])), 0::numeric)::integer AS blind_count,
            COALESCE(sum(lines.qty) FILTER (WHERE lines.family = 'Curtains & Sheers'::text), 0::numeric)::integer AS curtain_count,
            COALESCE(bool_or(lines.hay ~* '\m(mot|mt|motoris\w*|motors?|somfy|automate|glydea)\M'::text), false) AS has_motorised,
            COALESCE(bool_or(lines.hay ~* '\mbattery\M'::text), false) AS has_battery
           FROM lines GROUP BY lines.customer_id
        ), primary_prod AS (
         SELECT DISTINCT ON (x.customer_id) x.customer_id, x.family AS primary_product
           FROM ( SELECT lines.customer_id, lines.family, sum(lines.qty) AS q
                   FROM lines
                  WHERE lines.family IS NOT NULL AND (lines.family <> ALL (ARRAY['Service & Install'::text, 'Parts & Accessories'::text]))
                  GROUP BY lines.customer_id, lines.family) x
          ORDER BY x.customer_id, x.q DESC, x.family
        ), quoted AS (
         SELECT quotes.customer_id, count(*)::integer AS quote_count,
            max(COALESCE(quotes.sent_at, quotes.created_at)) AS last_quoted_at
           FROM quotes WHERE quotes.deleted_at IS NULL GROUP BY quotes.customer_id
        )
 SELECT c.id AS customer_id,
    c.name,
    marketing_first_name(c.name) AS first_name,
    lower(btrim(c.email)) AS email,
    NULLIF(btrim(c.business_name), ''::text) AS business_name,
    marketing_suburb(COALESCE(NULLIF(btrim(c.address), ''::text), c.billing_address)) AS suburb,
    NULLIF(btrim(c.business_name), ''::text) IS NOT NULL OR COALESCE(m.purchase_count, 0) >= 5 AS is_trade,
    m.first_purchase_at,
    m.last_purchase_at,
    COALESCE(m.purchase_count, 0) AS purchase_count,
    COALESCE(m.lifetime_value, 0::numeric) AS lifetime_value,
    EXTRACT(year FROM m.last_purchase_at)::integer AS last_purchase_year,
    to_char(m.last_purchase_at, 'FMMonth YYYY'::text) AS last_purchase_label,
        CASE
            WHEN m.last_purchase_at IS NULL THEN NULL::integer
            ELSE floor(EXTRACT(epoch FROM now() - m.last_purchase_at) / 31557600::numeric)::integer
        END AS years_since_purchase,
    COALESCE(q.quote_count, 0) AS quote_count,
    q.last_quoted_at,
    COALESCE(p.families, '{}'::text[]) AS product_families,
    COALESCE(p.blind_count, 0) AS blind_count,
    COALESCE(p.curtain_count, 0) AS curtain_count,
    COALESCE(p.has_motorised, false) AS has_motorised,
    COALESCE(p.has_battery, false) AS has_battery,
    pp.primary_product,
    marketing_product_phrase(pp.primary_product) AS product_phrase,
        CASE
            WHEN m.last_purchase_at IS NULL AND COALESCE(q.quote_count, 0) > 0 THEN 'E'::text
            WHEN m.last_purchase_at IS NULL THEN 'F'::text
            WHEN m.last_purchase_at > (now() - '2 years'::interval) THEN 'A'::text
            WHEN m.last_purchase_at > (now() - '5 years'::interval) THEN 'B'::text
            WHEN m.last_purchase_at > (now() - '8 years'::interval) THEN 'C'::text
            ELSE 'D'::text
        END AS segment,
    c.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'::text AND s.email IS NULL AS emailable,
    s.reason AS suppressed_reason,
    -- Mobile preferred over phone: the mobile field is the one staff fill in
    -- for a person, phone is as often the office landline.
    marketing_mobile_e164(COALESCE(NULLIF(btrim(c.mobile), ''::text), NULLIF(btrim(c.phone), ''::text))) AS mobile_e164,
    marketing_mobile_e164(COALESCE(NULLIF(btrim(c.mobile), ''::text), NULLIF(btrim(c.phone), ''::text))) IS NOT NULL
      AND sms.mobile IS NULL AS textable,
    sms.reason AS sms_suppressed_reason
   FROM customers c
     LEFT JOIN money m ON m.customer_id = c.id
     LEFT JOIN prod p ON p.customer_id = c.id
     LEFT JOIN primary_prod pp ON pp.customer_id = c.id
     LEFT JOIN quoted q ON q.customer_id = c.id
     LEFT JOIN marketing_suppressions s ON s.email = lower(btrim(c.email))
     LEFT JOIN marketing_sms_suppressions sms
       ON sms.mobile = marketing_mobile_e164(COALESCE(NULLIF(btrim(c.mobile), ''::text), NULLIF(btrim(c.phone), ''::text)))
  WHERE c.deleted_at IS NULL;

-- ── Audience, now channel-aware and chainable ────────────────────────────────
create or replace function public.marketing_audience(p_campaign_id text, p_limit integer default null)
returns setof public.customer_marketing_profile
language sql stable set search_path to 'public' as $$
  select p.*
  from public.marketing_campaigns c
  join public.customer_marketing_profile p
    on p.segment = c.segment
   -- Reachability is channel-specific and does not substitute: an email
   -- campaign needs a deliverable address, an SMS campaign needs a mobile.
   and (case c.channel when 'sms' then p.textable else p.emailable end)
   and (c.audience ->> 'is_trade'           is null or p.is_trade       = (c.audience ->> 'is_trade')::boolean)
   and (c.audience ->> 'has_motorised'      is null or p.has_motorised  = (c.audience ->> 'has_motorised')::boolean)
   and (c.audience ->> 'has_battery'        is null or p.has_battery    = (c.audience ->> 'has_battery')::boolean)
   and (c.audience ->> 'min_blind_count'    is null or p.blind_count    >= (c.audience ->> 'min_blind_count')::int)
   and (c.audience ->> 'min_lifetime_value' is null or p.lifetime_value >= (c.audience ->> 'min_lifetime_value')::numeric)
   and (c.audience ->> 'product_family'     is null or (c.audience ->> 'product_family') = any(p.product_families))
  where c.id = p_campaign_id
    -- Never the same address twice in the same campaign, per channel.
    and not exists (
      select 1 from public.marketing_sends s
      where s.campaign_id = c.id
        and (case c.channel
               when 'sms' then s.mobile = p.mobile_e164
               else lower(s.email) = p.email
             end)
    )
    -- Chaining. `after_campaign` names a campaign this one follows; anyone who
    -- already replied to that one is dropped, because they are in a
    -- conversation and a bulk text would talk over it.
    and (
      c.audience ->> 'after_campaign' is null
      or not exists (
        select 1 from public.marketing_sends s2
        where s2.campaign_id = c.audience ->> 'after_campaign'
          and s2.customer_id = p.customer_id
          and s2.status = 'replied'
      )
    )
    -- With `only_if_contacted`, the follow-up is restricted to people the
    -- earlier campaign actually reached. Without it a "follow-up" would also
    -- cold-text everyone the first campaign never got to.
    and (
      coalesce((c.audience ->> 'only_if_contacted')::boolean, false) = false
      or exists (
        select 1 from public.marketing_sends s3
        where s3.campaign_id = c.audience ->> 'after_campaign'
          and s3.customer_id = p.customer_id
          and s3.status in ('sent', 'replied')
      )
    )
  order by p.lifetime_value desc nulls last, p.last_purchase_at asc nulls last
  limit p_limit;
$$;

-- ── Honour an inbound STOP ───────────────────────────────────────────────────
-- Called by comms-inbound. SECURITY DEFINER because the opt-out must land even
-- though the request arrives from Twilio with no user session attached: failing
-- to record it is a breach, not an inconvenience. Returns the normalised number
-- it suppressed, or null if the sender was not a recognisable AU mobile.
create or replace function public.marketing_suppress_mobile(
  p_mobile text, p_reason text default 'stop', p_source text default null
) returns text language plpgsql security definer set search_path to 'public' as $$
declare v_mobile text;
begin
  v_mobile := public.marketing_mobile_e164(p_mobile);
  if v_mobile is null then return null; end if;

  insert into public.marketing_sms_suppressions (mobile, customer_id, reason, source)
  values (
    v_mobile,
    (select cu.id from public.customers cu
      where cu.deleted_at is null
        and public.marketing_mobile_e164(coalesce(nullif(btrim(cu.mobile), ''), nullif(btrim(cu.phone), ''))) = v_mobile
      limit 1),
    p_reason, p_source
  )
  on conflict (mobile) do nothing;

  return v_mobile;
end $$;

revoke all on function public.marketing_suppress_mobile(text, text, text) from public, anon, authenticated;

-- ── Dashboard reports both channels ──────────────────────────────────────────
create or replace function public.marketing_dashboard()
returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'segments', (
      select coalesce(jsonb_agg(s order by s ->> 'segment'), '[]'::jsonb) from (
        select jsonb_build_object(
          'segment',   segment,
          'total',     count(*),
          'emailable', count(*) filter (where emailable),
          'textable',  count(*) filter (where textable),
          'retail',    count(*) filter (where emailable and not is_trade),
          'trade',     count(*) filter (where emailable and is_trade),
          -- Retail reach on each channel, which is what a consumer campaign
          -- can actually address.
          'retail_textable', count(*) filter (where textable and not is_trade),
          'value',     round(coalesce(sum(lifetime_value), 0))
        ) s
        from public.customer_marketing_profile
        group by segment
      ) x
    ),
    'campaigns', (
      select coalesce(jsonb_agg(c order by c ->> 'id'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id',        mc.id,
          'name',      mc.name,
          'segment',   mc.segment,
          'channel',   mc.channel,
          'status',    mc.status,
          'wave_size', mc.wave_size,
          'subject',   mc.subject,
          'sms_body',  mc.sms_body,
          'notes',     mc.notes,
          'follows',   mc.audience ->> 'after_campaign',
          'remaining', (select count(*) from public.marketing_audience(mc.id)),
          'sent',      (select count(*) from public.marketing_sends s where s.campaign_id = mc.id and s.status = 'sent'),
          'failed',    (select count(*) from public.marketing_sends s where s.campaign_id = mc.id and s.status = 'failed'),
          'replied',   (select count(*) from public.marketing_sends s where s.campaign_id = mc.id and s.status = 'replied'),
          'waves',     (select coalesce(max(s.wave), 0) from public.marketing_sends s where s.campaign_id = mc.id),
          'last_sent', (select max(s.sent_at) from public.marketing_sends s where s.campaign_id = mc.id)
        ) c
        from public.marketing_campaigns mc
      ) y
    ),
    'suppressed',     (select count(*) from public.marketing_suppressions),
    'sms_suppressed', (select count(*) from public.marketing_sms_suppressions),
    'suppressed_by_reason', (
      select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
      from (select reason, count(*) n from public.marketing_suppressions group by 1) z
    )
  );
$$;
