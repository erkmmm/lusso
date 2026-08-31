/**
 * Table extraction from a PDF, using where the text actually sits on the page.
 *
 * Supplier price lists are tables. Reading them as a stream of words throws away
 * the one thing that makes them readable — the columns — and leaves you asking a
 * model to guess which number was the price. Every glyph in a PDF carries its
 * own x/y, so the columns can simply be measured instead.
 *
 * The pipeline:
 *   1. group text into rows by their y position
 *   2. cluster x positions across the whole document into column anchors
 *   3. drop each row's text into the nearest anchor
 *   4. find the header row, if there is one, to name the columns
 *
 * Nothing here is supplier-specific. A price list whose columns don't line up
 * (a scan, a flowing catalogue) yields few anchors and low confidence, which is
 * the caller's cue to fall back to the language-model parser.
 *
 * `buildTable` is pure — it takes positioned items and returns a grid — so the
 * parsing can be tested without a PDF or a browser. `extractPdfTable` is the
 * thin wrapper that gets those items out of a File via PDF.js.
 */

/** Header labels worth recognising, mapped to the field they usually mean. */
const HEADER_HINTS = [
  { field: 'itemName',      re: /^(design|product|item|fabric|name|description|range|style)\b/i },
  { field: 'itemCode',      re: /^(code|sku|item\s*(no|code)|product\s*code|ref)\b/i },
  { field: 'costPrice',     re: /^(price|cost|wholesale|trade|rate|\$)/i },
  { field: 'fabricWidthMm', re: /^(width|roll\s*width|fabric\s*width)\b/i },
  { field: 'collection',    re: /^(collection|book|range|group)\b/i },
  { field: 'composition',   re: /^(composition|content|fibre|fiber|material)\b/i },
  { field: 'usage',         re: /^(usage|use|application|suitability)\b/i },
  { field: 'railroaded',    re: /^(railroad|rail)/i },
];

/** Guess which priced-item field a column header refers to. */
export const guessField = (label) => {
  const s = String(label || '').trim();
  if (!s) return null;
  return HEADER_HINTS.find(h => h.re.test(s))?.field || null;
};

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Cluster x positions into column anchors.
 *
 * The left edge of a column repeats on every row, so a histogram of x positions
 * is a row of sharp spikes with near-empty space between them — the spikes ARE
 * the columns. Anchors are picked greedily, strongest spike first, claiming
 * everything within `minColGap` of it before moving on.
 *
 * Picking peaks rather than merging neighbours matters: text inside a wide
 * column (a composition or description) scatters x values across the gaps, and
 * a merge pass chains those into one cluster spanning the whole page. Greedy
 * peaks are immune to that — scattered values never out-vote a real column edge.
 */
function findColumnAnchors(items, rowCount, { minColGap = 12, minSupportRatio = 0.04 } = {}) {
  const hist = new Map();                          // exact x → count
  const xsAt = new Map();                          // exact x → raw xs (for median)
  for (const it of items) {
    const k = Math.round(it.x);
    hist.set(k, (hist.get(k) || 0) + 1);
    (xsAt.get(k) || xsAt.set(k, []).get(k)).push(it.x);
  }

  const minSupport = Math.max(3, Math.floor(rowCount * minSupportRatio));
  const candidates = [...hist.entries()].sort((a, b) => b[1] - a[1]);

  const anchors = [];
  const claimed = [];
  for (const [x, count] of candidates) {
    if (count < minSupport) break;                          // sorted — nothing below will qualify
    if (claimed.some(c => Math.abs(c - x) < minColGap)) continue;
    claimed.push(x);
    anchors.push({ x, support: count, xs: xsAt.get(x) });
  }

  // Fold each anchor's near neighbours in, so the anchor sits at the true centre
  // of its column rather than on whichever pixel happened to win.
  for (const a of anchors) {
    const near = [];
    for (const [x, count] of hist) {
      if (Math.abs(x - a.x) < minColGap) {
        for (let i = 0; i < count; i++) near.push(x);
      }
    }
    a.support = near.length;
    a.x = median(near);
  }

  return anchors.sort((a, b) => a.x - b.x);
}

/**
 * Turn positioned text into a grid.
 *
 * @param {Array} items  { str, x, y, page } — one per text run
 * @param {object} opts  yTolerance: rows within this many px are one row
 * @returns {{ columns, rows, headerRowIndex, confidence }}
 */
export function buildTable(items, { yTolerance = 3, snap = 6 } = {}) {
  const clean = (items || []).filter(i => i && String(i.str).trim());
  if (!clean.length) return { columns: [], rows: [], headerRowIndex: -1, confidence: 0 };

  // ── 1. rows, by page then descending y (PDF y grows upward) ────────────────
  const byRow = new Map();
  for (const it of clean) {
    const key = `${it.page}:${Math.round(it.y / yTolerance)}`;
    (byRow.get(key) || byRow.set(key, []).get(key)).push(it);
  }
  const rawRows = [...byRow.values()]
    .map(cells => ({ page: cells[0].page, y: cells[0].y, cells: cells.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.page - b.page || b.y - a.y);

  // ── 2. column anchors ─────────────────────────────────────────────────────
  // Rotated runs (sideways column headers are common in price lists) anchor a
  // few px off the column they label, so they're kept out of the histogram —
  // they still get placed into a column below, and still name it.
  const upright = clean.filter(i => !i.rotated);
  const anchors = findColumnAnchors(upright.length >= 20 ? upright : clean, rawRows.length, { snap });
  if (anchors.length < 2) {
    return { columns: [], rows: [], headerRowIndex: -1, confidence: 0 };
  }

  // ── 3. drop each row's text into its nearest anchor ───────────────────────
  const nearest = (x) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(anchors[i].x - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const rows = rawRows.map(r => {
    const cells = new Array(anchors.length).fill('');
    for (const c of r.cells) {
      const i = nearest(c.x);
      cells[i] = cells[i] ? `${cells[i]} ${c.str.trim()}` : c.str.trim();
    }
    return { page: r.page, cells, filled: cells.filter(Boolean).length };
  });

  // ── 4. header row: the earliest row that names several known columns ──────
  // Scanned across the whole document, not just the opening rows: a price list
  // usually opens with a cover and a contents page, so the table's header can be
  // hundreds of rows in. Headers repeat per page; the first best match wins.
  let headerRowIndex = -1, bestHits = 1;
  for (let i = 0; i < rows.length; i++) {
    const hits = new Set(rows[i].cells.map(c => guessField(c)).filter(Boolean)).size;
    if (hits > bestHits) { bestHits = hits; headerRowIndex = i; }
  }

  const headerCells = headerRowIndex >= 0 ? rows[headerRowIndex].cells : [];
  const columns = anchors.map((a, i) => {
    const label = (headerCells[i] || '').trim();
    return {
      index: i,
      x: a.x,
      label: label || `Column ${i + 1}`,
      hasHeader: !!label,
      field: guessField(label),
      support: a.support,
    };
  });

  // How table-like is this really? Rows that fill most columns are the signal.
  const wide = rows.filter(r => r.filled >= Math.min(3, anchors.length)).length;
  const confidence = rows.length ? wide / rows.length : 0;

  return { columns, rows, headerRowIndex, confidence };
}

/**
 * Keep only rows that look like data.
 *
 * A price list page carries a header, a footer, a page number and the odd
 * footnote. A data row is one that fills several columns AND has a value in
 * whichever column was mapped to the price — that second test is what removes
 * section headings, which are otherwise shaped just like a product row.
 */
export function dataRows(table, mapping = {}) {
  const priceIdx = Object.entries(mapping).find(([, f]) => f === 'costPrice')?.[0];
  const nameIdx  = Object.entries(mapping).find(([, f]) => f === 'itemName')?.[0];
  const minFilled = Math.min(3, table.columns.length);

  return table.rows.filter((r, i) => {
    if (i === table.headerRowIndex) return false;
    if (r.filled < minFilled) return false;
    if (nameIdx !== undefined) {
      const n = r.cells[nameIdx];
      if (!n || !/[A-Za-z]/.test(n)) return false;
    }
    if (priceIdx !== undefined) {
      if (!Number.isFinite(parseMoney(r.cells[priceIdx]))) return false;
    }
    return true;
  });
}

/** "$1,234.50" / "1234.5" / "65" → number, or NaN. */
export function parseMoney(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/[^0-9.-]/g, '');
  if (!s || s === '-' || s === '.') return NaN;
  return parseFloat(s);
}

/**
 * A width written in a price list is almost always centimetres (140, 310) —
 * millimetres only when it's already four digits. Normalised to mm because
 * that's what the app measures in.
 */
export function parseWidthMm(v) {
  const n = parseMoney(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return Math.round(n);        // already mm
  if (n >= 50)   return Math.round(n * 10);   // cm
  return null;                                // too small to be a roll width
}

/**
 * Is this row a fabric you'd actually hang?
 *
 * Price lists mix upholstery and drapery in one table and mark the difference in
 * a usage column — Warwick's reads "D", "D/GD", "HC" and so on, where D is
 * Drapery and the rest are domestic/commercial upholstery grades.
 *
 * The test is on whole tokens, not a substring: "HD" (Heavy Domestic), "GD" and
 * "LD" all contain a D, and matching loosely pulls the entire upholstery range
 * into your curtain fabrics.
 *
 * Roll width is deliberately NOT part of the test. Wide rolls are drapery, but so
 * are plenty of fabrics on a standard 1.4m roll — they're simply cut into drops
 * rather than railroaded. Filtering on width would throw those away.
 */
export function isDraperyRow(item) {
  const usage = String(item?.usage || '').trim();
  if (!usage) return false;
  if (/drape/i.test(usage)) return true;
  return usage.split(/[^A-Za-z]+/).filter(Boolean).some(t => t.toUpperCase() === 'D');
}

/**
 * Strip a supplier's sample-format wording from a collection name.
 *
 * Price lists label how a range is sampled — "Abaco Drapery Hanger", "Cappadocia
 * Collection Book", "Contract Card Adamson". That's the swatch it arrives on,
 * not the fabric, and carrying it through makes a fabric library read as a list
 * of hangers.
 *
 * Note these rows ARE fabrics: the words appear in the collection column, never
 * in the product name. Dropping rows that mention a hanger would delete most of
 * a drapery range, so this cleans the wording rather than filtering the row.
 */
export function stripSampleFormat(collection) {
  return String(collection || '')
    .replace(/\b(drapery|upholstery|plain|lifestyle|coll\.?|collection|contract)?\s*(hangers?|books?|cards?|swatch(es)?|folders?|sample\s*units?)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s|,\-–·]+|[\s|,\-–·]+$/g, '')   // separators left behind by the strip
    .trim();
}

/**
 * Apply a column→field mapping to the data rows, producing priced-item drafts.
 *
 * `unit` is forced to "per m" whenever the price column was a per-metre rate,
 * because the curtain calculator refuses anything that isn't sold per linear
 * metre — a $/m² rate used as $/m would misprice every curtain matching it.
 */
export function rowsToItems(table, mapping, { supplier = '', unit = 'per m', category = 'Curtain Fabric', draperyOnly = false, requireWidth = false } = {}) {
  return dataRows(table, mapping).map(r => {
    const get = (field) => {
      const idx = Object.entries(mapping).find(([, f]) => f === field)?.[0];
      return idx === undefined ? '' : (r.cells[idx] || '').trim();
    };

    const cost  = parseMoney(get('costPrice'));
    const width = parseWidthMm(get('fabricWidthMm'));
    // Footnote markers (Warwick uses ^ for self-weighted) can sit mid-name as
    // well as at the end — "Antigua^ Encore" — so they're stripped anywhere.
    const name  = get('itemName').replace(/[\^*†‡]/g, '').replace(/\s{2,}/g, ' ').trim();
    const collection = stripSampleFormat(get('collection'));
    // Most ranges are named after their lead fabric, so the collection often
    // just repeats the name — "Abaco · Abaco · 75% PES". Only worth showing when
    // it says something the name doesn't.
    const collectionAdds = collection && collection.toLowerCase() !== name.toLowerCase();
    const bits  = [collectionAdds ? collection : '', get('composition')].filter(Boolean);

    return {
      itemName:      name,
      itemCode:      get('itemCode'),
      category,
      supplier,
      costPrice:     Number.isFinite(cost) ? cost : null,
      unit,
      fabricWidthMm: width,
      description:   bits.join(' · '),
      collection,
      usage:         get('usage'),
      railroaded:    /^y/i.test(get('railroaded')) || null,
      isActive:      true,
    };
  }).filter(i =>
    i.itemName &&
    (!draperyOnly || isDraperyRow(i)) &&
    // A price list often bolts on a second table with different column
    // positions (Warwick's Linia section does). Those rows land on the wrong
    // anchors and come out with nonsense widths — 3, 1, a dash. When a width
    // column is mapped, every genuine row in THAT table has one, so requiring
    // it is what separates the real table from the misparsed appendix.
    (!requireWidth || Number.isFinite(Number(i.fabricWidthMm)) && i.fabricWidthMm > 0)
  );
}

/**
 * Read a PDF File into a table.
 *
 * PDF.js gives every text run a transform matrix; b/c non-zero means the run is
 * rotated, which is how most price lists set their column headers.
 */
export async function extractPdfTable(file, opts = {}) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const [, b, c] = it.transform;
      const rotated = Math.abs(b) > 0.1 || Math.abs(c) > 0.1;
      // A run rotated 90° reports its origin on the text baseline, which for
      // upright text is the LEFT edge but for sideways text sits one ascent to
      // the right of the column it labels. Shifting it back by the font scale
      // lands a sideways header on the column it actually heads — without it,
      // every header past the middle of the table drifts a column right.
      const ascent = Math.hypot(b, c);
      items.push({
        str: it.str,
        x: rotated ? it.transform[4] - ascent : it.transform[4],
        y: it.transform[5],
        page: p,
        rotated,
      });
    }
  }
  return { ...buildTable(items, opts), pageCount: pdf.numPages, itemCount: items.length };
}
