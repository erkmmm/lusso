import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

/**
 * Storage codec + durable backup shared by data.js and db.js.
 *
 * localStorage stays the fast, SYNCHRONOUS read/write store (large values are
 * LZ-compressed to fit its ~5MB quota). Every write is ALSO mirrored to
 * IndexedDB, which has a far larger quota and — once persistent storage is
 * granted — is not auto-evicted by the browser/OS. On startup, initDurableStore()
 * requests persistence and restores any key the browser evicted from
 * localStorage but IndexedDB still holds. Net effect: unsynced on-site work
 * survives even the browser reclaiming storage while offline.
 */
const MARKER = '';
const COMPRESS_OVER_CHARS = 20_000; // small keys stay readable in DevTools

// ── IndexedDB durable mirror ─────────────────────────────────────────────────
let idb = null;

function idbOpen() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open('lusso_durable', 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch { /* ignore */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
function idbPut(key, value) {
  if (!idb) return;
  try { idb.transaction('kv', 'readwrite').objectStore('kv').put(value, key); } catch { /* best-effort */ }
}
function idbDelete(key) {
  if (!idb) return;
  try { idb.transaction('kv', 'readwrite').objectStore('kv').delete(key); } catch { /* best-effort */ }
}
function idbGetAll() {
  return new Promise((resolve) => {
    if (!idb) return resolve({});
    try {
      const out = {};
      const req = idb.transaction('kv', 'readonly').objectStore('kv').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
      req.onerror = () => resolve(out);
    } catch { resolve({}); }
  });
}

/**
 * Call ONCE at startup, before the app reads any data. Requests persistent
 * (non-evictable) storage, opens the IndexedDB mirror, and restores any lusso_
 * key that localStorage lost to eviction but IndexedDB still holds.
 */
export async function initDurableStore() {
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  idb = await idbOpen();
  if (!idb) return; // IndexedDB unavailable (e.g. Safari private mode) → localStorage-only
  try {
    const all = await idbGetAll();
    // 1. RESTORE: bring back any key IndexedDB holds but localStorage lost to
    // eviction. A key still present in localStorage may be newer, so it wins.
    // Values are stored as the RAW localStorage payload string, so this works
    // for codec-encoded JSON and plain-string keys (theme, version) alike.
    let restored = 0;
    for (const [key, raw] of Object.entries(all)) {
      if (typeof key !== 'string' || !key.startsWith('lusso_') || typeof raw !== 'string') continue;
      if (localStorage.getItem(key) == null) {
        try { localStorage.setItem(key, raw); restored++; } catch { /* full — cloud will refill */ }
      }
    }
    if (restored) console.info(`[storage] restored ${restored} key(s) from the durable IndexedDB backup (localStorage had been evicted)`);

    // 2. BACK UP: mirror everything localStorage currently holds into
    // IndexedDB. Without this, data written before this backup existed (or by an
    // older build) would sit unmirrored until its next write — so an eviction in
    // between would lose it. localStorage is the authoritative read source here,
    // so it always refreshes the mirror. Raw strings, no decode — cheap and
    // format-agnostic.
    let mirrored = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('lusso_') || key.endsWith('__corrupt')) continue;
      const raw = localStorage.getItem(key);
      if (raw != null) { idbPut(key, raw); mirrored++; }
    }
    if (mirrored) console.info(`[storage] mirrored ${mirrored} key(s) to the durable IndexedDB backup`);
  } catch (e) { console.warn('[storage] durable backup/restore skipped:', e?.message || e); }
}

// ── localStorage codec ───────────────────────────────────────────────────────
/** Write an already-encoded payload string to localStorage. Never throws. */
function writeLocal(key, payload) {
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch {
    // Likely QuotaExceededError — reclaim space (drop corrupt backups) and retry.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.endsWith('__corrupt')) localStorage.removeItem(k);
      }
      localStorage.setItem(key, payload);
      return true;
    } catch {
      // Still full. The record is safe in IndexedDB (mirrored below) and the
      // cloud; warn the user so it isn't a silent local failure.
      try { window.dispatchEvent(new CustomEvent('lusso:storage-full', { detail: { key } })); } catch { /* SSR */ }
      console.error(`[storage] '${key}' NOT saved to localStorage — full (kept in IndexedDB + cloud)`);
      return false;
    }
  }
}

/** Read + decode a value (synchronous). Null when absent. Fail-safe on corruption. */
export function lsGet(key) {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    const json = raw.startsWith(MARKER) ? decompressFromUTF16(raw.slice(1)) : raw;
    if (!json) throw new Error('empty/undecodable');
    return JSON.parse(json);
  } catch (e) {
    // Preserve the unreadable blob once so a fresh write can't overwrite
    // recoverable data; return null and let hydration/IndexedDB restore.
    try {
      const backupKey = `${key}__corrupt`;
      if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, raw);
    } catch { /* best-effort */ }
    console.error(`[storage] '${key}' failed to decode — preserved raw copy:`, e?.message || e);
    return null;
  }
}

/** Write a value: fast localStorage + durable IndexedDB mirror. Never throws. */
export function lsSet(key, value) {
  let payload;
  try {
    const json = JSON.stringify(value);
    payload = json.length > COMPRESS_OVER_CHARS ? MARKER + compressToUTF16(json) : json;
  } catch (e) {
    console.error(`[storage] '${key}' failed to encode:`, e?.message || e);
    return false;
  }
  const ok = writeLocal(key, payload);
  idbPut(key, payload); // durable, large-quota, eviction-resistant backup (raw payload string)
  return ok;
}

/** Delete a value from both stores. */
export function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  idbDelete(key);
}
