/**
 * Supabase Storage helpers for takeoff plan PDFs.
 *
 * The PDF binary lives in the private `takeoff-plans` bucket at
 * `{jobId}/{takeoffId}.pdf`; the takeoff record only stores that path.
 * Downloads go through the authenticated client (RLS-guarded), so no
 * public URLs are ever minted.
 */
import { supabase } from './supabase';

const BUCKET = 'takeoff-plans';

export function takeoffPlanPath(jobId, takeoffId) {
  return `${jobId}/${takeoffId}.pdf`;
}

/** Upload (or overwrite) a plan PDF. Returns the storage path. */
export async function uploadTakeoffPlan(jobId, takeoffId, file) {
  if (!supabase) throw new Error('Supabase not configured');
  const path = takeoffPlanPath(jobId, takeoffId);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

/**
 * Download a plan PDF as an ArrayBuffer (what PDF.js wants). Returns null
 * if the object is missing so callers can show a "re-upload" state rather
 * than crash.
 */
export async function downloadTakeoffPlan(path) {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.arrayBuffer();
}

/** Remove a plan PDF (best-effort — failure is non-fatal). */
export async function removeTakeoffPlan(path) {
  if (!supabase || !path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}
