-- Stop a stale browser copy from undoing a customer's decision.
--
-- Saving a quote pushes the whole row (src/store/db.js upsert()), unconditionally
-- and with no newer-wins check. So an ordinary staff edit carries a `status`
-- field too — whatever that browser last pulled. If the customer accepted in
-- between, that stale 'Sent' lands on top of the acceptance and the job is
-- quietly un-sold: status back to Sent, accepted_at back to null, the
-- customer's chosen optionals wiped.
--
-- This is the same failure that reset first_opened_at and produced duplicate
-- "opened for the first time" pushes. There it was fixable by excluding the
-- columns from writes, because only the server ever set them. Status is
-- different: staff legitimately send, accept, decline, take offline and
-- unaccept, so it cannot simply be made read-only.
--
-- `updated_at` cannot separate the two — it moves on every edit, not just on a
-- status decision. `status_changed_at` can, used as a VERSION MARKER rather
-- than a clock reading:
--
--   * Nothing in the app ever sets it. It is read from the server and written
--     back untouched, so what a writer sends is a statement of which lifecycle
--     it was looking at when it built the row.
--   * A writer whose marker still matches the stored one has a current view,
--     so its status is honoured — and this trigger stamps the new marker.
--   * A writer whose marker has moved on underneath it is working from a view
--     that predates something, so its lifecycle fields are dropped.
--
-- Deliberately NOT a timestamp comparison. A stamp minted by the browser would
-- make a laptop whose clock runs two minutes slow look permanently stale, and
-- its genuine Unaccept clicks would vanish with no error. Comparing what the
-- writer believed against what is stored needs no synchronised clocks at all.
--
-- The guard PRESERVES rather than REJECTS: the rest of a stale writer's edit
-- still lands. Losing someone's line-item work to protect a status field would
-- just be a different kind of data loss.
--
-- No client change is needed, and none should be added: the column round-trips
-- through toDb/fromDb already, and any value the client invents breaks it.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz DEFAULT clock_timestamp();

-- Existing rows: date the current status as well as we can, so the first
-- comparison is against something real rather than NULL.
UPDATE public.quotes
   SET status_changed_at = COALESCE(accepted_at, sent_at, updated_at, created_at, clock_timestamp())
 WHERE status_changed_at IS NULL;

CREATE OR REPLACE FUNCTION public.quotes_guard_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Writer's view of the lifecycle is current: honour whatever it decided, and
  -- move the marker on ourselves so every other copy out there goes stale.
  -- IS NOT DISTINCT FROM so a writer that simply omits the column (an insert
  -- replayed as an upsert, an older build) counts as current rather than stale.
  IF NEW.status_changed_at IS NOT DISTINCT FROM OLD.status_changed_at THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- clock_timestamp(), not now(): now() is fixed for the whole
      -- transaction, so two lifecycle writes inside one would mint the
      -- same marker and the second would not invalidate the first.
      NEW.status_changed_at := clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  -- Writer is holding a different view of the lifecycle than the one on record.
  -- Keep what is stored; let every other column in this write through untouched.
  NEW.status                 := OLD.status;
  NEW.status_changed_at      := OLD.status_changed_at;
  NEW.accepted_at            := OLD.accepted_at;
  NEW.sent_at                := OLD.sent_at;
  NEW.decline_reason         := OLD.decline_reason;
  NEW.selected_line_item_ids := OLD.selected_line_item_ids;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS quotes_guard_lifecycle ON public.quotes;
CREATE TRIGGER quotes_guard_lifecycle
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_guard_lifecycle();

-- track_quote_event needs no change and must not get one: it leaves
-- status_changed_at alone, so its own accept/decline reads as a current writer
-- and this trigger stamps the marker for it. quote_recompute_totals likewise
-- never touches the lifecycle, and runs inside that same transaction where the
-- stored row already holds the accepted values.
