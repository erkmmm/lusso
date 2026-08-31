/**
 * The takeoff as a customer sees it.
 *
 * Internally a takeoff is measurements, page scales and px-per-mm. None of that
 * means anything to a homeowner or a builder — what they need to check is
 * "which window is getting what, and have you actually been out to measure it".
 * So this flattens the same data into numbered pins on the plan and a plain
 * schedule beside it, using the SAME `takeoffRows` the measure sheet is built
 * from. If the client approves this, they've approved what gets ordered.
 */
import { takeoffRows, getMeasureSheetByJob, isPlanEstimate } from '../store/data';
import { pointsOf } from './takeoffGeometry';

/**
 * Colours for the pins, keyed by product type.
 *
 * Deliberately assigned by first appearance rather than hashed from the name:
 * a hash gives two similar colours to the two product types on a job often
 * enough to matter, and the legend is the only thing telling them apart.
 */
const PIN_PALETTE = [
  '#0f766e', '#b45309', '#1d4ed8', '#7c3aed', '#be123c',
  '#0369a1', '#4d7c0f', '#a16207', '#9333ea', '#0891b2',
];
const UNSPECIFIED = '#94a3b8';

export function buildPalette(rows) {
  const map = new Map();
  let i = 0;
  for (const r of rows) {
    const key = r.productNameSnapshot || '';
    if (!key || map.has(key)) continue;
    map.set(key, PIN_PALETTE[i % PIN_PALETTE.length]);
    i += 1;
  }
  return map;
}

export const colourFor = (palette, productName) =>
  (productName && palette.get(productName)) || UNSPECIFIED;

/** Plain-English shape, instead of radius/segment internals. */
export function shapeLabel(m) {
  if (!m) return '';
  if (m.kind === 'arc' && m.radiusMm) return 'Curved';
  if (m.kind === 'chain' && m.segments?.length > 1) return `${m.segments.length}-part bay`;
  return '';
}

/**
 * Numbered schedule entries with a pin position for each.
 *
 * Numbering runs down the page then across, per page — the order someone
 * reading the drawing would find them in, so pin 7 is where they expect it.
 * Rows split across bay facets collapse back to ONE pin: the client cares that
 * the bay is covered, not that it's three separate blinds on the order.
 */
export function buildClientSchedule(takeoff, { pageNumber = null } = {}) {
  if (!takeoff) return { entries: [], palette: new Map(), byPage: new Map() };

  const rows = takeoffRows(takeoff);
  const measurements = takeoff.measurements || [];
  const items = takeoff.items || [];

  // "Measured on site" is a property of the SHEET line, not of the takeoff —
  // the takeoff only ever knows what it scaled off the drawing. Look the real
  // state up so the client is told the truth about which sizes are confirmed.
  const sheetLines = new Map(
    ((getMeasureSheetByJob(takeoff.jobId)?.lineItems) || [])
      .filter(li => li.source === 'takeoff' && li.takeoffGroup)
      .map(li => [li.takeoffGroup, li])
  );

  // Collapse the per-facet rows a bay produces back into one line.
  const merged = [];
  const seenItem = new Map();
  for (const row of rows) {
    const groupKey = row.itemId || row.key;
    if (row.itemId && seenItem.has(groupKey)) {
      const first = seenItem.get(groupKey);
      first.parts += 1;
      first.partWidths.push(row.widthMm);
      // A bay counts as measured only when every facet of it has been.
      const line = sheetLines.get(row.key);
      if (!line || isPlanEstimate(line)) first.measured = false;
      continue;
    }
    const item = row.itemId ? items.find(i => i.id === row.itemId) : null;
    const widthM = row.itemId
      ? [...measurements].reverse().find(m => m.itemId === row.itemId && m.tag === 'Width')
      : measurements.find(m => !m.itemId && (m.label || '').trim() === row.label);
    const anchor = widthM ? midpointOf(widthM) : null;

    const entry = {
      key: row.key,
      itemId: row.itemId,
      // Strip the "— 1 of 3" suffix the sheet needs but a client doesn't.
      label: (item?.label || row.label || '').replace(/\s+—\s+\d+ of \d+$/, '') || 'Unnamed',
      product: row.productNameSnapshot || '',
      widthMm: row.widthMm,
      dropMm: row.dropMm,
      quantity: row.quantity,
      pageNumber: row.pageNumber || widthM?.pageNumber || 1,
      measured: sheetLines.has(row.key) ? !isPlanEstimate(sheetLines.get(row.key)) : false,
      shape: shapeLabel(widthM),
      totalWidthMm: widthM ? Math.round(widthM.lengthMm) : row.widthMm,
      parts: 1,
      partWidths: [row.widthMm],
      anchor,
      // The run itself, so the client view can draw where the covering starts
      // and stops rather than dropping a dot near it. Extent is the thing a
      // customer can actually check against their own house.
      points: widthM ? pointsOf(widthM).map(pt => ({ x: pt.x, y: pt.y })) : null,
      kind: widthM?.kind || 'line',
      photoCount: row.photoCount || 0,
    };
    merged.push(entry);
    if (row.itemId) seenItem.set(groupKey, entry);
  }

  // Number per page, reading order: top to bottom, then left to right.
  const byPage = new Map();
  for (const e of merged) {
    if (!byPage.has(e.pageNumber)) byPage.set(e.pageNumber, []);
    byPage.get(e.pageNumber).push(e);
  }
  for (const list of byPage.values()) {
    list.sort((a, b) => {
      if (!a.anchor || !b.anchor) return 0;
      // Band the page into rows so two windows on the same wall don't get
      // numbered out of order by a few pixels of vertical jitter.
      const band = (p) => Math.round(p.y / 40);
      return band(a.anchor) - band(b.anchor) || a.anchor.x - b.anchor.x;
    });
    list.forEach((e, i) => { e.number = i + 1; });
  }

  const entries = pageNumber == null
    ? merged
    : merged.filter(e => e.pageNumber === pageNumber);

  return { entries, palette: buildPalette(rows), byPage };
}

function midpointOf(m) {
  const pts = pointsOf(m);
  if (m.kind === 'chain' && pts.length > 2) {
    // The middle of the run, not the middle of the chord — on a bay the chord's
    // midpoint can sit outside the window entirely.
    const mid = Math.floor(pts.length / 2);
    return pts.length % 2
      ? pts[mid]
      : { x: (pts[mid - 1].x + pts[mid].x) / 2, y: (pts[mid - 1].y + pts[mid].y) / 2 };
  }
  const a = pts[0], b = pts[pts.length - 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Per-product totals for the legend. */
export function summarise(entries) {
  const counts = new Map();
  for (const e of entries) {
    const key = e.product || 'Not yet specified';
    counts.set(key, (counts.get(key) || 0) + (e.quantity || 1));
  }
  return [...counts.entries()]
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count);
}

/** How much of the job has actually been check-measured. */
export function measuredProgress(entries) {
  const total = entries.length;
  const measured = entries.filter(e => e.measured).length;
  return { total, measured, allMeasured: total > 0 && measured === total };
}
