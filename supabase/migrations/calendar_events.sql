-- ============================================================
-- Lusso CRM — Calendar Events
-- Run in: Supabase Dashboard > SQL Editor
-- Safe to re-run (IF NOT EXISTS / IF EXISTS throughout)
-- ============================================================

-- 1. Create calendar_events table
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id               text        PRIMARY KEY,
  title            text        NOT NULL DEFAULT '',
  event_type       text        NOT NULL DEFAULT 'other'
                   CHECK (event_type IN ('install','consult','measure','check_measure','service','other')),
  customer_id      text,
  job_id           text,
  quote_id         text,
  measure_sheet_id text,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz,
  all_day          boolean     NOT NULL DEFAULT false,
  location         text        NOT NULL DEFAULT '',
  notes            text        NOT NULL DEFAULT '',
  status           text        NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','completed','cancelled','rescheduled')),
  assigned_to      text,
  assignees        text[]      DEFAULT '{}',
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  is_deleted       boolean     NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text
);

-- 2. Enable Row Level Security
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
-- Account Managers can do everything
DROP POLICY IF EXISTS "cal_events_am_all"      ON public.calendar_events;
DROP POLICY IF EXISTS "cal_events_own_select"  ON public.calendar_events;
DROP POLICY IF EXISTS "cal_events_own_insert"  ON public.calendar_events;
DROP POLICY IF EXISTS "cal_events_own_update"  ON public.calendar_events;

CREATE POLICY "cal_events_am_all" ON public.calendar_events
  FOR ALL
  USING (
    (SELECT account_type FROM public.profiles WHERE id = auth.uid()) = 'account_manager'
  );

-- Active standard users can view events they created or are assigned to
CREATE POLICY "cal_events_own_select" ON public.calendar_events
  FOR SELECT
  USING (
    (SELECT status FROM public.profiles WHERE id = auth.uid()) = 'active'
    AND (
      created_by = auth.uid()::text
      OR assigned_to = auth.uid()::text
      OR auth.uid()::text = ANY(assignees)
    )
  );

-- Active non-pending users can create events
CREATE POLICY "cal_events_own_insert" ON public.calendar_events
  FOR INSERT
  WITH CHECK (
    (SELECT status      FROM public.profiles WHERE id = auth.uid()) = 'active'
    AND (SELECT account_type FROM public.profiles WHERE id = auth.uid()) != 'pending_user'
  );

-- Users can update events they created; AMs handled by cal_events_am_all above
CREATE POLICY "cal_events_own_update" ON public.calendar_events
  FOR UPDATE
  USING (
    created_by = auth.uid()::text
    AND (SELECT status FROM public.profiles WHERE id = auth.uid()) = 'active'
  );

-- 4. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
ALTER TABLE public.calendar_events REPLICA IDENTITY DEFAULT;

-- ============================================================
-- Verification
-- ============================================================
-- SELECT id, title, event_type, start_at, status FROM public.calendar_events LIMIT 10;
-- SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'calendar_events';
