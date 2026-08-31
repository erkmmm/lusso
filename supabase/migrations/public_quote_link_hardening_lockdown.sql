-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 of the public-quote hardening: close the legacy, tokenless doors.
--
-- RUN THIS ONLY AFTER THE FRONTEND IS DEPLOYED. Until the new bundle is live,
-- customer quote pages still call the 1-arg get_public_quote and the 3-arg
-- track_quote_event; revoking those first would 404 every live quote link.
--
-- After this runs, anon can reach the public quote surface only by presenting
-- the quote's public_token, so walking the (sequential) id space gets nothing.
-- The 4-arg track_quote_event still calls the 3-arg body internally — that
-- works because it is SECURITY DEFINER and runs as the owner, not as anon.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.get_public_quote(text)             from anon, authenticated, public;
revoke execute on function public.track_quote_event(text, text, jsonb) from anon, authenticated, public;
