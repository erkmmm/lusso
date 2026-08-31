-- Give a quote notification somewhere to go.
--
-- Seven of the eight functions that create notifications set `link`.
-- track_quote_event never did, and it is the busiest of them — every quote
-- opened / accepted / declined. Both the bell (Layout handleNotifClick) and the
-- push payload (push-send) read `n.link || jobId || fallback`, so a quote
-- notification landed on the job at best, and on the rows with no job_id it was
-- a dead tap that did nothing at all — on the phone and on the desktop alike.
--
-- Patched in place from the stored source rather than retyped, so the rest of
-- the function cannot drift from what quote_status_guard.sql installed; the
-- guards turn a missed substitution into a loud failure, not a silent no-op.

DO $do$
DECLARE
  src  text;
  orig text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'track_quote_event'
     AND pg_get_function_identity_arguments(p.oid) = 'p_quote_id text, p_event_type text, p_metadata jsonb';
  IF src IS NULL THEN RAISE EXCEPTION 'track_quote_event(text,text,jsonb) not found'; END IF;
  orig := src;

  src := replace(src,
    'INSERT INTO public.notifications(id,type,title,message,job_id,is_read,created_at)',
    'INSERT INTO public.notifications(id,type,title,message,job_id,link,is_read,created_at)');
  IF src = orig THEN RAISE EXCEPTION 'notification INSERT column list not matched'; END IF;
  orig := src;

  src := replace(src,
    'v_quote.job_id, false, now());',
    'v_quote.job_id, ''/quotes/''||p_quote_id, false, now());');
  IF src = orig THEN RAISE EXCEPTION 'notification VALUES list not matched'; END IF;

  EXECUTE src;
END
$do$;

-- Backfill what is already sitting in the bell. The quote number is in the
-- message text ("… opened QT-6266 for the first time"), which is the only
-- handle these rows have on their quote — notifications store no quote_id.
-- Rows whose quote has since been deleted stay null on purpose; the client's
-- notificationLink() floor catches those.
UPDATE public.notifications n
   SET link = '/quotes/' || q.id
  FROM public.quotes q
 WHERE n.link IS NULL
   AND n.type LIKE 'quote\_%'
   AND q.quote_number IS NOT NULL
   AND position(q.quote_number in n.message) > 0;
