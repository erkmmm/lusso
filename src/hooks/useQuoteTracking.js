/**
 * useQuoteTracking — customer-side quote activity tracking.
 *
 * Call this hook inside CustomerQuotePage. It:
 *  1. Records the first open / repeat view via the `track_quote_event` RPC.
 *  2. Sends a live-presence heartbeat every 30 s while the tab is active.
 *  3. Stops the heartbeat when the tab goes to the background or unmounts.
 *
 * Returns { trackAccept, trackDecline } helpers for the accept/decline modals.
 *
 * The RPC runs with SECURITY DEFINER so it works with the public anon key — no
 * Supabase auth is required for the customer. Authority comes instead from the
 * quote's `public_token`, carried in the link as ?t=…: without it the RPC
 * refuses, so nobody can walk the (sequential) id space and accept or decline
 * quotes that aren't theirs.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useQuoteTracking(quoteId, isFirstOpen, token = '') {
  const heartbeatRef = useRef(null);
  // Which quote this mount has already announced. The open event used to fire
  // on every run of the effect below — once when the quote arrived from the
  // server, and again for React's development double-invoke — so a single
  // visit counted as several views and raced itself for "first open".
  const announcedRef = useRef(null);

  const call = useCallback((eventType, metadata = {}) => {
    // No token, no writes. This RPC accepts and declines quotes — it advances
    // the job, recomputes the totals and emails the team — and it was reachable
    // with nothing but a quote id, which are sequential.
    if (!supabase || !quoteId || !token) return Promise.resolve();
    return supabase.rpc('track_quote_event', {
      p_quote_id:   quoteId,
      p_event_type: eventType,
      p_metadata:   metadata,
      p_token:      token,
    }).then(({ error }) => {
      if (error) console.warn('[quote-tracking]', eventType, error.message);
    });
  }, [quoteId, token]);

  useEffect(() => {
    if (!supabase || !quoteId || !token) return;

    // Record open event immediately — but once per quote, not once per run.
    // Which KIND of open it is is the server's decision, not ours: this hint is
    // read off a local copy that a customer's phone doesn't have and a staff
    // machine may hold a stale version of.
    if (announcedRef.current !== quoteId) {
      announcedRef.current = quoteId;
      call(isFirstOpen ? 'quote_first_opened' : 'quote_viewed');
    }

    // Heartbeat every 30 s while tab is visible
    const startHeartbeat = () => {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (!document.hidden) call('quote_live_heartbeat');
      }, 30_000);
    };

    startHeartbeat();

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(heartbeatRef.current);
      } else {
        startHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(heartbeatRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [quoteId, isFirstOpen, token, call]);

  // The selected optional items travel with the accept event: the RPC is what
  // actually persists them (and recomputes the totals and advances the job),
  // because the customer's device has no localStorage copy of the quote for
  // acceptQuote() to update.
  const trackAccept = useCallback((name, email, selectedLineItemIds = []) =>
    call('quote_accepted', { name, email, selectedLineItemIds }),
  [call]);

  const trackDecline = useCallback((reason) =>
    call('quote_declined', { reason: reason || '' }),
  [call]);

  return { trackAccept, trackDecline };
}
