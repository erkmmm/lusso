-- Website leads → the same notifications funnel as everything else.
-- (Inbound email/SMS is already covered by communications_notify in
-- push_notifications.sql; this is the one inbox item that wasn't.)
create or replace function public.web_enquiries_notify_new()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_detail  text;
  v_snippet text;
begin
  -- Suburb + interest are what tell you whether to drop everything, so they go
  -- in the push body ahead of the message itself.
  v_detail := concat_ws(' · ',
    nullif(new.suburb, ''),
    nullif(new.interest, ''),
    nullif(new.phone, '')
  );

  v_snippet := regexp_replace(coalesce(new.message, ''), '\s+', ' ', 'g');
  if length(v_snippet) > 120 then v_snippet := left(v_snippet, 117) || '…'; end if;

  insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
  values (
    gen_random_uuid()::text,
    'web_enquiry',
    case when coalesce(new.source,'') in ('', 'website', 'web')
         then '🌐 New website lead'
         else '🌐 New lead · ' || new.source end,
    concat_ws(' — ',
      concat_ws(' · ', coalesce(nullif(new.name,''), 'Someone'), nullif(v_detail,'')),
      nullif(v_snippet, '')
    ),
    null,
    '/inbox',
    false, now(),
    'web_enquiry:' || new.id::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

drop trigger if exists web_enquiries_notify on public.web_enquiries;
create trigger web_enquiries_notify
  after insert on public.web_enquiries
  for each row execute function public.web_enquiries_notify_new();
