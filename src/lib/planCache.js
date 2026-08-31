/**
 * Offline cache for plan PDFs.
 *
 * A takeoff happens standing in a half-built house, which is exactly where
 * there is no signal. The plan itself is the one piece of the job that isn't
 * already in localStorage — it's a multi-megabyte binary pulled from a private
 * Supabase bucket on every page load — so without this the tool is useless
 * off-grid even though all the measurements are local.
 *
 * Kept in its own IndexedDB database rather than the `lusso_durable` kv store:
 * that store round-trips LZ-compressed strings for the localStorage mirror, and
 * pushing 10 MB binaries through it would be slow and pointless. Blobs go in
 * raw here, with a small LRU cap so a phone doesn't fill up over a season.
 */

const DB_NAME = 'lusso_plans';
const STORE = 'pdfs';
const MAX_ENTRIES = 12;          // ~ a season of live jobs
const MAX_BYTES = 220 * 1024 * 1024;

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
        try {
          const store = req.result.createObjectStore(STORE, { keyPath: 'path' });
          store.createIndex('usedAt', 'usedAt');
        } catch { /* already there */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }).then(db => { _db = db; return db; });
  return _opening;
}

const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);

const asPromise = (req) => new Promise((resolve) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => resolve(null);
});

/**
 * Read a cached plan. Returns an ArrayBuffer, or null on a miss.
 * Touches `usedAt` so the LRU keeps the plans actually being worked on.
 */
export async function getCachedPlan(path) {
  if (!path) return null;
  const db = await open();
  if (!db) return null;
  try {
    const row = await asPromise(tx(db, 'readonly').get(path));
    if (!row?.blob) return null;
    try { tx(db, 'readwrite').put({ ...row, usedAt: Date.now() }); } catch { /* best-effort */ }
    return await row.blob.arrayBuffer();
  } catch { return null; }
}

/** Store a plan for offline use. Silently no-ops when IndexedDB is unavailable. */
export async function putCachedPlan(path, arrayBuffer, meta = {}) {
  if (!path || !arrayBuffer) return;
  const db = await open();
  if (!db) return;
  try {
    const blob = new Blob([arrayBuffer.slice(0)], { type: 'application/pdf' });
    tx(db, 'readwrite').put({
      path,
      blob,
      bytes: blob.size,
      fileName: meta.fileName || '',
      takeoffId: meta.takeoffId || '',
      jobId: meta.jobId || '',
      cachedAt: Date.now(),
      usedAt: Date.now(),
    });
    await prune(db);
  } catch (e) {
    // Quota exceeded on a full phone: not fatal, the plan just won't be offline.
    console.warn('[planCache] put failed', e);
  }
}

/** Drop one plan (used when a plan is replaced or deleted). */
export async function removeCachedPlan(path) {
  if (!path) return;
  const db = await open();
  if (!db) return;
  try { tx(db, 'readwrite').delete(path); } catch { /* best-effort */ }
}

/** Is this plan available without a network? */
export async function isPlanCached(path) {
  if (!path) return false;
  const db = await open();
  if (!db) return false;
  try {
    const row = await asPromise(tx(db, 'readonly').get(path));
    return !!row?.blob;
  } catch { return false; }
}

async function prune(db) {
  try {
    const rows = await asPromise(tx(db, 'readonly').getAll());
    if (!rows?.length) return;
    const total = rows.reduce((s, r) => s + (r.bytes || 0), 0);
    if (rows.length <= MAX_ENTRIES && total <= MAX_BYTES) return;
    const byAge = [...rows].sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0));
    let count = rows.length, bytes = total;
    const store = tx(db, 'readwrite');
    for (const row of byAge) {
      if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      store.delete(row.path);
      count -= 1;
      bytes -= row.bytes || 0;
    }
  } catch { /* best-effort */ }
}
