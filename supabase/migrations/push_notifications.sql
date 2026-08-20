-- Web Push notifications ───────────────────────────────────────────────────────
-- Everything staff need to be told about already lands in public.notifications
-- (the bell in the header). This makes that table the single funnel: one AFTER
-- INSERT trigger fans every new row out to the push-send edge function, which
-- delivers it to every device that has opted in. Adding a new push event is
-- therefore just "insert a notifications row" — no new plumbing.

-- ── 1. Devices that have opted in ────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  label         text,
  created_at    timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- A subscription is a device secret: you may only ever see or touch your own.
drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists push_subs_update on public.push_subscriptions;
create policy push_subs_update on public.push_subscriptions for update using (user_id = auth.uid());
drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions for delete using (user_id = auth.uid());

-- ── 2. VAPID keys live beside the existing shared notify token ───────────────
-- Same reasoning as internal_notify_config.token: the edge function reads them
-- with the service role, no client can select this table (no policies, RLS on).
alter table public.internal_notify_config add column if not exists vapid_public  text;
alter table public.internal_notify_config add column if not exists vapid_private text;
alter table public.internal_notify_config add column if not exists vapid_subject text default 'mailto:jobs@lusso.com.au';

-- ── 3. Notifications gain a deep link + a dedupe key ─────────────────────────
alter table public.notifications add column if not exists link        text;
alter table public.notifications add column if not exists dedupe_key  text;
create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications(dedupe_key);   -- NULLs stay distinct, so unkeyed rows are unaffected

-- ── 4. The fan-out trigger ───────────────────────────────────────────────────
create or replace function public.notifications_push_fanout()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Fire-and-forget: a push failure must never break the write that caused it.
  begin
    perform net.http_post(
      url     := 'https://wwompnqglvdxcmjquuzr.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := jsonb_build_object(
        'token', (select token from public.internal_notify_config where id = 1),
        'notification', jsonb_build_object(
          'id',    new.id,
          'type',  new.type,
          'title', new.title,
          'body',  new.message,
          'link',  new.link,
          'jobId', new.job_id
        )
      )
    );
  exception when others then null;
  end;
  return null;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.notifications_push_fanout();

-- ── 5. Installer accepted / declined ─────────────────────────────────────────
-- Was only ever created client-side, in the installer's own browser, where the
-- notifications RLS insert doesn't apply to them. Doing it in the DB means the
-- office hears about it no matter who clicked the link.
create or replace function public.installations_notify_response()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_installer text;
  v_customer  text;
  v_jobno     text;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status not in ('Accepted','Declined') then return null; end if;

  select name into v_installer from public.installers where id = new.installer_id;
  select j.job_number, c.name into v_jobno, v_customer
    from public.jobs j left join public.customers c on c.id = j.customer_id
   where j.id = new.job_id;

  insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
  values (
    gen_random_uuid()::text,
    case when new.status = 'Accepted' then 'install_accepted' else 'install_declined' end,
    case when new.status = 'Accepted' then '🔧 Installation Accepted' else '⚠️ Installation Declined' end,
    coalesce(v_installer,'An installer') || ' ' || lower(new.status) || ' the installation for '
      || coalesce(v_customer,'a customer') || coalesce(' ('||v_jobno||')','')
      || coalesce(' on ' || to_char(new.scheduled_date,'DD Mon'), ''),
    new.job_id,
    case when new.job_id is not null then '/jobs/'||new.job_id else '/installations' end,
    false, now(),
    'install:'||new.id||':'||new.status
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

drop trigger if exists installations_notify on public.installations;
create trigger installations_notify
  after update of status on public.installations
  for each row execute function public.installations_notify_response();

-- ── 6. Customer replies (inbound email / SMS) ────────────────────────────────
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

  select name into v_customer from public.customers where id = new.customer_id;
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

drop trigger if exists communications_notify on public.communications;
create trigger communications_notify
  after insert on public.communications
  for each row execute function public.communications_notify_inbound();

-- ── 7. Tasks: assigned to someone, and due today ─────────────────────────────
create or replace function public.tasks_notify_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_who text;
begin
  if new.assigned_to is null then return null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return null; end if;

  select coalesce(raw_user_meta_data->>'full_name', email) into v_who
    from auth.users where id = new.assigned_to;

  insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
  values (
    gen_random_uuid()::text,
    'task_assigned',
    '📋 Task assigned',
    coalesce(new.title,'A task') || ' → ' || coalesce(v_who,'someone')
      || coalesce(' · due ' || to_char(new.due_date,'DD Mon'), ''),
    new.job_id,
    case when new.job_id is not null then '/jobs/'||new.job_id else '/' end,
    false, now(),
    'task_assigned:'||new.id||':'||new.assigned_to::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

drop trigger if exists tasks_notify_assign on public.tasks;
create trigger tasks_notify_assign
  after insert or update of assigned_to on public.tasks
  for each row execute function public.tasks_notify_assigned();

-- One row per task per due date, so the daily sweep can run as often as it likes.
create or replace function public.notify_due_tasks()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  with due as (
    select t.* from public.tasks t
     where t.deleted_at is null
       and t.completed_at is null
       and coalesce(t.status,'') not in ('Completed','Done','Cancelled')
       and t.due_date is not null
       and t.due_date <= (now() at time zone 'Australia/Brisbane')::date
  ), ins as (
    insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
    select gen_random_uuid()::text,
           'task_due',
           case when due.due_date < (now() at time zone 'Australia/Brisbane')::date
                then '⏰ Task overdue' else '⏰ Task due today' end,
           coalesce(due.title,'A task') || ' · due ' || to_char(due.due_date,'DD Mon'),
           due.job_id,
           case when due.job_id is not null then '/jobs/'||due.job_id else '/' end,
           false, now(),
           'task_due:'||due.id||':'||due.due_date::text
      from due
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

revoke all on function public.notify_due_tasks() from public, anon, authenticated;
