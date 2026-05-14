-- ============================================================
-- Lusso CRM — Installers table schema fix
-- Run this in: Supabase Dashboard > SQL Editor
-- All statements use IF NOT EXISTS / IF EXISTS so they are
-- safe to re-run at any time without errors.
-- ============================================================

-- 1. Add is_active column (the root cause of the sync error).
--    Defaults to true so existing rows stay active after migration.
ALTER TABLE public.installers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Back-fill: any existing row that is soft-deleted (deleted_at IS NOT NULL)
--    should be treated as inactive.
UPDATE public.installers
SET is_active = false
WHERE deleted_at IS NOT NULL
  AND is_active = true;

-- ============================================================
-- Verification — run after migration to confirm
-- ============================================================
-- SELECT id, name, email, is_active, deleted_at FROM public.installers ORDER BY created_at;
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'installers'
--   ORDER BY ordinal_position;
