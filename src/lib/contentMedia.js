/**
 * Getting a photo to a place Instagram can fetch it.
 *
 * Instagram does not accept an upload. It takes an `image_url` and fetches it
 * from Meta's own servers, which means the URL has to be public, and has to
 * stay public for as long as the post exists.
 *
 * Job photos live in the private `attachments` bucket, and photoStore.js is
 * explicit about why: "No public URLs are ever minted for a customer's house."
 * So nothing here ever exposes that bucket. A photo chosen for a post is COPIED
 * into `content-media`, which is public, and the copy is what gets published.
 * The original is untouched.
 *
 * That copy is a real decision, not a technicality: once made, the image is
 * readable by anyone with the link and Meta will have cached it. The app should
 * say so at the point of choosing, which is why this module refuses to do it
 * silently — callers pass the photo in, deliberately, one at a time.
 */
import { supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';

const BUCKET = 'content-media';
const MAX_EDGE = 1440;   // Instagram renders at 1080; 1440 leaves room to crop
const QUALITY  = 0.85;

/** Downscale to a JPEG, same approach as photoStore — a phone frame is 4-8 MB. */
async function downscale(file) {
  try {
    if (!file.type?.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_200_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/**
 * Put one image in the public bucket and return its URL.
 * @param {File|Blob} file
 * @returns {Promise<string>} the public URL Instagram will fetch
 */
export async function publishImage(file) {
  if (!supabase) throw new Error('Not connected to a database');
  const body = await downscale(file);
  const path = `posts/${uuidv4()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Copy a private job photo into the public bucket.
 *
 * Downloads through the caller's own session — so RLS decides whether they
 * could see the photo in the first place — then re-uploads the bytes. There is
 * deliberately no server-side copy that could be pointed at an arbitrary path.
 *
 * @param {string} storagePath path inside the private `attachments` bucket
 */
export async function publishJobPhoto(storagePath) {
  if (!supabase) throw new Error('Not connected to a database');
  const { data: blob, error } = await supabase.storage.from('attachments').download(storagePath);
  if (error) throw new Error(`Couldn't read that photo: ${error.message}`);
  return publishImage(blob);
}

/**
 * Take a published image back out of the public bucket.
 * The only way to un-publish one, so it belongs in the app rather than the
 * Supabase dashboard.
 */
export async function unpublishImage(publicUrl) {
  if (!supabase) return;
  const marker = `/${BUCKET}/`;
  const i = publicUrl.indexOf(marker);
  if (i === -1) return;                       // not ours — a site image, leave it
  const path = publicUrl.slice(i + marker.length).split('?')[0];
  await supabase.storage.from(BUCKET).remove([path]);
}
