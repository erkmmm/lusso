/**
 * Supabase Storage helpers for takeoff plans and site photos.
 *
 * The PDF binary lives in the private `takeoff-plans` bucket; the takeoff
 * record only stores the path. Downloads go through the authenticated client
 * (RLS-guarded), so no public URLs are ever minted.
 *
 * Paths are IMMUTABLE per revision — revision 1 keeps the historic
 * `{jobId}/{takeoffId}.pdf` name, later revisions get `-r{n}` — which is what
 * lets the offline cache be read-through with no staleness check: a given path
 * always holds the same bytes, so a cache hit is always correct.
 */
import { supabase } from './supabase';
import { getCachedPlan, putCachedPlan, removeCachedPlan, isPlanCached } from './planCache';

/** Re-exported so callers have one takeoff-storage import, not two. */
export { isPlanCached };

const BUCKET = 'takeoff-plans';

export function takeoffPlanPath(jobId, takeoffId, revision = 1) {
  const n = Number(revision) || 1;
  return n <= 1 ? `${jobId}/${takeoffId}.pdf` : `${jobId}/${takeoffId}-r${n}.pdf`;
}

export function takeoffPhotoPath(jobId, takeoffId, photoId, ext = 'jpg') {
  return `${jobId}/photos/${takeoffId}-${photoId}.${ext}`;
}

/** Upload (or overwrite) a plan PDF. Returns the storage path. */
export async function uploadTakeoffPlan(jobId, takeoffId, file, revision = 1) {
  if (!supabase) throw new Error('Supabase not configured');
  const path = takeoffPlanPath(jobId, takeoffId, revision);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  // Seed the offline cache from the bytes we already hold, so a plan uploaded
  // in the office is immediately available on site with no signal.
  try {
    await putCachedPlan(path, await file.arrayBuffer(), {
      fileName: file.name, takeoffId, jobId,
    });
  } catch { /* cache is best-effort */ }
  return path;
}

/**
 * Download a plan PDF as an ArrayBuffer (what PDF.js wants).
 *
 * Cache first: on site this is the difference between a working tool and a
 * spinner. Returns null only when the object is missing everywhere, so callers
 * can show a "re-upload" state rather than crash.
 */
export async function downloadTakeoffPlan(path, { cacheOnly = false } = {}) {
  if (!path) return null;
  const cached = await getCachedPlan(path);
  if (cached) return cached;
  if (cacheOnly || !supabase) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  putCachedPlan(path, buf).catch(() => { /* best-effort */ });
  return buf;
}

/** Pull a plan into the offline cache without opening it. */
export async function cacheTakeoffPlan(path, meta = {}) {
  if (!path || !supabase) return false;
  if (await getCachedPlan(path)) return true;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return false;
  await putCachedPlan(path, await data.arrayBuffer(), meta);
  return true;
}

/** Remove a plan PDF (best-effort — failure is non-fatal). */
export async function removeTakeoffPlan(path) {
  if (!path) return;
  removeCachedPlan(path);
  if (!supabase) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

/** Remove several plan revisions at once. */
export async function removeTakeoffPlans(paths = []) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  list.forEach(p => removeCachedPlan(p));
  if (!supabase) return;
  await supabase.storage.from(BUCKET).remove(list);
}

// ── Site photos ─────────────────────────────────────────────────────────────

/** Upload a photo against a takeoff. Returns the storage path. */
export async function uploadTakeoffPhoto(jobId, takeoffId, photoId, file) {
  if (!supabase) throw new Error('Supabase not configured');
  const ext = (file.type?.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = takeoffPhotoPath(jobId, takeoffId, photoId, ext);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}

/**
 * A short-lived signed URL for a private photo. Cached in-memory for the
 * session so re-rendering a list of thumbnails doesn't re-sign every time.
 */
const signedCache = new Map();
export async function signedPhotoUrl(path, expiresIn = 3600) {
  if (!path || !supabase) return null;
  const hit = signedCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + (expiresIn - 60) * 1000 });
  return data.signedUrl;
}

/** Remove photos (best-effort). */
export async function removeTakeoffPhotos(paths = []) {
  const list = paths.filter(Boolean);
  if (!list.length || !supabase) return;
  list.forEach(p => signedCache.delete(p));
  await supabase.storage.from(BUCKET).remove(list);
}
