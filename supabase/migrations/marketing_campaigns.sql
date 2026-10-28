-- Email marketing, part 2 of 2: campaigns and the send log.
--
-- The send log is the important half. Its unique index is what makes a wave
-- safe to re-run: a crash halfway through a batch, or a nervous second click,
-- cannot mail the same person twice. Waves exist because the repair demand a
-- campaign generates has to arrive at the rate the install diary can absorb,
-- not all in week one.

create table if not exists public.marketing_campaigns (
  id          text primary key,
  name        text not null,
  -- Which segment of customer_marketing_profile this mails, plus any extra
  -- narrowing. Keys the sender understands: is_trade, has_motorised,
  -- has_battery, min_blind_count, min_lifetime_value, product_family.
  segment     text not null check (segment in ('A','B','C','D','E','F')),
  audience    jsonb not null default '{}'::jsonb,

  subject     text not null,
  preheader   text,
  eyebrow     text,
  heading     text,
  body        text not null,
  cta_label   text,
  cta_url     text,
  outro       text,
  sign_off    text not null default 'The Lusso Team',

  -- Recipients per wave. Sized to how many service calls the diary can take in
  -- a week, NOT to how fast Resend can send.
  wave_size   int not null default 50 check (wave_size between 1 and 500),
  status      text not null default 'draft' check (status in ('draft','sending','paused','done')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.marketing_campaigns is
  'Campaign definitions. body/subject/etc. carry {{merge_field}} and {{field|fallback}} tokens resolved per recipient from customer_marketing_profile.';
comment on column public.marketing_campaigns.wave_size is
  'Recipients per send. Deliberately a capacity number, not a throughput number — this is the throttle on inbound repair requests.';

alter table public.marketing_campaigns enable row level security;

drop policy if exists marketing_campaigns_select on public.marketing_campaigns;
create policy marketing_campaigns_select on public.marketing_campaigns
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists marketing_campaigns_write on public.marketing_campaigns;
create policy marketing_campaigns_write on public.marketing_campaigns
  for all to authenticated
  using ((select public.is_account_manager()))
  with check ((select public.is_account_manager()));


create table if not exists public.marketing_sends (
  id           bigint generated always as identity primary key,
  campaign_id  text not null references public.marketing_campaigns(id) on delete cascade,
  customer_id  text references public.customers(id) on delete set null,
  email        text not null,
  wave         int  not null default 1,
  status       text not null default 'queued'
                 check (status in ('queued','sent','failed','bounced','replied','unsubscribed')),
  external_id  text,
  error        text,
  sent_at      timestamptz,
  replied_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- One send per address per campaign, enforced by the database rather than by
-- the sender remembering. This is the only thing standing between a retried
-- wave and a customer getting the same email twice.
create unique index if not exists marketing_sends_once_idx
  on public.marketing_sends (campaign_id, lower(email));

create index if not exists marketing_sends_campaign_idx
  on public.marketing_sends (campaign_id, wave, status);

create index if not exists marketing_sends_external_idx
  on public.marketing_sends (external_id) where external_id is not null;

comment on table public.marketing_sends is
  'One row per recipient per campaign. The unique index on (campaign_id, lower(email)) makes a wave safe to re-run.';

alter table public.marketing_sends enable row level security;

drop policy if exists marketing_sends_select on public.marketing_sends;
create policy marketing_sends_select on public.marketing_sends
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists marketing_sends_write on public.marketing_sends;
create policy marketing_sends_write on public.marketing_sends
  for all to authenticated
  using ((select public.is_account_manager()))
  with check ((select public.is_account_manager()));


-- The audience for a campaign, minus anyone already sent or suppressed.
-- One place that resolves audience JSON into rows, so the sender, the preview
-- in the UI and the "how many are left" count can never disagree.
create or replace function public.marketing_audience(p_campaign_id text, p_limit int default null)
returns setof public.customer_marketing_profile
language sql stable security invoker as $fn$
  select p.*
  from public.marketing_campaigns c
  join public.customer_marketing_profile p
    on p.segment = c.segment
   and p.emailable
   and (c.audience ->> 'is_trade'          is null or p.is_trade      = (c.audience ->> 'is_trade')::boolean)
   and (c.audience ->> 'has_motorised'     is null or p.has_motorised = (c.audience ->> 'has_motorised')::boolean)
   and (c.audience ->> 'has_battery'       is null or p.has_battery   = (c.audience ->> 'has_battery')::boolean)
   and (c.audience ->> 'min_blind_count'   is null or p.blind_count   >= (c.audience ->> 'min_blind_count')::int)
   and (c.audience ->> 'min_lifetime_value' is null or p.lifetime_value >= (c.audience ->> 'min_lifetime_value')::numeric)
   and (c.audience ->> 'product_family'    is null or (c.audience ->> 'product_family') = any(p.product_families))
  where c.id = p_campaign_id
    and not exists (
      select 1 from public.marketing_sends s
      where s.campaign_id = c.id and lower(s.email) = p.email
    )
  -- Highest-value, longest-neglected first: if a campaign is ever stopped
  -- part-way, the waves that did go out were the ones most worth sending.
  order by p.lifetime_value desc nulls last, p.last_purchase_at asc nulls last
  limit p_limit;
$fn$;

comment on function public.marketing_audience is
  'Resolves a campaign''s audience JSON into the recipients not yet mailed. Used by the sender and by the UI preview so the two always agree.';

alter function public.marketing_audience(text, int) set search_path = public;
