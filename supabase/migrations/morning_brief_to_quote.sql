-- Count "measured, nothing sent yet" in the 7am brief too.
--
-- Today.jsx opens by promising that every section it shows is the same rule
-- this function counts, so the number in the push, the number on the page and
-- the list you land on can never disagree. Adding the section without adding
-- the count here would break exactly that.
--
-- Keyed on whether a quote was actually SENT rather than whether one exists: a
-- draft sitting half-built in the builder is the case most worth chasing, so
-- it stays counted. Patched in place from the stored source, with guards that
-- turn a missed substitution into a loud failure rather than a silent no-op.

DO $do$
DECLARE
  src  text;
  orig text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'notify_morning_brief';
  IF src IS NULL THEN RAISE EXCEPTION 'notify_morning_brief not found'; END IF;

  orig := src;
  src := replace(src,
    '  v_invoice  int; v_ordering int; v_reviews int; v_chase int;',
    '  v_invoice  int; v_ordering int; v_reviews int; v_chase int; v_toquote int;');
  IF src = orig THEN RAISE EXCEPTION 'declare block not matched'; END IF;

  orig := src;
  src := replace(src,
    '  select count(*) into v_chase from public.quotes q',
    '  select count(*) into v_toquote from public.jobs j
   where j.deleted_at is null and j.status in (''Measured'',''Quote Required'')
     and not exists (
       select 1 from public.quotes q
        where q.job_id = j.id and q.deleted_at is null
          and (q.sent_at is not null
               or q.status in (''Sent'',''Viewed'',''Accepted'',''Declined'',''Completed''))
     );

  select count(*) into v_chase from public.quotes q');
  IF src = orig THEN RAISE EXCEPTION 'chase count not matched'; END IF;

  orig := src;
  src := replace(src,
    '  if v_chase    > 0 then v_parts := v_parts ||',
    '  if v_toquote  > 0 then v_parts := v_parts || (v_toquote || '' to quote''); end if;
  if v_chase    > 0 then v_parts := v_parts ||');
  IF src = orig THEN RAISE EXCEPTION 'message assembly not matched'; END IF;

  EXECUTE src;
END
$do$;
