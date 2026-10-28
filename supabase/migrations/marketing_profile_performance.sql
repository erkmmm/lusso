-- Make the campaigns dashboard loadable at all.
--
-- `marketing_dashboard()` took 14.7s against an 8s statement_timeout on the
-- `authenticated` role, so every staff user got a timeout and a page with the
-- headings drawn and both lists empty. It was already ~13s with four campaigns
-- — the page has never actually loaded in production — and adding the SMS
-- follow-up pushed it further out.
--
-- Why it was slow: customer_marketing_profile re-derives every per-customer
-- aggregate from scratch, including unnesting line_items for every accepted
-- quote, and the dashboard evaluates the view once for the segment summary
-- plus once per campaign via marketing_audience(). Six full re-aggregations of
-- the entire quote history to draw one page.
--
-- The fix is to compute those aggregates once into a materialised view. The
-- audience definition is untouched: marketing_audience() remains the single
-- source of truth for who gets contacted, which is the invariant that keeps
-- the UI preview and the sender honest.

-- ── The expensive half, computed once ────────────────────────────────────────
-- Keyed off quotes rather than customers on purpose: a brand-new customer with
-- no quotes must still appear in the profile (as segment F) without waiting
-- for a refresh, so the profile view keeps joining `customers` live and only
-- the quote-derived facts come from here.
drop materialized view if exists public.customer_marketing_facts cascade;

create materialized view public.customer_marketing_facts as
 WITH accepted AS (
         SELECT q_1.customer_id, q_1.accepted_at, q_1.grand_total, q_1.line_items
           FROM quotes q_1
          WHERE q_1.deleted_at IS NULL AND q_1.accepted_at IS NOT NULL
            AND q_1.customer_id IS NOT NULL
        ), ids AS (
         SELECT DISTINCT customer_id FROM quotes
          WHERE deleted_at IS NULL AND customer_id IS NOT NULL
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
           FROM quotes WHERE quotes.deleted_at IS NULL AND quotes.customer_id IS NOT NULL
          GROUP BY quotes.customer_id
        )
 SELECT i.customer_id,
    m.first_purchase_at,
    m.last_purchase_at,
    m.purchase_count,
    m.lifetime_value,
    p.families,
    p.blind_count,
    p.curtain_count,
    p.has_motorised,
    p.has_battery,
    pp.primary_product,
    q.quote_count,
    q.last_quoted_at
   FROM ids i
     LEFT JOIN money m ON m.customer_id = i.customer_id
     LEFT JOIN prod p ON p.customer_id = i.customer_id
     LEFT JOIN primary_prod pp ON pp.customer_id = i.customer_id
     LEFT JOIN quoted q ON q.customer_id = i.customer_id;

-- Required for REFRESH ... CONCURRENTLY, which is what lets a refresh run
-- without blocking the dashboard that is reading it.
create unique index customer_marketing_facts_pkey
  on public.customer_marketing_facts (customer_id);

-- ── The profile view now joins those facts instead of deriving them ──────────
create or replace view public.customer_marketing_profile as
 SELECT c.id AS customer_id,
    c.name,
    marketing_first_name(c.name) AS first_name,
    lower(btrim(c.email)) AS email,
    NULLIF(btrim(c.business_name), ''::text) AS business_name,
    marketing_suburb(COALESCE(NULLIF(btrim(c.address), ''::text), c.billing_address)) AS suburb,
    NULLIF(btrim(c.business_name), ''::text) IS NOT NULL OR COALESCE(f.purchase_count, 0) >= 5 AS is_trade,
    f.first_purchase_at,
    f.last_purchase_at,
    COALESCE(f.purchase_count, 0) AS purchase_count,
    COALESCE(f.lifetime_value, 0::numeric) AS lifetime_value,
    EXTRACT(year FROM f.last_purchase_at)::integer AS last_purchase_year,
    to_char(f.last_purchase_at, 'FMMonth YYYY'::text) AS last_purchase_label,
        CASE
            WHEN f.last_purchase_at IS NULL THEN NULL::integer
            ELSE floor(EXTRACT(epoch FROM now() - f.last_purchase_at) / 31557600::numeric)::integer
        END AS years_since_purchase,
    COALESCE(f.quote_count, 0) AS quote_count,
    f.last_quoted_at,
    COALESCE(f.families, '{}'::text[]) AS product_families,
    COALESCE(f.blind_count, 0) AS blind_count,
    COALESCE(f.curtain_count, 0) AS curtain_count,
    COALESCE(f.has_motorised, false) AS has_motorised,
    COALESCE(f.has_battery, false) AS has_battery,
    f.primary_product,
    marketing_product_phrase(f.primary_product) AS product_phrase,
        CASE
            WHEN f.last_purchase_at IS NULL AND COALESCE(f.quote_count, 0) > 0 THEN 'E'::text
            WHEN f.last_purchase_at IS NULL THEN 'F'::text
            WHEN f.last_purchase_at > (now() - '2 years'::interval) THEN 'A'::text
            WHEN f.last_purchase_at > (now() - '5 years'::interval) THEN 'B'::text
            WHEN f.last_purchase_at > (now() - '8 years'::interval) THEN 'C'::text
            ELSE 'D'::text
        END AS segment,
    c.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'::text AND s.email IS NULL AS emailable,
    s.reason AS suppressed_reason,
    marketing_mobile_e164(COALESCE(NULLIF(btrim(c.mobile), ''::text), NULLIF(btrim(c.phone), ''::text))) AS mobile_e164,
    marketing_mobile_e164(COALESCE(NULLIF(btrim(c.mobile), ''::text), NULLIF(btrim(c.phone), ''::text))) IS NOT NULL
      AND sms.mobile IS NULL AS textable,
    sms.reason AS sms_suppressed_reason
   FROM customers c
     LEFT JOIN customer_marketing_facts f ON f.customer_id = c.id
     LEFT JOIN marketing_suppressions s ON s.email = lower(btrim(c.email))
     LEFT JOIN marketing_sms_suppressions sms
       ON sms.mobile = marketing_mobile_e164(COALESCE(NULLIF(btrim(c.mobile), ''::text), NULLIF(btrim(c.phone), ''::text)))
  WHERE c.deleted_at IS NULL;

-- marketing_audience() is recreated verbatim — it returns SETOF the view, so it
-- has to be rebuilt around the new row type. The selection rules are unchanged.
drop function if exists public.marketing_audience(text, integer);

create or replace function public.marketing_audience(p_campaign_id text, p_limit integer default null)
returns setof public.customer_marketing_profile
language sql stable set search_path to 'public' as $$
  select p.*
  from public.marketing_campaigns c
  join public.customer_marketing_profile p
    on p.segment = c.segment
   and (case c.channel when 'sms' then p.textable else p.emailable end)
   and (c.audience ->> 'is_trade'           is null or p.is_trade       = (c.audience ->> 'is_trade')::boolean)
   and (c.audience ->> 'has_motorised'      is null or p.has_motorised  = (c.audience ->> 'has_motorised')::boolean)
   and (c.audience ->> 'has_battery'        is null or p.has_battery    = (c.audience ->> 'has_battery')::boolean)
   and (c.audience ->> 'min_blind_count'    is null or p.blind_count    >= (c.audience ->> 'min_blind_count')::int)
   and (c.audience ->> 'min_lifetime_value' is null or p.lifetime_value >= (c.audience ->> 'min_lifetime_value')::numeric)
   and (c.audience ->> 'product_family'     is null or (c.audience ->> 'product_family') = any(p.product_families))
  where c.id = p_campaign_id
    and not exists (
      select 1 from public.marketing_sends s
      where s.campaign_id = c.id
        and (case c.channel
               when 'sms' then s.mobile = p.mobile_e164
               else lower(s.email) = p.email
             end)
    )
    and (
      c.audience ->> 'after_campaign' is null
      or not exists (
        select 1 from public.marketing_sends s2
        where s2.campaign_id = c.audience ->> 'after_campaign'
          and s2.customer_id = p.customer_id
          and s2.status = 'replied'
      )
    )
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

-- ── Refreshing the facts ─────────────────────────────────────────────────────
-- The one cost of materialising: segment membership now lags until a refresh.
-- That matters in exactly one direction — a customer who just accepted a quote
-- is still sitting in segment D, and D invites them to replace blinds they
-- have only just bought. So the sender refreshes before every real wave, and
-- the dashboard's refresh button calls it too.
--
-- SECURITY DEFINER because REFRESH requires ownership of the materialised
-- view, which `authenticated` does not and should not have.
create or replace function public.marketing_refresh_facts()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  -- Not CONCURRENTLY: that form cannot run inside a transaction block, and a
  -- function body always is one. Plain REFRESH takes an ACCESS EXCLUSIVE lock
  -- for a second or two on ~2,000 rows, which is acceptable; the unique index
  -- above is kept so a human can still refresh concurrently from a session.
  refresh materialized view public.customer_marketing_facts;
end $$;

revoke all on function public.marketing_refresh_facts() from public, anon;
grant execute on function public.marketing_refresh_facts() to authenticated;

grant select on public.customer_marketing_facts to authenticated;
