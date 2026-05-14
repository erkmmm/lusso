/**
 * RealtimeContext — Supabase Realtime subscriptions for cross-device sync.
 *
 * Strategy:
 *   - Subscribes to postgres_changes on all key tables once the user logs in.
 *   - On INSERT: adds the new record to localStorage (deduped by id).
 *   - On UPDATE: merges DB fields into the existing local record,
 *               preserving any app-only camelCase fields not stored in the DB.
 *   - On DELETE: removes the record from localStorage by id.
 *   - After every change: fires window 'lusso:data-changed' so every
 *     component that already listens to that event re-renders automatically.
 *   - Cleans up the channel on logout / unmount.
 *
 * No component files need changing — they already listen to
 * 'lusso:data-changed' via Layout.jsx and individual page effects.
 */

import { createContext, useContext, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fromDb } from '../store/db';
import { useAuth } from './AuthContext';

const RealtimeContext = createContext({});

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; } },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

// ── DB table → localStorage key map ──────────────────────────────────────────
const TABLE_KEY = {
  customers:              'lusso_customers',
  jobs:                   'lusso_jobs',
  measure_sheets:         'lusso_measure_sheets',
  quotes:                 'lusso_quotes',
  installers:             'lusso_installers',
  installations:          'lusso_install_requests',
  staff:                  'lusso_staff',
  product_types:          'lusso_product_types',
  priced_items:           'lusso_priced_items',
  priced_item_batches:    'lusso_priced_item_batches',
  contact_import_batches: 'lusso_import_batches',
  notifications:          'lusso_notifications',
  calendar_events:        'lusso_calendar_events',
  quote_activity_events:  'lusso_quote_activity_events',
};

const TABLES = Object.keys(TABLE_KEY);

// ── Apply a single realtime event to localStorage ─────────────────────────────
function applyChange(table, payload) {
  const key = TABLE_KEY[table];
  if (!key) return;

  const records = LS.get(key) || [];

  if (payload.eventType === 'INSERT') {
    const incoming = fromDb(payload.new);
    if (!incoming?.id) return;
    // Dedupe — our own write may already be in localStorage
    if (!records.find(r => r.id === incoming.id)) {
      LS.set(key, [...records, incoming]);
    }

  } else if (payload.eventType === 'UPDATE') {
    const incoming = fromDb(payload.new);
    if (!incoming?.id) return;
    const idx = records.findIndex(r => r.id === incoming.id);
    if (idx >= 0) {
      // Merge: DB fields from incoming, app-only fields preserved from existing.
      // App-only fields are camelCase but NOT present in payload.new (not in DB),
      // so spreading existing first, then incoming keeps them intact.
      const merged = [...records];
      merged[idx] = { ...records[idx], ...incoming };
      LS.set(key, merged);
    } else {
      // Record not local yet — add it
      LS.set(key, [...records, incoming]);
    }

  } else if (payload.eventType === 'DELETE') {
    const deletedId = payload.old?.id;
    if (!deletedId) return;
    LS.set(key, records.filter(r => r.id !== deletedId));
  }

  // Signal every listening component to re-read from localStorage
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const channelRef = useRef(null);

  useEffect(() => {
    if (!supabase || !user?.id) return;

    // Tear down any stale channel first
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`lusso-rt-${user.id}`);

    TABLES.forEach(table => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => applyChange(table, payload)
      );
    });

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.info(`[realtime] ✓ Live sync active (${TABLES.length} tables)`);
      } else if (status === 'CHANNEL_ERROR') {
        console.warn('[realtime] Channel error:', err?.message ?? status);
      } else if (status === 'TIMED_OUT') {
        console.warn('[realtime] Subscription timed out — will retry');
      }
    });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id]); // re-subscribe if user changes

  return (
    <RealtimeContext.Provider value={{}}>
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
