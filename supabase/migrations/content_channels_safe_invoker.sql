-- ============================================================
-- Lusso CRM — content_channels_safe: definer view → invoker view
-- Applied to prod 2026-09-04 as migration harden_content_channels_safe_view
-- ============================================================
-- content_channels_safe existed to hide content_channels.access_token, but it
-- ran as its owner (postgres), so RLS on the base table never applied through
-- it. The view is auto-updatable and `authenticated` held INSERT/UPDATE/DELETE
-- on it, which meant any signed-in user could write to content_channels as the
-- owner and skip the is_account_manager() policies entirely.

-- 1. RLS now governs the read, so the table needs a SELECT policy.
--    (It previously had none — the definer view was the only read path.)
DROP POLICY IF EXISTS content_channels_select ON public.content_channels;
CREATE POLICY content_channels_select ON public.content_channels
  FOR SELECT TO authenticated
  USING ((SELECT public.is_account_manager()));

-- 2. access_token stays unreachable: column-level SELECT, token excluded.
REVOKE SELECT ON public.content_channels FROM anon, authenticated;
GRANT SELECT (id, channel, page_id, ig_user_id, display_name,
              expires_at, connected_by, connected_at, last_error)
  ON public.content_channels TO authenticated;

-- 3. The view runs as the caller.
ALTER VIEW public.content_channels_safe SET (security_invoker = on);

-- 4. The view is a read path, not a write path.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.content_channels_safe FROM anon, authenticated;

-- 5. anon has no business on either object.
REVOKE ALL ON public.content_channels      FROM anon;
REVOKE ALL ON public.content_channels_safe FROM anon;

-- PostgREST caches the schema; without this the new grants are not picked up.
NOTIFY pgrst, 'reload schema';
