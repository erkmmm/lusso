-- One call behind the Email Marketing page.
--
-- Deliberately a single RPC rather than a handful of selects from the UI: the
-- segment counts and the per-campaign progress have to agree with each other
-- and with what the sender will actually do, and the cheapest way to guarantee
-- that is to compute them in one place from marketing_audience().
--
-- Reading the whole profile view client-side would also mean shipping ~2,000
-- customer rows to the browser to render six numbers.

create or replace function public.marketing_dashboard()
returns jsonb language sql stable security invoker as $fn$
  select jsonb_build_object(
    'segments', (
      select coalesce(jsonb_agg(s order by s ->> 'segment'), '[]'::jsonb) from (
        select jsonb_build_object(
          'segment',   segment,
          'total',     count(*),
          'emailable', count(*) filter (where emailable),
          'retail',    count(*) filter (where emailable and not is_trade),
          'trade',     count(*) filter (where emailable and is_trade),
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
          'status',    mc.status,
          'wave_size', mc.wave_size,
          'subject',   mc.subject,
          'notes',     mc.notes,
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
    'suppressed', (select count(*) from public.marketing_suppressions),
    'suppressed_by_reason', (
      select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
      from (select reason, count(*) n from public.marketing_suppressions group by 1) z
    )
  );
$fn$;

comment on function public.marketing_dashboard is
  'Segment counts, per-campaign progress and suppression totals in one call. Progress comes from marketing_audience() so the page and the sender can never disagree.';

grant execute on function public.marketing_dashboard() to authenticated;

alter function public.marketing_dashboard() set search_path = public;
