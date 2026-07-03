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
const MARKER = '\u0001';
const COMPRESS_OVER_CHARS = 20_000; // small keys stay readable in DevTools

export function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const json = raw.startsWith(MARKER) ? decompressFromUTF16(raw.slice(1)) : raw;
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export function lsSet(key, value) {
  const json = JSON.stringify(value);
  const payload = json.length > COMPRESS_OVER_CHARS ? MARKER + compressToUTF16(json) : json;
  localStorage.setItem(key, payload);
}
