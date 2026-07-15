import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

/**
 * localStorage codec shared by data.js and db.js.
 *
 * Large values are stored LZ-compressed (UTF-16 safe) so the whole dataset —
 * including years of imported quote history — fits inside the browser's
 * ~5MB localStorage quota. Quote/job JSON is highly repetitive and typically
 * shrinks 5-10×.
 *
 * Format: compressed values carry a one-char marker prefix (U+0001).
 * Plain JSON (legacy values, small values) is stored as-is, so existing data
 * migrates transparently on the next write.
 */
const MARKER = '';
const COMPRESS_OVER_CHARS = 20_000; // small keys stay readable in DevTools

/**
 * Read + decode a value. Returns null when the key is absent.
 *
 * Fail-SAFE, not fail-EMPTY: if a value can't be decompressed/parsed (corrupt
 * or half-written), we PRESERVE the raw bytes under `<key>__corrupt_<ts>` before
 * returning null, so a later save can't silently overwrite recoverable data and
 * the record can still be restored from Supabase (or by hand). We never discard
 * the only copy of data on a read error.
 */
export function lsGet(key) {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    const json = raw.startsWith(MARKER) ? decompressFromUTF16(raw.slice(1)) : raw;
    if (!json) throw new Error('empty/undecodable');
    return JSON.parse(json);
  } catch (e) {
    // Preserve the unreadable blob once so it isn't lost when the caller
    // (which reads `get(key) || []`) writes a fresh, smaller value over it.
    try {
      const backupKey = `${key}__corrupt`;
      if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, raw);
      console.error(`[storage] '${key}' failed to decode — preserved raw copy at '${backupKey}':`, e?.message || e);
    } catch { /* backup best-effort */ }
    return null;
  }
}

/**
 * Encode + write a value. Returns true on success, false if the browser
 * rejected the write (e.g. QuotaExceededError). NEVER throws — a storage
 * failure must not abort the caller before it can push the record to the cloud.
 * Callers should treat `false` as "not saved locally" and surface a warning.
 */
export function lsSet(key, value) {
  let payload;
  try {
    const json = JSON.stringify(value);
    payload = json.length > COMPRESS_OVER_CHARS ? MARKER + compressToUTF16(json) : json;
  } catch (e) {
    console.error(`[storage] '${key}' failed to encode:`, e?.message || e);
    return false;
  }
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch (e) {
    // Almost always QuotaExceededError. Try to reclaim space by dropping any
    // preserved-corrupt backups, then retry once before giving up.
    console.warn(`[storage] '${key}' write failed (${e?.name || 'error'}) — attempting to reclaim space`);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.endsWith('__corrupt')) localStorage.removeItem(k);
      }
      localStorage.setItem(key, payload);
      return true;
    } catch {
      // Signal storage pressure so the UI can warn the user. The caller still
      // proceeds to sync the record to Supabase, so the cloud copy is safe.
      try { window.dispatchEvent(new CustomEvent('lusso:storage-full', { detail: { key } })); } catch { /* SSR/no window */ }
      console.error(`[storage] '${key}' NOT saved locally — device storage is full`);
      return false;
    }
  }
}
