-- Name the lead in an inbound-reply notification.
--
-- communications_notify_inbound() read the sender's name from `customers`
-- only. A website lead has no customer record — that is the whole point of a
-- lead — so a reply from one announced itself as
-- "cdickson@themoretongroup.com.au: ..." where every other reply says
-- "Cameron Dickson: ...". The name is on web_enquiries, which the row already
-- points at via enquiry_id.
--
-- Order matters: customer first, because a lead who has since been converted
-- carries both ids and the customer record is the better name by then.
-- from_address stays as the last resort for genuinely unmatched mail.

create or replace function public.communications_notify_inbound()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer text;
  v_snippet  text;
begin
  if new.direction <> 'inbound' then return null; end if;

  select nullif(btrim(name), '') into v_customer
    from public.customers where id = new.customer_id;

  if v_customer is null and new.enquiry_id is not null then
    select nullif(btrim(name), '') into v_customer
      from public.web_enquiries where id = new.enquiry_id;
  end if;

  v_snippet := regexp_replace(coalesce(nullif(new.subject,''), new.body, ''), '\s+', ' ', 'g');
  if length(v_snippet) > 140 then v_snippet := left(v_snippet, 137) || '…'; end if;

  insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
  values (
    gen_random_uuid()::text,
    'comm_inbound',
    case when new.channel = 'sms' then '💬 New SMS reply' else '📥 New email reply' end,
    coalesce(v_customer, new.from_address, 'Someone') || ': ' || coalesce(nullif(v_snippet,''), '(no content)'),
    new.job_id,
    case when new.job_id is not null then '/jobs/'||new.job_id else '/inbox' end,
    false, now(),
    'comm:'||new.id::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;
