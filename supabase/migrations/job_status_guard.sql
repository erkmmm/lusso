-- Stop a stale browser copy from undoing a job's stage.
--
-- The same fault quote_status_guard.sql fixes for quotes, on the other half of
-- the same event. Accepting a quote runs track_quote_event, which calls
-- job_advance_status(job_id,'Approved') — so jobs.status is written server-side
-- by the customer's action, exactly like quotes.status.
--
-- Every staff save pushes the whole row (src/store/db.js upsert()), so an
-- ordinary job edit carries whatever `status` that browser last pulled. Once
-- the guard on quotes is in place the quote correctly stays Accepted, and the
-- linked job quietly falls back to Quoted — the sale survives, the work that
-- follows from it does not.
--
-- Neither client nor server forward-only rule catches this. advanceJobStatus()
-- compares against the stale localStorage value, and job_advance_status()
-- compares against the stored one but is never the writer here — the plain
-- upsert is.
--
-- Same version-marker convention as quotes, deliberately: `status_changed_at`
-- is opaque to the client, which reads it and hands it back untouched. A writer
-- holding the current marker has a current view and is honoured; a writer
-- holding a different one is working from a stage that has since moved on.
--
-- job_advance_status needs no change. It never touches status_changed_at, so it
-- lands in the honoured branch and the trigger mints the new marker for it.

-- Added without a default first, so the backfill below actually runs: adding it
-- WITH `DEFAULT now()` would stamp every existing row with the migration's own
-- run time and leave nothing for the backfill to do.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

-- Existing rows: date the current stage as well as we can, so the first
-- comparison is against something real rather than NULL.
UPDATE public.jobs
   SET status_changed_at = COALESCE(updated_at, created_at, now())
 WHERE status_changed_at IS NULL;

-- New rows get one from here on.
ALTER TABLE public.jobs
  ALTER COLUMN status_changed_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.jobs_guard_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Writer's view of the stage is current: honour whatever it decided, and move
  -- the marker on ourselves so every other copy out there goes stale.
  -- IS NOT DISTINCT FROM so a writer that simply omits the column (an insert
  -- replayed as an upsert, an older build) counts as current rather than stale.
  IF NEW.status_changed_at IS NOT DISTINCT FROM OLD.status_changed_at THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- clock_timestamp(), not now(): now() is fixed for the whole transaction,
      -- so two stage writes inside one would mint the same marker and the
      -- second would not invalidate the first.
      NEW.status_changed_at := clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  -- Writer is holding a different view of the stage than the one on record.
  -- Keep what is stored; let every other column in this write through untouched.
  NEW.status            := OLD.status;
  NEW.status_changed_at := OLD.status_changed_at;

  RETURN NEW;
END;
$function$;

-- Both existing triggers on jobs (audit_jobs, jobs_notify_stage) are AFTER, so
-- they see the guarded row and there is no ordering to arrange.
DROP TRIGGER IF EXISTS jobs_guard_lifecycle ON public.jobs;
CREATE TRIGGER jobs_guard_lifecycle
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_guard_lifecycle();
