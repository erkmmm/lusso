-- The growth plan was a document. Documents about capacity go stale the week
-- after they're written, because the whole point of them is a comparison
-- against numbers that move: how many appointments you ran, what the close
-- rate did, whether the average job is actually climbing. A PDF can't tell you
-- you've hit the ceiling.
--
-- So this stores the two halves that a document can't: the CHECKLIST (what to
-- do, in what order, with the trigger that fires each hire) and a SCOREBOARD
-- function that recomputes the plan's own arithmetic from live quote data
-- every time the page loads. The per-visit economics table — the one that says
-- a sub-$1k measure earns $39/hour and a $50k+ measure earns $1,650 — is not
-- copied in here as text. It is derived, so it stays true.
--
-- Two deliberate choices:
--
-- (1) The capacity assumptions live in a table, not in the code. The 3 hours
--     per measure and 3 hours post-sale are ESTIMATES, not measurements, and
--     they drive the headline "nine a week" ceiling. Whoever tracks a real
--     fortnight should be able to correct them without a deploy and watch
--     every downstream number move.
--
-- (2) These are NOT in public.business_settings, even though that is also a
--     single settings row. business_settings is readable by anon on purpose —
--     it's what a customer sees on a cold load of their quote page — and
--     payroll thresholds, margin and hiring triggers have no business being
--     one misconfigured policy away from public. Same reasoning that put
--     curtain_rates in its own table.

-- ── Checklist ────────────────────────────────────────────────────────────────

create table if not exists public.growth_tasks (
  id          text primary key default (gen_random_uuid())::text,
  -- Which block of the plan this belongs to. 'now' is the free, do-it-today
  -- work; q1..q4 stage the spend; 'hire' items are the two thresholds.
  stage       text not null default 'now',
  title       text not null default '',
  detail      text not null default '',
  -- The one-line reason this earns a place in the list. Shown beside the
  -- checkbox, because a checklist without the stake attached gets ignored.
  impact      text not null default '',
  done_at     timestamptz,
  due_date    date,
  sort        int  not null default 0,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists growth_tasks_active_idx
  on public.growth_tasks (stage, sort)
  where deleted_at is null;

comment on table public.growth_tasks is
  'The growth plan checklist. One row per action. stage groups them into now/q1..q4/hire; done_at null means open.';

alter table public.growth_tasks enable row level security;

drop policy if exists growth_tasks_select on public.growth_tasks;
create policy growth_tasks_select on public.growth_tasks
  for select using ((select public.is_active_user()));

drop policy if exists growth_tasks_insert on public.growth_tasks;
create policy growth_tasks_insert on public.growth_tasks
  for insert with check ((select public.is_active_user()));

drop policy if exists growth_tasks_update on public.growth_tasks;
create policy growth_tasks_update on public.growth_tasks
  for update using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists growth_tasks_delete on public.growth_tasks;
create policy growth_tasks_delete on public.growth_tasks
  for delete using ((select public.is_active_user()));

-- ── Capacity assumptions ─────────────────────────────────────────────────────

create table if not exists public.growth_settings (
  id                   int primary key default 1 check (id = 1),
  -- Hours per measure-and-quote lead, all in: round-trip drive, time on site,
  -- building the quote, follow-up calls and revisions.
  hours_per_measure    numeric not null default 3.0,
  -- Hours per WON job after the sale, with installs subcontracted: raising the
  -- PO, chasing acknowledgements, booking the subbie, access coordination,
  -- install-day phone calls, invoicing, payment chase, snags.
  hours_post_sale      numeric not null default 3.0,
  -- Fixed weekly cost of running the business regardless of job count —
  -- marketing, bookkeeping, suppliers, CRM, trade relationships.
  weekly_admin_hours   numeric not null default 8.0,
  -- The working week being solved for. 50 gives a ceiling of 9 measures.
  target_week_hours    numeric not null default 50.0,
  -- Set once the ops coordinator is hired: they absorb the post-sale block,
  -- which moves the ceiling from ~9 to ~15.
  has_coordinator      boolean not null default false,
  coordinator_admin_hours numeric not null default 4.0,
  updated_at           timestamptz not null default now()
);

comment on table public.growth_settings is
  'Capacity model inputs. ESTIMATES, not measurements — they drive the weekly measure ceiling. Correct them after tracking a real fortnight.';

alter table public.growth_settings enable row level security;

drop policy if exists growth_settings_select on public.growth_settings;
create policy growth_settings_select on public.growth_settings
  for select using ((select public.is_active_user()));

drop policy if exists growth_settings_update on public.growth_settings;
create policy growth_settings_update on public.growth_settings
  for update using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists growth_settings_insert on public.growth_settings;
create policy growth_settings_insert on public.growth_settings
  for insert with check ((select public.is_active_user()));

insert into public.growth_settings (id) values (1) on conflict (id) do nothing;

-- ── Scoreboard ───────────────────────────────────────────────────────────────
--
-- Everything the page shows, in one round trip. Deliberately cheap: it reads
-- quotes.grand_total / total_sell / total_cost and never touches the
-- line_items jsonb, which is what made marketing_dashboard() take 14 seconds
-- against the 8-second statement_timeout on the authenticated role.
--
-- On measurement honesty: jobs.measure_date has never been populated - not one
-- row, ever - so "appointments per week" cannot be read directly. It falls back
-- to DISTINCT CUSTOMERS QUOTED per week, which is a good proxy (a customer
-- generally gets one visit, even if that visit yields several quote versions)
-- and reports which source it used in `measures.source`. Start filling
-- measure_date in and this silently becomes exact.
--
-- On revenue: the first cut modelled it as measures x close x avg_won and
-- compared that to what was actually banked. It read 41% low ($71k modelled
-- against $122k real), and the reason is instructive rather than a bug -
-- avg_won is measured on MATURED quotes (90 days to 15 months old, $6,775)
-- while the money arriving now comes from jobs averaging $9,580. Job values
-- are climbing, so any model anchored to the matured average understates the
-- present. Revenue is therefore RATIO-SCALED off what actually landed:
--
--     at_ceiling = actual_month x (ceiling / per_week)
--
-- which needs no assumption about job value or close rate at all, and so
-- cannot drift from reality the way the modelled figure did. It assumes only
-- that the job mix holds as volume rises - which is exactly the assumption the
-- qualification work is designed to break, in the good direction.
--
-- avg_won_recent is surfaced alongside the matured avg_won on purpose: the gap
-- between the two IS the story about mix, and hiding one of them loses it.

create or replace function public.growth_scoreboard()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s            public.growth_settings;
  v_ceiling    numeric;
  v_admin      numeric;
  v_close      numeric;
  v_avg_won    numeric;
  v_avg_recent numeric;
  v_gm         numeric;
  v_per_week   numeric;
  v_source     text;
  v_md_count   int;
  v_bands      jsonb;
  v_actual     numeric;
begin
  if not public.is_active_user() then
    raise exception 'not authorised';
  end if;

  select * into s from public.growth_settings where id = 1;

  -- Close rate and average won value, measured on MATURED quotes only. A quote
  -- raised last week that hasn't been accepted yet is not a loss, and counting
  -- it as one is what makes the raw dashboard number read ~43% when the real
  -- rate is ~55%.
  select
    round(100.0 * count(*) filter (where accepted_at is not null) / nullif(count(*), 0), 1),
    round(avg(grand_total) filter (where accepted_at is not null))
  into v_close, v_avg_won
  from public.quotes
  where deleted_at is null
    and created_at >= now() - interval '15 months'
    and created_at <  now() - interval '90 days';

  select round(avg(grand_total))
  into v_avg_recent
  from public.quotes
  where deleted_at is null and accepted_at >= now() - interval '13 weeks';

  select round(100.0 * (sum(total_sell) - sum(total_cost)) / nullif(sum(total_sell), 0), 1)
  into v_gm
  from public.quotes
  where deleted_at is null and accepted_at is not null
    and created_at >= now() - interval '22 months'
    and total_sell > 0 and total_cost > 0;

  -- hours = admin + (per_measure x L) + (post_sale x close x L), solved for L.
  -- With a coordinator the post-sale block leaves the owner's week entirely
  -- and admin drops to the coordinator figure.
  v_admin := case when s.has_coordinator then s.coordinator_admin_hours else s.weekly_admin_hours end;
  v_ceiling := (s.target_week_hours - v_admin)
               / nullif(s.hours_per_measure
                        + case when s.has_coordinator then 0 else s.hours_post_sale * (v_close / 100.0) end, 0);

  select count(*) into v_md_count
  from public.jobs
  where deleted_at is null and measure_date is not null
    and measure_date >= (now() - interval '13 weeks')::date;

  if v_md_count > 0 then
    v_source   := 'measure_date';
    v_per_week := round(v_md_count / 13.0, 1);
  else
    v_source := 'customers_quoted';
    select round(count(distinct customer_id) / 13.0, 1) into v_per_week
    from public.quotes
    where deleted_at is null and created_at >= now() - interval '13 weeks';
  end if;

  -- Revenue actually accepted per month over the last three COMPLETE months.
  -- Keyed on accepted_at, not created_at: a quote raised in June and accepted
  -- in September is September's money.
  select round(coalesce(sum(grand_total), 0) / 3.0)
  into v_actual
  from public.quotes
  where deleted_at is null and accepted_at is not null
    and accepted_at >= date_trunc('month', now()) - interval '3 months'
    and accepted_at <  date_trunc('month', now());

  -- The per-visit economics, by job size. This is the table that decides how
  -- the diary gets booked, so it is derived rather than remembered.
  select jsonb_agg(b order by b->>'band')
  into v_bands
  from (
    select jsonb_build_object(
      'band', band, 'label', label, 'quotes', quotes, 'won', won,
      'win_pct',       round(100.0 * won / nullif(quotes, 0)),
      'won_value',     won_value,
      'rev_per_visit', round(won_value / nullif(quotes, 0)),
      'gp_per_visit',  round(won_value / nullif(quotes, 0) * v_gm / 100.0),
      'per_hour',      round(won_value / nullif(quotes, 0) * v_gm / 100.0 / nullif(s.hours_per_measure, 0))
    ) as b
    from (
      select
        case
          when grand_total < 1000  then '1' when grand_total < 2500  then '2'
          when grand_total < 5000  then '3' when grand_total < 10000 then '4'
          when grand_total < 20000 then '5' when grand_total < 50000 then '6'
          else '7' end as band,
        case
          when grand_total < 1000  then 'Under $1k'   when grand_total < 2500  then '$1k - $2.5k'
          when grand_total < 5000  then '$2.5k - $5k' when grand_total < 10000 then '$5k - $10k'
          when grand_total < 20000 then '$10k - $20k' when grand_total < 50000 then '$20k - $50k'
          else '$50k+' end as label,
        count(*) as quotes,
        count(*) filter (where accepted_at is not null) as won,
        round(coalesce(sum(grand_total) filter (where accepted_at is not null), 0)) as won_value
      from public.quotes
      where deleted_at is null and created_at >= now() - interval '22 months'
      group by 1, 2
    ) g
  ) x;

  return jsonb_build_object(
    'close_rate',     v_close,
    'avg_won',        v_avg_won,
    'avg_won_recent', v_avg_recent,
    'gm_pct',         v_gm,
    'assumptions',    to_jsonb(s),
    'measures', jsonb_build_object(
      'per_week',       v_per_week,
      'ceiling',        round(v_ceiling, 1),
      'pct_of_ceiling', round(100.0 * v_per_week / nullif(v_ceiling, 0)),
      'headroom',       round(v_ceiling - v_per_week, 1),
      'source',         v_source
    ),
    'revenue', jsonb_build_object(
      'actual_month', v_actual,
      'at_ceiling',   round(v_actual * v_ceiling / nullif(v_per_week, 0)),
      'gp_month',     round(v_actual * v_gm / 100.0),
      'gp_ceiling',   round(v_actual * v_ceiling / nullif(v_per_week, 0) * v_gm / 100.0)
    ),
    'this_week', jsonb_build_object(
      'quotes',    (select count(*) from public.quotes
                    where deleted_at is null and created_at >= date_trunc('week', now())),
      'won',       (select count(*) from public.quotes
                    where deleted_at is null and accepted_at >= date_trunc('week', now())),
      'customers', (select count(distinct customer_id) from public.quotes
                    where deleted_at is null and created_at >= date_trunc('week', now()))
    ),
    'bands', coalesce(v_bands, '[]'::jsonb),
    'tasks', jsonb_build_object(
      'open', (select count(*) from public.growth_tasks where deleted_at is null and done_at is null),
      'done', (select count(*) from public.growth_tasks where deleted_at is null and done_at is not null)
    )
  );
end;
$$;

revoke all on function public.growth_scoreboard() from public, anon;
grant execute on function public.growth_scoreboard() to authenticated;

-- ── Seed the checklist ───────────────────────────────────────────────────────
--
-- Unlike message_presets, the seed here IS the content: the plan's actions are
-- the reason the table exists, and an empty checklist helps nobody. They are
-- ordinary editable rows afterwards — reword, re-date or delete freely. The
-- fixed ids make this migration safely re-runnable without duplicating items.

insert into public.growth_tasks (id, stage, sort, title, impact, detail) values
  ('gt-price-ranges', 'now', 10,
   'Publish price ranges on the site, the auto-reply and voicemail',
   'The cheapest filter in the business',
   'Say the numbers out loud: "most single rooms land between $1,800 and $3,500; a full home is typically $6,000 to $12,000." Nobody with a $400 budget books a measure after reading that, and nobody with a $30k budget is scared off. Self-selection does the filtering before anyone speaks to you.'),

  ('gt-five-questions', 'now', 20,
   'Ask the five intake questions before booking any measure',
   'Three minutes against a three-hour round trip',
   'How many windows, across how many rooms? New build, renovation, or replacing what is there? What is driving it — heat, privacy, light, look? When do you want it finished? And the one everybody skips: have you got a budget range in mind? Honest answers like "no idea, what do they cost?" are fine. It is the evasion that is the signal.'),

  ('gt-routing-rules', 'now', 30,
   'Route by the answers — quote small cold jobs remotely, no van',
   'Frees roughly 7 hours a week',
   'Book the measure for: 4+ windows, new builds and renovations, trade and designer referrals, and any existing customer regardless of job size. Quote remotely from photos and customer measurements for cold 1–3 window like-for-like replacements, sizes confirmed on site at install. Never means-test a repeat buyer — they are 72% of lifetime value.'),

  ('gt-measure-dates', 'now', 40,
   'Start recording measure dates on every job',
   'Makes the capacity ceiling measurable instead of inferred',
   'jobs.measure_date has never been populated, so appointments per week are currently inferred from distinct customers quoted. Fill it in and the scoreboard on this page switches to the exact figure automatically. You cannot manage a ceiling you cannot see.'),

  ('gt-lead-source', 'now', 50,
   'Capture lead source on every phone enquiry',
   'Without it, ad spend cannot be allocated',
   'The web form records a source; phone calls are most of the volume and arrive unattributed. Ask every caller how they found you and put it in the customer record. Cheapest piece of instrumentation available, and Q2 ad spend is wasted without it.'),

  ('gt-review-engine', 'now', 60,
   'Send a review request after every completed install',
   '7 requests sent, ever — against 36 reviews at 4.9 stars',
   'For a service-area business with no shopfront, Google Business Profile is the highest-intent free channel there is, and review count is the lever. The plumbing already exists in the CRM under Reviews. Four a month puts you past 80 reviews inside a year.'),

  ('gt-wave-c', 'q1', 10,
   'Run the segment C re-engagement wave (5–8 years since purchase)',
   '8–16 measures for about $60 of sends',
   'The machine is already built and shipped — segments A–F, email and SMS, STOP handling, suppression lists, the dashboard under Campaigns. It is sitting idle. Run 25 a week, not a blast. C leads on motorisation retrofit and fabric, and asks for current pricing — it never names a fault.'),

  ('gt-wave-d', 'q1', 20,
   'Run the segment D re-engagement wave (8+ years)',
   'The replacement cohort — the point of the whole exercise',
   'Straight to replacement and current pricing. Remember the SMS campaign chains behind the email one and only reaches people who were contacted and did not reply.'),

  ('gt-suburb-batching', 'q1', 30,
   'Batch appointments by suburb — stop crossing the M1 twice a day',
   'The round trip is the real cost, not the hour on site',
   'Cluster geographically. Keeping one fortnightly afternoon for clustered small jobs makes sub-$2.5k work viable again instead of needing to be refused: one trip, four stops.'),

  ('gt-measure-fee', 'q1', 40,
   'Introduce a $95 refundable measure fee on cold 1–3 window enquiries',
   'Ends tyre-kicking; costs a genuine buyer nothing',
   'Credited in full against any order. Apply it ONLY to the cold small-job tier — never to trade, referrals, existing customers or whole-home enquiries. Expect to lose some leads; that band was earning $39 an hour.'),

  ('gt-landing-page', 'q2', 10,
   'Build the ads landing page with price ranges stated',
   'Without the price anchor, paid traffic imports the problem',
   'Paid clicks are the fastest way to fill the diary with exactly the leads the qualification work is designed to filter out. The price anchor on the landing page is what stops that, so it ships before the campaign does.'),

  ('gt-search-ads', 'q2', 20,
   'Build the Google Search campaign from measured-volume keywords only',
   '~$228 per measure against $1,474 expected gross profit',
   'Build it from the 963 terms with real volume already in content_keywords — never invent one. Standouts: "blinds near me" (3,600 volume, $4.82 CPC, transactional), "motorised blinds" (2,400, difficulty 12), "electric blinds" (1,900, difficulty 14). Those are NATIONAL Australian volumes — the Gold Coast is a few percent of that, so expect tens to low hundreds of local searches a month per term. Geo-fence tightly, Search only.'),

  ('gt-motorisation', 'q2', 30,
   'Lead the paid and content push with motorisation retrofit',
   'Low difficulty, commercial intent, high job value',
   'Keyword difficulty 12–14 on commercial-intent terms, a high average job value, and a natural second sale into the existing book. The best-shaped offer available.'),

  ('gt-hire-coordinator', 'hire', 10,
   'HIRE: operations coordinator (~$80k all in)',
   'Moves the ceiling from 9 measures a week to 15 — $484k GP for $80k',
   'TRIGGER — both conditions, not either: 8+ measures a week sustained for six to eight weeks, AND quote turnaround slipping past three days. Sustained demand without the slipping turnaround just means you are coping. They take the entire post-sale block: POs, supplier chasing, subbie booking, access calls, invoicing, payment follow-up. Tick has_coordinator in the assumptions once they start and the ceiling on this page recalculates.'),

  ('gt-trade-list', 'q3', 10,
   'Name the 87 five-plus-time buyers and build the trade target list',
   'Trade closes at 61% vs 50% retail, and averages $7,616 vs $6,050',
   '$4,610 of revenue per visit made against $3,025 for retail. Identify the 87 accounts that have already bought five or more times, then systematically add fifteen to twenty more of the same shape: builders, interior designers, architects, property stylists, high-end agents.'),

  ('gt-trade-coffee', 'q3', 20,
   'One trade coffee a week, every week',
   'The channel that makes a second salesperson viable',
   'Almost no cash cost, just calendar discipline. Trade leads need far less selling per dollar won, which is exactly what a commissioned salesperson needs to clear their cost.'),

  ('gt-organic-pages', 'q4', 10,
   'Publish product and service-area pages on low-difficulty commercial terms',
   'The only channel whose cost per lead falls over time',
   'Panel glide (difficulty 9), vertical roller (10), pinch pleat (11), motorised (12), cellular (15). 962 unused keywords with measured volume and the content engine is already in the CRM. Twelve months to bite.'),

  ('gt-hire-sales', 'hire', 20,
   'HIRE: second measure & quote salesperson (~$115k all in)',
   'Needs ~4 incremental measures a week to return 2.5× their cost',
   'TRIGGER: total qualified lead flow sustaining 15+ a week, so you and the coordinator are both full. At $2,527 gross profit per won job they cover their own cost at 44 won jobs a year, but a hire should return about two and a half times their cost — $275–300k of gross profit, or 110–120 won jobs. Hiring before the leads exist just moves the lead-generation problem onto payroll.')
on conflict (id) do nothing;

notify pgrst, 'reload schema';

-- ── Revision 2026-11-03: drop re-engagement, lead with paid search ───────────
--
-- The original Q1 was a re-engagement pass over the existing book (segments C
-- and D), with paid search held back to Q2. Jett chose to skip the waves and
-- buy new leads instead, and the numbers say that is the right call rather
-- than merely a preference:
--
--   segment          customers   median job   % under $2.5k
--   A  0-2 years        215        $4,231          34%
--   B  2-5 years        241        $4,270          34%
--   C  5-8 years        200        $1,944          57%
--   D  8+ years         242        $1,794          62%
--
-- C and D - precisely the cohorts those waves targeted - are the ones made up
-- of small-job customers. And a repeat purchase is worth about half a first
-- one (median $2,979 first, $1,304 second, $1,153 third). So the waves would
-- have filled the diary with the $39-$153/hour bands at the exact moment the
-- rest of the plan is trying to empty it of them.
--
-- Paid search costs perhaps forty times more per lead (~$228 a measure against
-- a few cents) and is still the better buy, because it buys a FIRST purchase:
-- median $2,979, mean $6,973. The comparison that matters is gross profit per
-- appointment, not cost per lead.
--
-- Worth recording for later: segment B is the one cohort still worth a wave if
-- a near-free channel is ever wanted alongside ads - only 34% small, and the
-- highest average job value of the four at $7,724. It was never the target of
-- the original design, which went after C and D on replacement-cycle logic.

update public.growth_tasks
   set deleted_at = now(),
       notes = 'Skipped 2026-11-03: segments C and D are 57-62% small-job customers (median job $1,944 and $1,794), and repeat purchases run at roughly half the median value of a first purchase. The waves would have filled the diary with the $39-$153/hour bands. Paid search buys a bigger first-time job instead.',
       updated_at = now()
 where id in ('gt-wave-c', 'gt-wave-d');

update public.growth_tasks set stage = 'q1', updated_at = now()
 where id in ('gt-landing-page', 'gt-search-ads', 'gt-motorisation');
update public.growth_tasks set stage = 'q2', updated_at = now()
 where id in ('gt-trade-list', 'gt-trade-coffee');
update public.growth_tasks set stage = 'q3', updated_at = now()
 where id = 'gt-organic-pages';

update public.growth_tasks set sort = 30, updated_at = now() where id = 'gt-motorisation';
update public.growth_tasks set sort = 40, updated_at = now() where id = 'gt-suburb-batching';
update public.growth_tasks set sort = 50, updated_at = now() where id = 'gt-measure-fee';

-- With the book dropped, paid search carries the entire new-lead load. A
-- single-channel plan needs a number to be judged against and a kill switch.
insert into public.growth_tasks (id, stage, sort, title, impact, detail) values
  ('gt-ad-discipline', 'q1', 25,
   'Judge the ads on cost per booked measure, and review monthly',
   'Ads are now the only new-lead channel - it needs a kill switch',
   'Break-even is roughly $1,470 of gross profit per appointment. Under about $400 per BOOKED MEASURE is comfortably profitable, $400-900 is worth tuning, and past $900 the campaign is buying work you would rather not have. Track cost per booked measure, never cost per click or per enquiry - clicks are not the thing you are buying. This only works if lead source is captured on phone enquiries, which is the fifth item on the Do now list.')
on conflict (id) do nothing;

-- ── Revision 2026-11-03b: drop the motorisation retrofit push ───────────────
--
-- The retrofit angle was always half a re-engagement play - it was pitched as
-- "a natural second sale into the existing book" - and the book was dropped
-- earlier the same day, so the offer lost the audience that justified it.
--
-- Scope of this change: it removes the retrofit CAMPAIGN, not the product.
-- "motorised blinds" (volume 2,400, difficulty 12) and "electric blinds"
-- (1,900, difficulty 14) stay in the paid keyword set, because those are
-- ordinary commercial product terms for new customers buying new motorised
-- blinds, which is a different purchase from retrofitting someone's existing
-- ones. gt-search-ads is therefore left untouched.

update public.growth_tasks
   set deleted_at = now(),
       notes = 'Dropped 2026-11-03. The retrofit angle was always half a re-engagement play - "a natural second sale into the existing book" - and the book was dropped the same day, so the offer lost its audience. Motorised and electric blinds stay in the paid keyword set as ordinary product terms for new customers; this removes the retrofit campaign, not the product.',
       updated_at = now()
 where id = 'gt-motorisation';
