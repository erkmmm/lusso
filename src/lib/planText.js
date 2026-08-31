/**
 * Plan text-layer mining.
 *
 * Architectural PDFs are almost always vector drawings with a real text layer:
 * the room names, window tags and dimension strings are all extractable with
 * coordinates. That turns the two slowest parts of a takeoff into one tap each:
 *
 *   • labelling      — the nearest room name becomes the measurement's label
 *   • measuring      — a printed dimension near the line, within a few percent
 *                      of what you measured, is the draughtsman's own number,
 *                      so take it instead of the scaled one
 *
 * Everything here is a *suggestion*. Scanned (raster) plans return nothing and
 * the tool behaves exactly as it did before, so this can never block a takeoff.
 */
import { pdfjsLib } from './pdfRender';

// Room vocabulary. Matched as whole words so "BED 1", "Bed 1", "MASTER BED"
// and "ENS." all land, while "BEDHEAD DETAIL" (a note, not a room) does not.
const ROOM_WORDS = new Set([
  'bed', 'bedroom', 'beds', 'master', 'mstr', 'ensuite', 'ens', 'wir', 'wc',
  'bath', 'bathroom', 'powder', 'living', 'lounge', 'family', 'dining', 'meals',
  'kitchen', 'pantry', 'butler', 'butlers', 'laundry', 'study', 'office',
  'rumpus', 'media', 'theatre', 'theater', 'retreat', 'sitting', 'guest',
  'nursery', 'playroom', 'gym', 'store', 'storage', 'robe', 'hall', 'hallway',
  'entry', 'foyer', 'lobby', 'porch', 'verandah', 'veranda', 'alfresco', 'deck',
  'patio', 'balcony', 'terrace', 'courtyard', 'garage', 'carport', 'workshop',
  'void', 'stairs', 'stair', 'landing', 'linen', 'cellar', 'studio', 'sunroom',
  'conservatory', 'library', 'games', 'activity', 'parents',
]);

const DIM_PAIR_RE   = /(\d{3,5})\s*[x×X]\s*(\d{3,5})/;
const BARE_NUM_RE   = /^\d{3,5}$/;
const WINDOW_TAG_RE = /^(?:W|D|WD|SD|SGD|BD)\s?-?\s?\d{1,3}[A-Za-z]?$/;
// Text that looks like a room to the ALL-CAPS fallback but never is: title
// blocks, legends, and the annotations draughtsmen scatter over a floor plan.
// Every one of these was observed winning over a real room name on a live plan.
const NOISE_RE = new RegExp('^(?:' + [
  // title block / sheet furniture
  'scale', 'drawn', 'checked', 'date', 'rev\\b', 'revision', 'sheet', 'project',
  'client', 'drawing', 'dwg', 'job no', 'nts', 'n\\.t\\.s', 'north', 'issue',
  'amendment', 'approved', 'copyright', 'preliminary', 'subject', 'this document',
  'page scale', 'www\\.', 'do not',
  // plan annotations
  'refer', 'line of', 'roof over', 'roof\\b', 'opening', 'typical', 'similar',
  'detail', 'section', 'elevation', 'legend', 'note', 'boundary', 'setback',
  'easement', 'ffl', 'ngl', 'fall\\b', 'slope', 'ridge', 'gutter', 'downpipe',
  'smoke', 'hydrant', 'over\\b', 'below\\b', 'above\\b',
  // Dimensional and code annotations — "MIN. 1000 CLEAR", "NCC PART H8",
  // "AS1428". Never a room, and they crowd out the real names in the picker.
  'min\\.', 'max\\.', 'ncc\\b', 'as ?\\d{4}', 'part [a-z]\\d', 'clear\\b',
].join('|') + ')', 'i');

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

function classify(str) {
  const t = norm(str);
  if (!t || t.length > 48) return null;
  if (NOISE_RE.test(t)) return null;

  if (DIM_PAIR_RE.test(t)) {
    const [, a, b] = t.match(DIM_PAIR_RE);
    return { kind: 'dimPair', values: [Number(a), Number(b)] };
  }
  if (BARE_NUM_RE.test(t)) return { kind: 'number', values: [Number(t)] };
  if (WINDOW_TAG_RE.test(t)) return { kind: 'tag', values: [] };

  const words = t.toLowerCase().replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.some(w => ROOM_WORDS.has(w))) return { kind: 'room', values: [] };
  // Short ALL-CAPS strings on a plan are nearly always a space name.
  if (/^[A-Z][A-Z0-9 /'&.-]{2,22}$/.test(t) && /[A-Z]{3}/.test(t)) {
    return { kind: 'room', values: [], weak: true };
  }
  return null;
}

/**
 * Merge text runs that pdf.js split apart. "BED 1" frequently arrives as two
 * items; without stitching, the room index only ever sees "BED".
 */
function stitch(items) {
  const out = [];
  const byLine = new Map();
  for (const it of items) {
    // Bucket by baseline (rounded) and text angle so rotated labels don't merge
    // with horizontal ones running past them.
    const key = `${Math.round(it.angle / 15)}:${Math.round(it.y / 3)}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(it);
  }
  for (const line of byLine.values()) {
    line.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of line) {
      const gap = cur ? it.x - (cur.x + cur.width) : Infinity;
      // A gap under ~1.2 em is a space inside one label; wider is a new label.
      if (cur && gap >= -2 && gap < Math.max(6, cur.fontSize * 1.2)) {
        cur.str   = `${cur.str}${gap > cur.fontSize * 0.15 ? ' ' : ''}${it.str}`;
        cur.width = (it.x + it.width) - cur.x;
      } else {
        if (cur) out.push(cur);
        cur = { ...it };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * Extract and classify a page's text into base coordinates (the same space the
 * takeoff stores measurement endpoints in). Returns `{ rooms, numbers, tags }`,
 * each entry `{ str, x, y, width, fontSize, angle, values }` where x/y is the
 * centre of the text.
 */
export async function extractPageText(pdf, pageNumber) {
  const empty = { rooms: [], numbers: [], tags: [], all: [] };
  try {
    const pdfjs = await pdfjsLib();
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const raw = [];
    for (const item of content.items || []) {
      if (!item.str || !item.str.trim()) continue;
      // Text-space → device (base) space, so y already runs down the page.
      const m = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.hypot(m[2], m[3]) || 1;
      const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
      raw.push({
        str: item.str,
        x: m[4],
        y: m[5],
        width: item.width || item.str.length * fontSize * 0.5,
        fontSize,
        angle,
      });
    }
    if (!raw.length) return empty;

    const merged = stitch(raw);
    const out = { rooms: [], numbers: [], tags: [], all: [] };
    for (const it of merged) {
      const cls = classify(it.str);
      if (!cls) continue;
      const rad = (it.angle * Math.PI) / 180;
      // Centre of the run, stepping along the text direction then up off the
      // baseline by roughly a third of the cap height.
      const entry = {
        str: norm(it.str),
        x: it.x + Math.cos(rad) * (it.width / 2) + Math.sin(rad) * (it.fontSize * 0.35),
        y: it.y + Math.sin(rad) * (it.width / 2) - Math.cos(rad) * (it.fontSize * 0.35),
        width: it.width,
        fontSize: it.fontSize,
        angle: it.angle,
        kind: cls.kind,
        weak: !!cls.weak,
        values: cls.values,
      };
      out.all.push(entry);
      if (cls.kind === 'room') out.rooms.push(entry);
      else if (cls.kind === 'tag') out.tags.push(entry);
      else out.numbers.push(entry);
    }
    return out;
  } catch (e) {
    console.warn('[planText] extract failed', e);
    return empty;
  }
}

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

/**
 * Room labels nearest a point, closest first.
 *
 * A match on the room vocabulary ("BED 3", "ENSUITE") beats an ALL-CAPS guess
 * OUTRIGHT, rather than merely outweighing it. Weighting wasn't enough: a plan
 * annotation printed right on top of the window — "OPENING", "LINE OF ROOF
 * OVER" — sits closer than the room name in the middle of the floor, and won.
 * Weak matches are now only a fallback for when nothing real is in range.
 */
export function nearestRooms(index, point, { limit = 3, maxDist = 400 } = {}) {
  if (!index?.rooms?.length || !point) return [];
  const max2 = maxDist * maxDist;
  const inRange = index.rooms
    .map(r => ({ ...r, dist: Math.sqrt(dist2(r.x, r.y, point.x, point.y)) }))
    .filter(r => r.dist * r.dist <= max2)
    .sort((a, b) => a.dist - b.dist);

  const strong = inRange.filter(r => !r.weak);
  return (strong.length ? strong : inRange).slice(0, limit);
}

/** The single best room-label suggestion for a point, or ''. */
export function suggestLabel(index, point, opts) {
  const [best] = nearestRooms(index, point, { limit: 1, ...opts });
  return best ? best.str : '';
}

/** Window/door tags (W01, D3…) nearest a point. */
export function nearestTags(index, point, { limit = 2, maxDist = 180 } = {}) {
  if (!index?.tags?.length || !point) return [];
  return index.tags
    .map(t => ({ ...t, dist: Math.sqrt(dist2(t.x, t.y, point.x, point.y)) }))
    .filter(t => t.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

/**
 * Find the printed dimension a measured line is describing.
 *
 * The trick that makes this reliable: we only accept a printed number that is
 * already CLOSE to what was measured. A 1214 mm scaled read next to a printed
 * "1200" is the draughtsman's own figure; a "3600" three rooms away is not.
 * So a false positive can only ever move a measurement by a few percent — and
 * a correct hit replaces a scaled approximation with an exact dimension.
 *
 * Returns `{ value, printed, dist, deltaPercent }` or null.
 */
export function printedDimensionFor(index, { midpoint, measuredMm, pxPerMm, tolerance = 0.08, maxDist = 140 }) {
  if (!index?.numbers?.length || !midpoint || !(measuredMm > 0) || !(pxPerMm > 0)) return null;
  const maxPx = maxDist;
  let best = null;
  for (const n of index.numbers) {
    const d = Math.sqrt(dist2(n.x, n.y, midpoint.x, midpoint.y));
    if (d > maxPx) continue;
    for (const v of n.values) {
      if (!(v > 0)) continue;
      const delta = Math.abs(v - measuredMm) / measuredMm;
      if (delta > tolerance) continue;
      // Prefer the closest match, then the tightest agreement.
      const score = delta + (d / maxPx) * 0.05;
      if (!best || score < best.score) {
        best = { value: v, printed: n.str, dist: d, deltaPercent: delta * 100, score };
      }
    }
  }
  return best;
}

/**
 * All printed dimension pairs on the page, largest first — the raw material for
 * a "the plan says 1800 × 2100" hint when a whole window is placed.
 */
export function dimensionPairsNear(index, point, { maxDist = 200, limit = 3 } = {}) {
  if (!index?.numbers?.length || !point) return [];
  return index.numbers
    .filter(n => n.values.length === 2)
    .map(n => ({ ...n, dist: Math.sqrt(dist2(n.x, n.y, point.x, point.y)) }))
    .filter(n => n.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}
