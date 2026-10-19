-- A to-do reminder should open the thing the to-do is about.
--
-- Both push paths used to resolve their link as:
--     case when job_id is not null then '/jobs/'||job_id else '/notes' end
--
-- which sent EVERY note without a job to a global notes list — including notes
-- written against a measure sheet, which is most of them. Tapping "⏰ To-do due
-- today" for a note about a measure sheet handed you a list of everything ever
-- noted and left you to find it again.
--
-- The global notes page has now been removed (a note belongs to the measure
-- sheet or job it is about, and is read there), so that fallback is also a dead
-- link. Resolve to the actual record instead, most specific first, and keep
-- '/today' as the last resort — it lists what is due, so it is never a 404.
--
-- Declared once here rather than inline in both functions because the two have
-- already drifted apart once.
create or replace function public.task_link(
  p_job_id text, p_measure_sheet_id text, p_customer_id text
) returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_job_id           is not null then '/jobs/'           || p_job_id
    when p_measure_sheet_id is not null then '/measure-sheets/' || p_measure_sheet_id
    when p_customer_id      is not null then '/customers/'      || p_customer_id
    else '/today'
  end;
$$;

-- ── Daily due sweep ─────────────────────────────────────────────────────────
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
       and coalesce(t.status,'') not in ('completed','cancelled','Completed','Done','Cancelled')
       and t.due_date is not null
       and t.due_date <= (now() at time zone 'Australia/Brisbane')::date
  ), ins as (
    insert into public.notifications(id, type, title, message, job_id, link, is_read, created_at, dedupe_key)
    select gen_random_uuid()::text,
           'task_due',
           case when due.due_date < (now() at time zone 'Australia/Brisbane')::date
                then '⏰ To-do overdue' else '⏰ To-do due today' end,
           coalesce(due.title,'A to-do') || ' · due ' || to_char(due.due_date,'DD Mon'),
           due.job_id,
           public.task_link(due.job_id, due.measure_sheet_id, due.customer_id),
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

-- ── Assignment push ─────────────────────────────────────────────────────────
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
    '📋 Assigned to you',
    coalesce(new.title,'A to-do') || ' → ' || coalesce(v_who,'someone')
      || coalesce(' · due ' || to_char(new.due_date,'DD Mon'), ''),
    new.job_id,
    public.task_link(new.job_id, new.measure_sheet_id, new.customer_id),
    false, now(),
    'task_assigned:'||new.id||':'||new.assigned_to::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

-- No backfill: at the time of writing no notifications row carries '/notes'.
