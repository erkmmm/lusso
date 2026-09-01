/**
 * Photos taken in the field — notes, and now individual measure-sheet lines.
 *
 * One store for both, because they have the same job to do on the same phone:
 * take a picture of a fabric, a bracket, an awkward reveal, and have it survive
 * the trip home. Binaries live in the private `attachments` bucket; the record
 * (a task, or a line item inside a sheet's jsonb) stores only paths, and
 * viewing mints a short-lived signed URL. No public URLs are ever minted for a
 * customer's house.
 *
 * Everything is downscaled before upload: a modern phone shoots 4–8 MB a frame,
 * and a photo taken in a driveway on one bar has to actually finish.
 */
import { supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';

const BUCKET = 'attachments';
const MAX_EDGE = 1600;          // px on the long side — plenty to read a fabric label
const QUALITY  = 0.82;
const SIGNED_TTL = 3600;        // seconds

/** Where each kind of photo lives. Kept here so the layout is in one place. */
export const notePhotoPrefix = (noteId) => `notes/${noteId}`;
export const linePhotoPrefix = (sheetId, itemId) => `measure-sheets/${sheetId}/${itemId}`;

/**
 * Downscale to a JPEG under MAX_EDGE on its long side. Falls back to the
 * original file if anything about the decode fails — a slow upload beats
 * losing the photo.
 */
async function downscale(file) {
  try {
    if (!file.type.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Upload one photo under `prefix`. Returns the storage path. */
export async function uploadPhoto(prefix, file) {
  if (!supabase) throw new Error('Supabase not configured');
  const body = await downscale(file);
  const ext  = body.type === 'image/jpeg' ? 'jpg' : (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const path = `${prefix}/${uuidv4()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: body.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/**
 * Signed URLs for a set of paths, as { path: url }.
 *
 * Cached for the life of the tab so scrolling a sheet with a photo on every
 * line doesn't re-sign the same image on every render. The cache expires well
 * before the URLs do.
 */
const urlCache = new Map(); // path → { url, expires }

export async function signPhotos(paths = []) {
  const out = {};
  const now = Date.now();
  const wanted = [];

  for (const p of paths) {
    const hit = urlCache.get(p);
    if (hit && hit.expires > now) out[p] = hit.url;
    else wanted.push(p);
  }
  if (!wanted.length || !supabase) return out;

  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(wanted, SIGNED_TTL);
  for (const row of data || []) {
    if (!row?.signedUrl || row.error) continue;
    urlCache.set(row.path, { url: row.signedUrl, expires: now + (SIGNED_TTL - 300) * 1000 });
    out[row.path] = row.signedUrl;
  }
  return out;
}

/**
 * Fetch photos as base64, for attaching to an email.
 *
 * Signed URLs expire in an hour; an installer opens the email tomorrow. So the
 * bytes travel WITH the message rather than as a link, which also keeps the
 * customer's house out of any public URL. Returns what it could fetch and the
 * paths it couldn't, so the caller can tell someone rather than silently
 * sending a job with no pictures.
 */
export async function downloadPhotosAsBase64(items = [], { maxTotalBytes = 8_000_000 } = {}) {
  const files = [];
  const failed = [];
  const skipped = [];
  let total = 0;

  // Accepts plain paths or { path, filename } — an installer opening
  // "Master Bedroom - Roller Blind 1.jpg" is better served than by a uuid.
  for (const entry of items) {
    const path = typeof entry === 'string' ? entry : entry.path;
    const name = (typeof entry === 'string' ? null : entry.filename) || path.split('/').pop() || 'photo.jpg';
    if (!supabase) { failed.push(path); continue; }
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) { failed.push(path); continue; }
      if (total + data.size > maxTotalBytes) { skipped.push(path); continue; }
      total += data.size;

      const buf = new Uint8Array(await data.arrayBuffer());
      // Chunked so a few MB of image doesn't blow the argument limit on
      // String.fromCharCode the way a single spread would.
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      files.push({ filename: name, contentBase64: btoa(binary) });
    } catch {
      failed.push(path);
    }
  }
  return { files, failed, skipped, totalBytes: total };
}

/** Remove photos from storage. Best-effort: the record is what matters. */
export async function deletePhotos(paths = []) {
  if (!supabase || !paths.length) return;
  paths.forEach(p => urlCache.delete(p));
  try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* an orphan is harmless */ }
}

// ── Note-specific wrappers (the call sites read better for it) ───────────────
export const uploadNotePhoto = (noteId, file) => uploadPhoto(notePhotoPrefix(noteId), file);
export const signNotePhotos  = signPhotos;
export const deleteNotePhotos = deletePhotos;
