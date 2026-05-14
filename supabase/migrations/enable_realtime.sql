-- ============================================================
-- Lusso CRM — Enable Supabase Realtime on key tables
-- Run this in: Supabase Dashboard > SQL Editor
--
-- Required for cross-device automatic updates.
-- Adds tables to the supabase_realtime publication so that
-- postgres_changes events are broadcast to connected clients.
--
-- Safe to re-run — ADD TABLE is idempotent in PostgreSQL.
-- ============================================================

-- 1. Add core business tables to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.customers,
  public.jobs,
  public.measure_sheets,
  public.quotes,
  public.installers,
  public.installations,
  public.staff,
  public.product_types,
  public.priced_items,
  public.priced_item_batches,
  public.contact_import_batches,
  public.notifications;

-- 2. Make sure DELETE events carry the row id by confirming
--    replica identity is set (DEFAULT includes primary key).
--    This allows the app to remove records on DELETE events.
ALTER TABLE public.customers         REPLICA IDENTITY DEFAULT;
ALTER TABLE public.jobs              REPLICA IDENTITY DEFAULT;
ALTER TABLE public.measure_sheets    REPLICA IDENTITY DEFAULT;
ALTER TABLE public.quotes            REPLICA IDENTITY DEFAULT;
ALTER TABLE public.installers        REPLICA IDENTITY DEFAULT;
ALTER TABLE public.installations     REPLICA IDENTITY DEFAULT;
ALTER TABLE public.staff             REPLICA IDENTITY DEFAULT;
ALTER TABLE public.product_types     REPLICA IDENTITY DEFAULT;
ALTER TABLE public.priced_items      REPLICA IDENTITY DEFAULT;
ALTER TABLE public.notifications     REPLICA IDENTITY DEFAULT;

-- ============================================================
-- Verification — run after migration to confirm
-- ============================================================
-- SELECT schemaname, tablename
--   FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime'
--   ORDER BY tablename;
