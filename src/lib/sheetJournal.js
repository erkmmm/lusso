/**
 * An append-only local history of every measure sheet, in IndexedDB.
 *
 * Why this exists: on 2026-09-07 a house was measured, saved, and came back
 * empty. The line items only ever lived in one browser tab's memory; when that
 * state was lost, the autosave wrote the blank version over the record and
 * hydration spread it to every device. There was nowhere to recover from,
 * because every layer held only the CURRENT version.
 *
 * So this keeps the previous ones. Every write of a sheet appends a snapshot
 * here first, before anything else can overwrite anything. It is:
 *
 *   • local-only and append-only — no sync, so nothing remote can delete it
 *   • in IndexedDB, not localStorage — quota measured in hundreds of MB, and it
 *     survives the localStorage eviction that iOS does to background tabs
 *   • written BEFORE the save it is protecting, so a crash mid-save still
 *     leaves the prior version intact
 *   • never trimmed below the last non-empty version of a sheet, whatever the
 *     retention limits say
 *
 * It is deliberately dumb. No merging, no conflict resolution, no cleverness —
 * just "what did this sheet look like, and when". Cleverness is what lost the
 * data in the first place.
 */

const DB_NAME  = 'lusso-sheet-journal';
const STORE    = 'versions';
const DB_VER   = 1;

// Per sheet. A day of measuring is maybe 60 autosaves; 40 versions covers the
// recent past without unbounded growth, and the "keep the fattest" rule below
// means the useful ones are the ones that survive.
const MAX_PER_SHEET = 40;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'key', autoIncrement: false });
          os.createIndex('sheetId', 'sheetId', { unique: false });
          os.createIndex('at', 'at', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => { console.warn('[journal] unavailable:', req.error?.message); resolve(null); };
    } catch (e) {
      console.warn('[journal] unavailable:', e?.message || e);
      resolve(null);
    }
  });
  return dbPromise;
}

const tx = async (mode, fn) => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let out = null;
    try {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      out = fn(store);
      t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
      t.onerror    = () => resolve(null);
      t.onabort    = () => resolve(null);
    } catch { resolve(null); }
  });
};

const lineCount = (sheet) => (sheet?.lineItems || []).length;

/** How much real content a version holds — used to decide what's worth keeping. */
export function contentScore(sheet) {
  let filled = 0;
  for (const li of sheet?.lineItems || []) {
    if (String(li.location || '').trim()) filled++;
    if (String(li.widthMm  || '').trim()) filled++;
    if (String(li.dropMm   || '').trim()) filled++;
    if (String(li.fabricColour || '').trim()) filled++;
    if (li.productTypeId || li.pricedItemId) filled++;
    if ((li.photoPaths || []).length) filled += 2;
  }
  return filled;
}

/**
 * Append a snapshot. Fire-and-forget: journalling must never block or fail a
 * save, but it runs BEFORE the save so the prior state is already on disk.
 */
export function recordSheetVersion(sheet, reason = 'save') {
  if (!sheet?.id) return;
  try {
    const at = Date.now();
    const entry = {
      key: `${sheet.id}:${at}:${Math.random().toString(36).slice(2, 8)}`,
      sheetId: sheet.id,
      at,
      reason,
      lines: lineCount(sheet),
      score: contentScore(sheet),
      customerName: sheet.customerName || '',
      sheet: JSON.parse(JSON.stringify(sheet)),
    };
    tx('readwrite', (store) => { store.put(entry); }).then(() => trim(sheet.id));
  } catch (e) {
    console.warn('[journal] record failed:', e?.message || e);
  }
}

/** Newest first. */
export async function getSheetVersions(sheetId) {
  const rows = await tx('readonly', (store) => store.index('sheetId').getAll(sheetId));
  return (rows || []).sort((a, b) => b.at - a.at);
}

/** Every sheet the journal knows about, with its best surviving version. */
export async function listJournalledSheets() {
  const rows = await tx('readonly', (store) => store.getAll());
  const by = new Map();
  for (const r of rows || []) {
    const cur = by.get(r.sheetId);
    if (!cur || r.score > cur.bestScore || (r.score === cur.bestScore && r.at > cur.latestAt)) {
      by.set(r.sheetId, {
        sheetId: r.sheetId,
        customerName: r.customerName || cur?.customerName || '',
        bestScore: Math.max(r.score, cur?.bestScore ?? 0),
        bestLines: r.score >= (cur?.bestScore ?? 0) ? r.lines : cur.bestLines,
        latestAt: Math.max(r.at, cur?.latestAt ?? 0),
        versions: (cur?.versions ?? 0) + 1,
      });
    } else {
      cur.versions += 1;
      cur.latestAt = Math.max(cur.latestAt, r.at);
    }
  }
  return [...by.values()].sort((a, b) => b.latestAt - a.latestAt);
}

/**
 * Trim a sheet's history, but NEVER drop its richest version.
 *
 * Straight "keep the newest N" would have thrown away the good copy after forty
 * blank autosaves — which is precisely the failure this store exists to survive.
 * So the highest-scoring version is pinned, and the rest age out by time.
 */
async function trim(sheetId) {
  const versions = await getSheetVersions(sheetId);
  if (versions.length <= MAX_PER_SHEET) return;
  const best = versions.reduce((a, b) => (b.score > a.score ? b : a), versions[0]);
  const keep = new Set([best.key, ...versions.slice(0, MAX_PER_SHEET - 1).map(v => v.key)]);
  await tx('readwrite', (store) => {
    for (const v of versions) if (!keep.has(v.key)) store.delete(v.key);
  });
}

/** Approximate size, so the recovery screen can say what it's holding. */
export async function journalStats() {
  const rows = await tx('readonly', (store) => store.getAll());
  const bytes = (rows || []).reduce((n, r) => n + JSON.stringify(r.sheet).length, 0);
  return { versions: (rows || []).length, sheets: new Set((rows || []).map(r => r.sheetId)).size, bytes };
}
