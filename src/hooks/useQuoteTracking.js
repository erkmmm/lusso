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
 * The RPC runs with SECURITY DEFINER so it works with the public anon key —
 * no Supabase auth is required for the customer.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useQuoteTracking(quoteId, isFirstOpen) {
  const heartbeatRef = useRef(null);

  const call = useCallback((eventType, metadata = {}) => {
    if (!supabase || !quoteId) return Promise.resolve();
    return supabase.rpc('track_quote_event', {
      p_quote_id:   quoteId,
      p_event_type: eventType,
      p_metadata:   metadata,
    }).then(({ error }) => {
      if (error) console.warn('[quote-tracking]', eventType, error.message);
    });
  }, [quoteId]);

  useEffect(() => {
    if (!supabase || !quoteId) return;

    // Record open event immediately
    call(isFirstOpen ? 'quote_first_opened' : 'quote_viewed');

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
  }, [quoteId, isFirstOpen, call]);

  const trackAccept = useCallback((name, email) =>
    call('quote_accepted', { name, email }),
  [call]);

  const trackDecline = useCallback((reason) =>
    call('quote_declined', { reason: reason || '' }),
  [call]);

  return { trackAccept, trackDecline };
}
