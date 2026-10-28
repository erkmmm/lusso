/**
 * The custom wallpaper for the Glass theme.
 *
 * In IndexedDB rather than localStorage, deliberately. A wallpaper people
 * actually want is a photo — 2–8 MB off a phone — and base64 in localStorage
 * would be ~1.37× that again against a 5 MB budget the app is already pushing
 * (see the `lusso:storage-full` handler in Layout). One picture would evict
 * someone's measure sheets. Blobs go in raw here, the same way plan PDFs do in
 * planCache.js, and the kv store is left alone.
 *
 * It is per-device on purpose and never synced: it is wallpaper, and the one
 * person it belongs to is whoever is looking at this screen.
 */

const DB_NAME = 'lusso_wallpaper';
const STORE = 'images';
const KEY = 'current';

// Big enough for a 5K display, small enough to decode fast on a phone. The
// shade layer sits over it at ~0.5 opacity, so fine detail is lost anyway.
const MAX_EDGE = 2560;
const QUALITY = 0.82;

let _db = null;
let _opening = null;

function open() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(STORE); } catch { /* already there */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }).then((db) => { _db = db; return db; });
  return _opening;
}

/**
 * Downscale to a JPEG no bigger than MAX_EDGE on its long side.
 *
 * Unlike the field-photo path this does NOT fall back to the original on
 * failure: there, a slow upload beats losing the only picture of a bracket;
 * here the source file is still sitting on the user's disk, and quietly
 * storing an 8 MB original would be the worse outcome.
 */
async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Could not read that image.');
  return blob;
}

/** Store `file` as the custom wallpaper. Returns the stored Blob. */
export async function saveWallpaper(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  const blob = await downscale(file);
  const db = await open();
  if (!db) throw new Error('This browser cannot store a custom wallpaper.');

  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(blob, KEY);
    t.oncomplete = resolve;
    // Almost always the origin's storage quota — say so rather than "undefined".
    t.onerror = () => reject(t.error || new Error('Could not save that image.'));
    t.onabort = () => reject(t.error || new Error('Could not save that image.'));
  });

  return blob;
}

/** The stored wallpaper, or null if there isn't one. */
export async function loadWallpaper() {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** Forget the custom wallpaper. */
export async function clearWallpaper() {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(KEY);
    t.oncomplete = resolve;
    t.onerror = resolve;
    t.onabort = resolve;
  });
}
