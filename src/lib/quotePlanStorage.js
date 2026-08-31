/**
 * Storage-only half of the quote plan attachment.
 *
 * Split out from quotePlanSnapshot.js purely to keep the import graph acyclic:
 * data.js needs to delete a quote's plan images, but the capture side pulls in
 * clientSchedule.js, which imports data.js right back. This file depends on
 * nothing but the Supabase client, so either side can use it freely.
 */
import { supabase } from './supabase';

export const QUOTE_PLAN_BUCKET = 'quote-plans';

/** Delete a snapshot's images. Best-effort — a stale image is not worth an error. */
export async function removeQuotePlan(snapshot) {
  const paths = (snapshot?.pages || []).map(p => p.path).filter(Boolean);
  if (!paths.length || !supabase) return;
  try {
    await supabase.storage.from(QUOTE_PLAN_BUCKET).remove(paths);
  } catch {
    /* best-effort */
  }
}
