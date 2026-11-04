-- Growth plan, part two: the pieces that run without anyone driving them.
--
-- Applied 2026-11-03 via MCP. Canonical source for the function bodies is the
-- database; this file is the record and will rebuild the schema from scratch.
--
-- Contents
--   1. customers.lead_source        attribution, so ad spend is measurable
--   2. ad_spend + growth_ad_performance()   cost per booked measure
--   3. growth_trade_targets()       the trade revival call list
--   4. growth_measure_batches()     suburb batching + territory value
--   5. growth_weekly_digest()       Monday push, includes the leak count
--   6. growth_hire_trigger_check()  fires only when both conditions hold
--   7. cron schedules for 5 and 6

-- ── 1. Lead source ───────────────────────────────────────────────────────────
-- Named lead_source, NOT source: `source` already exists as an app-only field
-- carrying import provenance ('Quotient CSV Import') and is listed in
-- EXCLUDE_COLUMNS.customers in src/store/db.js precisely because it has no DB
-- column. Reusing the name would persist importer strings into the attribution
-- field. Left null for existing rows - null means "never asked", which is the
-- truth and more useful than a backfilled guess.

alter table public.customers add column if not exists lead_source text;

comment on column public.customers.lead_source is
  'How this customer first found Lusso, captured at acquisition. Null = never asked. Distinct from the app-only `source` field, which carries import provenance.';

create index if not exists customers_lead_source_idx
  on public.customers (lead_source) where lead_source is not null and deleted_at is null;

-- ── 2. Ad spend ──────────────────────────────────────────────────────────────
-- Entered by hand monthly. Wiring the Google Ads API would be a week of OAuth
-- to replace thirty seconds of typing, and the figure gets eyeballed against
-- the invoice anyway.

create table if not exists public.ad_spend (
  id         text primary key default (gen_random_uuid())::text,
  period     date not null,                      -- first of the month
  channel    text not null default 'google_ads',
  amount     numeric not null default 0 check (amount >= 0),
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ad_spend_period_channel_idx
  on public.ad_spend (period, channel) where deleted_at is null;

comment on table public.ad_spend is
  'Monthly advertising spend by channel. Divided by attributed booked measures to give cost per measure.';

alter table public.ad_spend enable row level security;
drop policy if exists ad_spend_select on public.ad_spend;
create policy ad_spend_select on public.ad_spend for select using ((select public.is_active_user()));
drop policy if exists ad_spend_insert on public.ad_spend;
create policy ad_spend_insert on public.ad_spend for insert with check ((select public.is_active_user()));
drop policy if exists ad_spend_update on public.ad_spend;
create policy ad_spend_update on public.ad_spend for update using ((select public.is_active_user())) with check ((select public.is_active_user()));
drop policy if exists ad_spend_delete on public.ad_spend;
create policy ad_spend_delete on public.ad_spend for delete using ((select public.is_active_user()));

-- Mirrors the `paid` flag in src/lib/leadSources.js. Add a paid channel there,
-- add it here.
create or replace function public.paid_lead_sources()
returns text[] language sql immutable as $$ select array['google_ads']::text[] $$;

notify pgrst, 'reload schema';

-- ── 3. Trade revival list ────────────────────────────────────────────────────
-- The checklist asked for "the 87 five-plus buyers plus twenty more like them".
-- Counting them produced a better answer: only ~21 of the core trade accounts
-- bought in the last year, while ~39 averaging ~$32k lifetime went quiet
-- between one and four years ago. Cold prospecting takes a year to produce a
-- first job; these already produced several each.
--
-- CTEs, not temp tables: the first cut used `create temp table ... on commit
-- drop` and threw "relation _tt already exists" when called twice in one
-- transaction, because ON COMMIT DROP fires at commit, not at function exit.

create or replace function public.growth_trade_targets()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_active_user() then raise exception 'not authorised'; end if;

  with tt as (
    select c.id, c.name,
           nullif(trim(coalesce(c.business_name, '')), '')                     as business,
           count(*) filter (where q.accepted_at is not null)                   as purchases,
           round(sum(q.grand_total) filter (where q.accepted_at is not null))  as lifetime,
           count(distinct nullif(trim(coalesce(q.site_address, '')), ''))      as sites,
           round(extract(epoch from (now() - max(q.accepted_at))) / 2629800.0) as months_since
      from public.customers c
      join public.quotes q on q.customer_id = c.id and q.deleted_at is null
     where c.deleted_at is null
     group by 1, 2, 3
    having count(*) filter (where q.accepted_at is not null) >= 2
  ),
  tiered as (
    select *,
           case when purchases >= 5 then 'core' else 'near' end as tier,
           case when months_since < 12 then 'active'
                when months_since < 24 then 'lapsed_1_2'
                when months_since < 48 then 'lapsed_2_4'
                else 'cold' end as recency
      from tt
     where purchases >= 5
        or (purchases between 2 and 4 and (business is not null or sites >= 2))
  ),
  ranked as (
    select *, row_number() over (
             order by case recency when 'lapsed_1_2' then 1 when 'lapsed_2_4' then 2 else 3 end,
                      case tier    when 'core'       then 1 else 2 end,
                      lifetime desc) as rn
      from tiered where recency <> 'active'
  )
  select jsonb_build_object(
    'summary', coalesce((
      select jsonb_object_agg(k, v) from (
        select tier || '_' || recency as k,
               jsonb_build_object('accounts', count(*), 'value', sum(lifetime),
                                  'avg', round(avg(lifetime))) as v
          from tiered group by 1) s), '{}'::jsonb),
    -- Ordered by how recoverable the money is, not how big it was: a core
    -- account quiet 14 months outranks a bigger one quiet five years, because
    -- one is a phone call and the other is archaeology.
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', rn, 'id', id, 'name', name, 'business', business,
               'purchases', purchases, 'lifetime', lifetime,
               'months_since', months_since, 'tier', tier, 'recency', recency,
               'why', case
                 when tier = 'core' and recency = 'lapsed_1_2'
                   then purchases || ' jobs, $' || to_char(lifetime, 'FM999,999')
                        || ' lifetime, quiet ' || months_since || ' months'
                 when tier = 'core' and recency = 'lapsed_2_4'
                   then purchases || ' jobs, $' || to_char(lifetime, 'FM999,999')
                        || ' lifetime, quiet ' || round(months_since / 12.0, 1) || ' years'
                 when tier = 'core'
                   then 'Was a ' || purchases || '-job account, last bought '
                        || round(months_since / 12.0, 1) || ' years ago'
                 else purchases || ' jobs'
                      || case when sites >= 2 then ', ' || sites || ' different sites' else '' end
                      || ', $' || to_char(lifetime, 'FM999,999') || ' - behaves like trade'
               end) order by rn)
        from ranked where rn <= 25), '[]'::jsonb),
    'active', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'name', name, 'business', business,
               'purchases', purchases, 'lifetime', lifetime,
               'months_since', months_since) order by lifetime desc)
        from tiered where recency = 'active' and tier = 'core'), '[]'::jsonb)
  ) into v_out;
  return v_out;
end; $$;

revoke all on function public.growth_trade_targets() from public, anon;
grant execute on function public.growth_trade_targets() to authenticated;

-- ── 4. Ad performance ────────────────────────────────────────────────────────
-- A booked measure from a paid source = a customer carrying a paid lead_source
-- whose FIRST quote was raised that month (first quote, not customer-created,
-- so a name typed in before the visit lands in the month the work happened).
-- Thresholds derive from live gross profit per appointment (25% / 60%) rather
-- than being hard-coded, so they move with the business.

create or replace function public.growth_ad_performance()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_out jsonb; v_gp_per_visit numeric; v_gm numeric;
begin
  if not public.is_active_user() then raise exception 'not authorised'; end if;

  select round(100.0 * (sum(total_sell) - sum(total_cost)) / nullif(sum(total_sell), 0), 1)
    into v_gm from public.quotes
   where deleted_at is null and accepted_at is not null
     and created_at >= now() - interval '22 months' and total_sell > 0 and total_cost > 0;

  select round(coalesce(sum(grand_total) filter (where accepted_at is not null), 0)
               / nullif(count(*), 0) * v_gm / 100.0)
    into v_gp_per_visit from public.quotes
   where deleted_at is null and created_at >= now() - interval '22 months';

  with first_quote as (
    select customer_id, min(created_at) as first_at
      from public.quotes where deleted_at is null group by 1),
  paid as (
    select date_trunc('month', f.first_at)::date as period,
           count(*) as measures,
           count(*) filter (where exists (
             select 1 from public.quotes q2 where q2.customer_id = c.id
               and q2.deleted_at is null and q2.accepted_at is not null)) as won,
           coalesce(sum((select sum(q3.grand_total) from public.quotes q3
              where q3.customer_id = c.id and q3.deleted_at is null
                and q3.accepted_at is not null)), 0) as revenue
      from public.customers c join first_quote f on f.customer_id = c.id
     where c.deleted_at is null and c.lead_source = any (public.paid_lead_sources())
     group by 1),
  spend as (select period, sum(amount) as amount from public.ad_spend
             where deleted_at is null group by 1),
  joined as (
    select coalesce(s.period, p.period) as period, coalesce(s.amount, 0) as spend,
           coalesce(p.measures, 0) as measures, coalesce(p.won, 0) as won,
           coalesce(p.revenue, 0) as revenue
      from spend s full outer join paid p on p.period = s.period)
  select jsonb_build_object(
    'gp_per_visit', v_gp_per_visit,
    'threshold_good', round(v_gp_per_visit * 0.25),
    'threshold_warn', round(v_gp_per_visit * 0.60),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
               'period', to_char(period, 'YYYY-MM'), 'spend', spend,
               'measures', measures, 'won', won, 'revenue', revenue,
               'cost_per_measure', case when measures > 0 then round(spend / measures) end,
               'gp', round(revenue * v_gm / 100.0),
               'roi', case when spend > 0 then round((revenue * v_gm / 100.0) / spend, 1) end
             ) order by period desc)
        from joined where period >= date_trunc('month', now()) - interval '12 months'), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_build_object('spend', sum(spend), 'measures', sum(measures),
               'won', sum(won), 'revenue', sum(revenue),
               'cost_per_measure', case when sum(measures) > 0
                                        then round(sum(spend) / sum(measures)) end)
        from joined), '{}'::jsonb),
    -- Cost per measure over a book where nobody was asked how they found us is
    -- a fiction, so the page is told how much of recent intake carries a source.
    'attribution', (
      select jsonb_build_object(
               'asked', count(*) filter (where lead_source is not null),
               'total', count(*),
               'pct', case when count(*) > 0 then
                        round(100.0 * count(*) filter (where lead_source is not null) / count(*)) end)
        from public.customers
       where deleted_at is null and created_at >= now() - interval '90 days')
  ) into v_out;
  return v_out;
end; $$;

revoke all on function public.growth_ad_performance() from public, anon;
grant execute on function public.growth_ad_performance() to authenticated;

-- ── 5. Suburb batching + territory ───────────────────────────────────────────
-- The round trip is the real cost of an appointment. Addresses are free text
-- typed by humans over eleven years, so there is no suburb column; the
-- postcode is the reliable token and is a better grouping key anyway because
-- it already encodes adjacency. The suburb name is parsed for the label only.

create or replace function public.growth_measure_batches()
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_active_user() then raise exception 'not authorised'; end if;

  with parsed as (
    select c.id, c.name, c.address,
           substring(c.address from '(\d{4})(?:,?\s*Australia)?\s*$') as postcode,
           initcap(trim(substring(
             c.address from ',\s*([A-Za-z][A-Za-z''\- ]+?)\s+(?:QLD|NSW|Qld|Nsw|qld|nsw)\M'))) as suburb
      from public.customers c where c.deleted_at is null),
  pending_jobs as (
    select p.postcode, p.suburb, j.id as job_id, p.name, j.status, j.created_at
      from public.jobs j join parsed p on p.id = j.customer_id
     where j.deleted_at is null and j.status in ('New Enquiry', 'Quote Required')),
  pending_leads as (
    select null::text as postcode,
           initcap(nullif(trim(coalesce(w.suburb, '')), '')) as suburb,
           null::text as job_id, w.name, 'Web enquiry' as status, w.created_at
      from public.web_enquiries w
     where w.deleted_at is null
       and coalesce(w.status, 'new') not in ('converted', 'archived')),
  pending as (select * from pending_jobs union all select * from pending_leads)
  select jsonb_build_object(
    'pending', coalesce((
      select jsonb_agg(g order by (g->>'waiting')::int desc) from (
        select jsonb_build_object(
                 'postcode', coalesce(postcode, '—'),
                 'suburb', coalesce(suburb, 'Unknown'),
                 'waiting', count(*),
                 'oldest_days', round(extract(epoch from (now() - min(created_at))) / 86400.0),
                 'items', jsonb_agg(jsonb_build_object(
                            'job_id', job_id, 'name', name, 'status', status,
                            'days', round(extract(epoch from (now() - created_at)) / 86400.0))
                          order by created_at)) as g
          from pending group by coalesce(postcode, '—'), coalesce(suburb, 'Unknown')) x), '[]'::jsonb),
    'pending_total', (select count(*) from pending),
    -- Won revenue per postcode: a postcode producing one $600 job a year is
    -- visibly different from one producing eight $9k jobs, and that is a
    -- location bid adjustment in Google Ads as much as a driving decision.
    'territory', coalesce((
      select jsonb_agg(t order by (t->>'revenue')::numeric desc) from (
        select jsonb_build_object(
                 'postcode', p.postcode,
                 'suburb', mode() within group (order by p.suburb),
                 'customers', count(distinct p.id),
                 'jobs', count(*) filter (where q.accepted_at is not null),
                 'revenue', round(coalesce(sum(q.grand_total) filter (where q.accepted_at is not null), 0)),
                 'avg_job', round(coalesce(avg(q.grand_total) filter (where q.accepted_at is not null), 0))) as t
          from parsed p
          join public.quotes q on q.customer_id = p.id and q.deleted_at is null
         where p.postcode is not null and q.created_at >= now() - interval '3 years'
         group by p.postcode
        having count(*) filter (where q.accepted_at is not null) > 0
         order by sum(q.grand_total) filter (where q.accepted_at is not null) desc nulls last
         limit 20) y), '[]'::jsonb)
  ) into v_out;
  return v_out;
end; $$;

revoke all on function public.growth_measure_batches() from public, anon;
grant execute on function public.growth_measure_batches() to authenticated;

-- ── 6. Weekly digest ─────────────────────────────────────────────────────────
-- Follows notify_morning_brief(): insert a notifications row, let the AFTER
-- INSERT trigger fan it out to Web Push, dedupe_key makes a re-run harmless.
--
-- The qualification-leak count rides inside this rather than being its own
-- alert. Three separate pushes a week is how an alert system gets muted, and
-- the leak is a trend, not an incident. Note every array append is cast
-- ::text - `v_parts || 'literal'` is ambiguous and throws "malformed array
-- literal", which is exactly how the first version broke.

create or replace function public.growth_weekly_digest()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_week date := (date_trunc('week', now() at time zone 'Australia/Brisbane'))::date;
  v_per_week numeric; v_ceiling numeric; v_close numeric;
  v_avg_won numeric; v_leaks int; v_attr int; v_attr_total int;
  v_cpm numeric; v_parts text[] := '{}'; v_msg text;
begin
  select round(count(distinct customer_id) / 13.0, 1) into v_per_week
    from public.quotes where deleted_at is null and created_at >= now() - interval '13 weeks';

  select round(100.0 * count(*) filter (where accepted_at is not null) / nullif(count(*), 0), 1),
         round(avg(grand_total) filter (where accepted_at is not null))
    into v_close, v_avg_won from public.quotes
   where deleted_at is null and created_at >= now() - interval '15 months'
     and created_at < now() - interval '90 days';

  select (s.target_week_hours - case when s.has_coordinator then s.coordinator_admin_hours else s.weekly_admin_hours end)
         / nullif(s.hours_per_measure
             + case when s.has_coordinator then 0 else s.hours_post_sale * (v_close / 100.0) end, 0)
    into v_ceiling from public.growth_settings s where s.id = 1;

  -- Small jobs quoted for cold, non-trade customers in the last week. Under
  -- the routing rule these should have been quoted remotely, not driven to.
  select count(*) into v_leaks
    from public.quotes q join public.customers c on c.id = q.customer_id
   where q.deleted_at is null and c.deleted_at is null
     and q.created_at >= now() - interval '7 days'
     and q.grand_total > 0 and q.grand_total < 1000
     and nullif(trim(coalesce(c.business_name, '')), '') is null
     and not exists (select 1 from public.quotes p
                      where p.customer_id = c.id and p.deleted_at is null
                        and p.accepted_at is not null and p.accepted_at < q.created_at);

  select count(*) filter (where lead_source is not null), count(*)
    into v_attr, v_attr_total from public.customers
   where deleted_at is null and created_at >= now() - interval '30 days';

  select case when sum(a.amount) > 0 and count(distinct c.id) > 0
              then round(sum(a.amount) / count(distinct c.id)) end
    into v_cpm from public.ad_spend a
    left join public.customers c
      on c.lead_source = any (public.paid_lead_sources()) and c.deleted_at is null
     and date_trunc('month', c.created_at)::date = a.period
   where a.deleted_at is null and a.period >= date_trunc('month', now()) - interval '1 month';

  v_parts := v_parts || (v_per_week || ' measures/wk vs ' || round(v_ceiling, 1) || ' ceiling ('
                         || round(100.0 * v_per_week / nullif(v_ceiling, 0)) || '%)')::text;
  if v_close   is not null then v_parts := v_parts || (v_close || '% close')::text; end if;
  if v_avg_won is not null then v_parts := v_parts || ('$' || to_char(v_avg_won, 'FM999,999') || ' avg job')::text; end if;
  if v_cpm     is not null then v_parts := v_parts || ('$' || to_char(v_cpm, 'FM999,999') || '/measure on ads')::text; end if;
  if v_leaks > 0 then
    v_parts := v_parts || (v_leaks || ' small cold job' || case when v_leaks = 1 then '' else 's' end
                           || ' quoted - route remotely?')::text;
  end if;
  if v_attr_total > 0 and v_attr = 0 then
    v_parts := v_parts || 'no lead sources captured in 30d'::text;
  end if;

  v_msg := array_to_string(v_parts, ' · ');

  insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
  values (gen_random_uuid()::text, 'morning_brief', '📈 Weekly growth check', v_msg,
          null, '/growth', false, now(), 'growth_weekly:' || v_week::text)
  on conflict (dedupe_key) do nothing;
  return v_msg;
end; $$;

-- ── 7. Hire trigger ──────────────────────────────────────────────────────────
-- Fires only when BOTH hold, because either alone is a different situation:
-- sustained demand with fast turnaround means you are coping, and slow
-- turnaround on low volume means something else is wrong.
--   A. 8+ measures/wk averaged over six weeks, no single week under 6.
--   B. Median days from customer created to first quote > 3.
-- B uses customer-created to first-quote as a proxy because jobs.measure_date
-- has never been populated. Revisit when it is.

create or replace function public.growth_hire_trigger_check()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_avg numeric; v_min numeric; v_median numeric; v_msg text;
  v_month text := to_char(now() at time zone 'Australia/Brisbane', 'YYYY-MM');
begin
  with weeks as (
    select date_trunc('week', created_at) wk, count(distinct customer_id) n
      from public.quotes
     where deleted_at is null
       and created_at >= date_trunc('week', now()) - interval '6 weeks'
       and created_at <  date_trunc('week', now())
     group by 1)
  select round(avg(n), 1), min(n) into v_avg, v_min from weeks;

  select round(percentile_cont(0.5) within group (
           order by extract(epoch from (q.first_at - c.created_at)) / 86400.0)::numeric, 1)
    into v_median from public.customers c
    join (select customer_id, min(created_at) first_at from public.quotes
           where deleted_at is null group by 1) q on q.customer_id = c.id
   where c.deleted_at is null and c.created_at >= now() - interval '6 weeks'
     and q.first_at >= c.created_at;

  if coalesce(v_avg, 0) < 8 or coalesce(v_min, 0) < 6 or coalesce(v_median, 0) <= 3 then
    return 'not triggered (avg ' || coalesce(v_avg, 0) || '/wk, min ' || coalesce(v_min, 0)
           || ', turnaround ' || coalesce(v_median, 0) || 'd)';
  end if;

  v_msg := 'Both conditions met for six weeks: ' || v_avg || ' measures/wk (never below '
           || v_min || ') and ' || v_median || ' days enquiry to quote. '
           || 'An ops coordinator (~$80k) moves the ceiling from ~9 to ~15.';

  insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
  values (gen_random_uuid()::text, 'task_due', '🚦 Time to hire the coordinator', v_msg,
          null, '/growth', false, now(), 'hire_trigger:' || v_month)
  on conflict (dedupe_key) do nothing;
  return v_msg;
end; $$;

-- ── 8. Schedule ──────────────────────────────────────────────────────────────
-- Cron is UTC; Brisbane is UTC+10 with no daylight saving, so 21:00 UTC Sunday
-- is 07:00 Monday local - matching the existing `0 21 * * *` 7am daily jobs.

select cron.unschedule('growth-weekly-digest')
 where exists (select 1 from cron.job where jobname = 'growth-weekly-digest');
select cron.schedule('growth-weekly-digest', '0 21 * * 0',
                     $$select public.growth_weekly_digest()$$);

select cron.unschedule('growth-hire-trigger')
 where exists (select 1 from cron.job where jobname = 'growth-hire-trigger');
select cron.schedule('growth-hire-trigger', '15 21 * * 0',
                     $$select public.growth_hire_trigger_check()$$);

notify pgrst, 'reload schema';
