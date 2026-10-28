/**
 * useWebLeads — website enquiries, for anything that only wants to count them.
 *
 * The Inbox already loads full enquiry rows because it has to render them as
 * conversations. The Dashboard needs the same rows purely to tally where leads
 * came from, and the dashboard is the most-opened page in the app, so this
 * reads only the attribution columns and caches the result in module scope.
 * Revisiting the dashboard inside the TTL costs no query at all — Supabase
 * disk IO is the scarce resource here, not memory.
 *
 * `lusso:data-changed` does not cover web_enquiries (it is a localStorage-store
 * event), so a new lead shows up on the next load past the TTL rather than
 * instantly. The Inbox is the live view; this is a reporting read.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const TTL_MS = 5 * 60 * 1000;
const COLUMNS = 'id, created_at, status, source, page_url, meta';
const LIMIT = 2000;

let cache = null;      // { at: number, rows: array }
let inFlight = null;   // shared promise, so two mounts make one request

function fetchLeads() {
  if (!supabase) return Promise.resolve([]);
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.rows);
  if (inFlight) return inFlight;

  inFlight = supabase
    .from('web_enquiries')
    .select(COLUMNS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT)
    .then(({ data, error }) => {
      inFlight = null;
      if (error) throw error;
      cache = { at: Date.now(), rows: data ?? [] };
      return cache.rows;
    })
    .catch((err) => {
      inFlight = null;
      throw err;
    });

  return inFlight;
}

/** Drop the cache so the next read hits the database (used after a lead changes). */
export function invalidateWebLeads() {
  cache = null;
}

export function useWebLeads() {
  const [leads, setLeads] = useState(() => cache?.rows ?? null);

  useEffect(() => {
    let cancelled = false;
    fetchLeads()
      .then(rows => { if (!cancelled) setLeads(rows); })
      // A reporting card is not worth breaking the dashboard over; an empty
      // list renders the card's own "no leads yet" state.
      .catch(() => { if (!cancelled) setLeads([]); });
    return () => { cancelled = true; };
  }, []);

  return { leads: leads ?? [], loading: leads === null };
}
