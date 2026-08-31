-- Quote open tracking: one notification per genuine open.
--
-- Opening the demo quote twice produced THREE "opened for the first time"
-- pushes, and a repeat visit produced none at all. Three separate faults:
--
--  1. The first-open claim was read-then-write with no lock, so two opens
--     milliseconds apart (a second tab, or one effect firing twice) both saw
--     first_opened_at IS NULL and both announced a first open.
--  2. Coming back later was silent. The event was logged as `quote_viewed`
--     but no notification was ever built for it, so nobody heard that the
--     customer had returned — which is the more interesting signal of the two.
--  3. `quote_viewed` — which is what the browser sends whenever its own copy
--     says the quote was already opened — updated nothing at all: no view
--     count, no last_viewed_at, no notification.
--
-- The row is now the only thing that decides which kind of open this is. The
-- caller's event name is a hint, not the answer.
--
-- (The third cause of the duplicate pushes was client-side: the app pushed its
-- stale copy of first_opened_at / view_count back over this row, so the next
-- open looked new again. Fixed in src/store/db.js by making those columns
-- server-owned — see EXCLUDE_COLUMNS.quotes.)

CREATE OR REPLACE FUNCTION public.track_quote_event(p_quote_id text, p_event_type text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      v_quote         quotes%ROWTYPE;
      v_cust_name     text;
      v_is_open       boolean := false;
      v_is_first_open boolean := false;
      v_is_reopen     boolean := false;
      v_first_at      timestamptz;
      v_prev_viewed   timestamptz;
      v_views         integer;
      v_notif_title   text;
      v_notif_msg     text;
      v_log_type      text;
      v_selected      jsonb;
      -- How long the customer has to have been away before coming back counts
      -- as "looked at it again" rather than a refresh, a restored tab or a
      -- second device. Without this every reload would push the team.
      c_reopen_gap    constant interval := interval '30 minutes';
    BEGIN
      SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
      IF NOT FOUND THEN RETURN '{"ok":false,"error":"not_found"}'; END IF;

      SELECT COALESCE(name,'Customer') INTO v_cust_name
        FROM public.customers WHERE id = v_quote.customer_id;
      v_cust_name := COALESCE(v_cust_name, p_metadata->>'name', 'Customer');

      -- An open is an open however the caller labelled it. The browser guesses
      -- from its own copy of the quote, which on a customer's phone is often
      -- absent and on a staff machine is often stale.
      v_is_open := p_event_type IN ('quote_first_opened', 'quote_viewed');

      IF v_is_open THEN
        -- FOR UPDATE is what makes "is this the first open?" a decision rather
        -- than a guess: concurrent opens queue here instead of all reading NULL.
        SELECT first_opened_at, last_viewed_at
          INTO v_first_at, v_prev_viewed
          FROM public.quotes WHERE id = p_quote_id FOR UPDATE;

        v_is_first_open := (v_first_at IS NULL);
        v_is_reopen     := NOT v_is_first_open
                           AND (v_prev_viewed IS NULL OR v_prev_viewed < now() - c_reopen_gap);

        UPDATE public.quotes SET
          first_opened_at = COALESCE(first_opened_at, now()),
          last_viewed_at  = now(),
          view_count      = COALESCE(view_count,0) + 1,
          customer_last_seen_at = now(),
          status = CASE WHEN status='Sent' THEN 'Viewed' ELSE status END
        WHERE id = p_quote_id
        RETURNING view_count INTO v_views;
      END IF;

      v_log_type := CASE WHEN v_is_open AND v_is_first_open THEN 'quote_first_opened'
                         WHEN v_is_open                     THEN 'quote_viewed'
                         ELSE p_event_type END;

      IF p_event_type != 'quote_live_heartbeat' THEN
        INSERT INTO public.quote_activity_events(id,quote_id,customer_id,job_id,event_type,metadata)
        VALUES(gen_random_uuid()::text, p_quote_id, v_quote.customer_id, v_quote.job_id, v_log_type, p_metadata);
      END IF;

      IF p_event_type = 'quote_live_heartbeat' THEN
        UPDATE public.quotes SET customer_last_seen_at = now() WHERE id = p_quote_id;
      ELSIF p_event_type = 'quote_accepted' THEN
        -- Persist which optional / multiple-choice items the customer ticked.
        -- Only ids that genuinely belong to this quote's optional lines are
        -- accepted: this RPC is reachable with the public anon key, so the
        -- payload is treated as untrusted input, not as gospel.
        IF p_metadata ? 'selectedLineItemIds' THEN
          SELECT COALESCE(jsonb_agg(li->>'id'), '[]'::jsonb)
            INTO v_selected
            FROM jsonb_array_elements(v_quote.line_items) li
           WHERE li->>'type' IN ('Optional','Multiple Choice')
             AND COALESCE(p_metadata->'selectedLineItemIds', '[]'::jsonb) ? (li->>'id');
        ELSE
          -- Caller didn't send selections: keep whatever is already stored.
          v_selected := v_quote.selected_line_item_ids;
        END IF;

        UPDATE public.quotes SET
          status='Accepted',
          accepted_at=now(),
          customer_last_seen_at=now(),
          selected_line_item_ids = v_selected
        WHERE id = p_quote_id;

        -- Totals must include the add-ons just accepted, and the job has to move
        -- on. Both used to happen only in the browser's localStorage copy, which
        -- the customer's device doesn't have.
        PERFORM public.quote_recompute_totals(p_quote_id);
        PERFORM public.job_advance_status(v_quote.job_id, 'Approved');
      ELSIF p_event_type = 'quote_declined' THEN
        UPDATE public.quotes SET
          status='Declined',
          decline_reason=COALESCE(p_metadata->>'reason',''),
          customer_last_seen_at=now()
        WHERE id = p_quote_id;
      END IF;

      IF v_is_first_open THEN
        v_notif_title := '👁️ Quote Opened';
        v_notif_msg   := v_cust_name||' opened '||v_quote.quote_number||' for the first time';
      ELSIF v_is_reopen THEN
        v_notif_title := '👀 Quote Reopened';
        v_notif_msg   := v_cust_name||' is looking at '||v_quote.quote_number
          ||' again — '||v_views||' views now';
      ELSIF p_event_type = 'quote_accepted' THEN
        v_notif_title := '✅ Quote Accepted';
        v_notif_msg   := v_cust_name||' accepted '||v_quote.quote_number;
      ELSIF p_event_type = 'quote_declined' THEN
        v_notif_title := '❌ Quote Declined';
        v_notif_msg   := v_cust_name||' declined '||v_quote.quote_number
          ||CASE WHEN length(COALESCE(p_metadata->>'reason',''))>0 THEN ': '||(p_metadata->>'reason') ELSE '' END;
      END IF;

      IF v_notif_title IS NOT NULL THEN
        INSERT INTO public.notifications(id,type,title,message,job_id,is_read,created_at)
        VALUES(gen_random_uuid()::text, v_log_type, v_notif_title, v_notif_msg,
               v_quote.job_id, false, now());
      END IF;

      -- Email active account managers on the key events (fire-and-forget; wrapped
      -- so a failure can never break quote tracking). Includes the shared token.
      -- A reopen deliberately stays a push/in-app notification only — worth a
      -- glance at your phone, not worth an email each time.
      IF v_is_first_open OR p_event_type IN ('quote_accepted','quote_declined') THEN
        BEGIN
          PERFORM net.http_post(
            url     := 'https://wwompnqglvdxcmjquuzr.supabase.co/functions/v1/quote-notify',
            headers := jsonb_build_object('Content-Type','application/json'),
            body    := jsonb_build_object(
              'quoteId', p_quote_id, 'eventType', p_event_type, 'meta', p_metadata,
              'token', (SELECT token FROM public.internal_notify_config WHERE id = 1)
            )
          );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;

      RETURN jsonb_build_object('ok',true,'first_open',v_is_first_open,
                                'reopened',v_is_reopen,'views',v_views,'event',v_log_type);
    END; $function$;
