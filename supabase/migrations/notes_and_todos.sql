-- ── Notes & to-dos ───────────────────────────────────────────────────────────
--
-- The `tasks` table has existed since the first schema but nothing ever wrote
-- to it: there was no UI, and the two vocabularies never agreed. The app's
-- seed data used 'To Do' / 'Medium' while the CHECK constraints here only
-- allow 'pending' / 'normal', so the very first task a user created would have
-- been rejected on push and lived on in one browser's localStorage forever.
--
-- This migration makes the table the home of BOTH halves of field capture:
--   kind='note' — something worth remembering (no due date, never chased)
--   kind='todo' — the same record once it has a date and needs doing
-- A note becomes a to-do by gaining a due date; nothing is re-created, so the
-- original wording and photos survive the promotion.
--
-- The lowercase vocabulary in the CHECK constraints wins — it is what the
-- constraint has always enforced — and the app was changed to match.

alter table public.tasks
  add column if not exists kind        text        not null default 'note',
  add column if not exists photo_paths text[]      not null default '{}',
  add column if not exists author_name text;

alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add  constraint tasks_kind_check check (kind in ('note', 'todo'));

comment on column public.tasks.kind is
  'note = jotted, never chased. todo = has a due date and shows on Today.';
comment on column public.tasks.photo_paths is
  'Storage paths in the `attachments` bucket, under notes/{task_id}/. Never public URLs.';
comment on column public.tasks.author_name is
  'Display name of whoever wrote it, denormalised so the feed renders without a profiles join.';

-- The feed reads by job or by customer on every profile page open.
create index if not exists tasks_job_open_idx
  on public.tasks(job_id, created_at desc) where deleted_at is null;
create index if not exists tasks_customer_open_idx
  on public.tasks(customer_id, created_at desc) where deleted_at is null;

-- ── Due sweep: match the constraint's vocabulary ─────────────────────────────
-- This read 'Completed','Done','Cancelled' — none of which the CHECK constraint
-- permits — so a completed task with a null completed_at would have been pushed
-- as overdue every single day. Legacy capitalised values stay in the list so a
-- row written before this migration can still fall out of the sweep.
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
           case when due.job_id is not null then '/jobs/'||due.job_id else '/notes' end,
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

-- ── Assignment push: land on the note itself when there's no job ─────────────
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
    case when new.job_id is not null then '/jobs/'||new.job_id else '/notes' end,
    false, now(),
    'task_assigned:'||new.id||':'||new.assigned_to::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

-- PostgREST caches the schema: without this the three new columns are silently
-- stripped from every write and a note's photos vanish on the next hydrate.
notify pgrst, 'reload schema';

-- ── Notes captured during a measure ──────────────────────────────────────────
-- (applied separately as notes_on_measure_sheets)
--
-- A sheet being measured on site may have no job and no customer yet — both are
-- created on submit — so the sheet id is the only anchor a note has at the
-- moment it is written. jobId/customerId are back-filled onto these notes when
-- the sheet is submitted (see linkNotesToJob in src/store/data.js).
--
-- Deliberately NOT a foreign key: a note must never fail to save because its
-- measure sheet hasn't reached the server yet.
alter table public.tasks
  add column if not exists measure_sheet_id text;

create index if not exists tasks_measure_sheet_idx
  on public.tasks(measure_sheet_id, created_at desc) where deleted_at is null;

notify pgrst, 'reload schema';
