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
import { fromDb, pendingIds } from '../store/db';
import { lsGet, lsSet } from '../store/storage';
import { useAuth } from './AuthContext';

const RealtimeContext = createContext({});

// ── localStorage helpers ──────────────────────────────────────────────────────
// MUST use the shared codec (lsGet/lsSet), not raw JSON. Large tables (jobs,
// customers, quotes, priced_items) are LZ-compressed in localStorage, so a raw
// JSON.parse throws → returns [] → applyChange would then write back just the
// single incoming record, wiping every other row until the next poll restored
// them. Using the codec reads the full decompressed array and re-compresses on
// write (and mirrors to the durable IndexedDB backup).
const LS = {
  get: (key) => lsGet(key) ?? [],
  set: (key, val) => lsSet(key, val),
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
  tasks:                  'lusso_tasks',
};

const TABLES = Object.keys(TABLE_KEY);

// ── Apply a single realtime event to localStorage ─────────────────────────────
function applyChange(table, payload) {
  const key = TABLE_KEY[table];
  if (!key) return;

  const records = LS.get(key) || [];

  // Safety: an UPDATE/DELETE against an empty local table is almost always a
  // failed read (not a genuinely empty table). Applying it would write back a
  // single-record (or empty) array and drop everything else. Skip — the next
  // hydrate reconciles. (INSERT into an empty table is legitimately fine.)
  if (records.length === 0 && payload.eventType !== 'INSERT') return;

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

    // Soft-delete: treat as removal so the record disappears on every device
    // without needing a hard DELETE (handles legacy soft-deletes and edge cases).
    if (incoming.deletedAt || incoming.isDeleted) {
      LS.set(key, records.filter(r => r.id !== incoming.id));
      return;
    }

    // Don't clobber a locally-queued (offline) edit: it hasn't reached the
    // server yet, so this incoming row is stale for that record. Keep local;
    // flushPending will push our copy up. (Mirrors the hydrate merge guard.)
    if (pendingIds(table).has(incoming.id)) return;

    const idx = records.findIndex(r => r.id === incoming.id);
    if (idx >= 0) {
      // Merge: DB fields from incoming, app-only fields preserved from existing.
      const merged = [...records];
      merged[idx] = { ...records[idx], ...incoming };
      LS.set(key, merged);
    } else {
      LS.set(key, [...records, incoming]);
    }

  } else if (payload.eventType === 'DELETE') {
    // With REPLICA IDENTITY FULL, payload.old has the full row so we can use id.
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
  }, [user?.id]);

  return (
    <RealtimeContext.Provider value={{}}>
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
