/**
 * Checking a measured opening against what the supplier's spec sheet allows.
 *
 * This is the part of a spec sheet that a salesperson standing in a living room
 * can't be expected to remember, and the part that costs money when it's missed.
 * Two different failures, deliberately kept apart:
 *
 *   error   — the supplier will not make it. 3600mm on a blind that stops at
 *             3400 is a rejected order, found days later.
 *   warning — allowed, but the customer has to be told. Verosol join the fabric
 *             on anything over 2200mm wide, with a visible overlap down the
 *             middle. Nobody asks about that, which is exactly why it becomes a
 *             complaint and sometimes a remake.
 *
 * Every result names the document it came from, so the answer to "says who?" is
 * one tap away rather than an argument.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

const fmtMm = (n) => `${Math.round(n)}mm`;
const fmtM2 = (n) => `${Number(n.toFixed(2))}m²`;

/** Area in m² of one unit of a line (not multiplied by quantity — the supplier
 *  limit is per blind, not per order). */
export const lineAreaM2 = (widthMm, dropMm) =>
  widthMm && dropMm ? (widthMm / 1000) * (dropMm / 1000) : null;

/** Does a check's `when` clause apply to this line? No clause = always. */
function conditionMet(when, line) {
  if (!when) return true;
  if (when.spec) {
    // `spec` is the line-item field name (control, trackType, fixing, …).
    const v = line[when.spec];
    if (when.is   !== undefined) return eq(v, when.is);
    if (when.isNot!== undefined) return !eq(v, when.isNot);
    if (when.isSet!== undefined) return when.isSet ? !!String(v ?? '').trim() : !String(v ?? '').trim();
  }
  return true;
}

/**
 * One block of numeric bounds against the line. `bounds` may carry min/max
 * (inclusive limits) and `over` (an advisory threshold). Returns messages.
 */
function checkBounds({ bounds, value, label, unit, severity, message, source }) {
  if (!bounds || value === null) return [];
  const out = [];
  const fmt = unit === 'm2' ? fmtM2 : fmtMm;

  if (bounds.max !== undefined && bounds.max !== null && value > bounds.max) {
    out.push({
      severity, field: label.toLowerCase(),
      text: message || `${label} ${fmt(value)} is over the ${fmt(bounds.max)} maximum`,
      detail: message ? `${label} ${fmt(value)} · limit ${fmt(bounds.max)}` : null,
      source,
    });
  }
  if (bounds.min !== undefined && bounds.min !== null && value < bounds.min) {
    out.push({
      severity, field: label.toLowerCase(),
      text: message || `${label} ${fmt(value)} is under the ${fmt(bounds.min)} minimum`,
      detail: message ? `${label} ${fmt(value)} · minimum ${fmt(bounds.min)}` : null,
      source,
    });
  }
  if (bounds.over !== undefined && bounds.over !== null && value > bounds.over) {
    out.push({
      severity, field: label.toLowerCase(),
      text: message || `${label} is over ${fmt(bounds.over)}`,
      detail: message ? `${label} ${fmt(value)} · threshold ${fmt(bounds.over)}` : null,
      source,
    });
  }
  return out;
}

/**
 * Evaluate one line item against the limits on the documents that apply to it.
 *
 * `docs` are already scope-matched by the caller — this function does no lookups
 * and touches no storage, so it is safe to call for every line on every render.
 */
export function evaluateLine(line, docs = []) {
  if (!line) return [];
  const width = num(line.widthMm);
  const drop  = num(line.dropMm);
  const area  = lineAreaM2(width, drop);
  if (width === null && drop === null) return [];

  const results = [];

  for (const doc of docs) {
    const L = doc?.limits;
    if (!L) continue;
    const source = { id: doc.id, title: doc.title, supplier: doc.supplier };

    // Base bounds — always apply.
    results.push(...checkBounds({ bounds: L.widthMm, value: width, label: 'Width', severity: 'error', source }));
    results.push(...checkBounds({ bounds: L.dropMm,  value: drop,  label: 'Drop',  severity: 'error', source }));
    if (L.maxAreaM2 && area !== null && area > L.maxAreaM2) {
      results.push({
        severity: 'error', field: 'area',
        text: `Area ${fmtM2(area)} is over the ${fmtM2(L.maxAreaM2)} maximum`,
        detail: null, source,
      });
    }

    // Conditional and advisory checks.
    for (const c of L.checks || []) {
      if (!conditionMet(c.when, line)) continue;
      const severity = c.severity === 'warning' ? 'warning' : 'error';
      results.push(...checkBounds({ bounds: c.widthMm, value: width, label: 'Width', severity, message: c.message, source }));
      results.push(...checkBounds({ bounds: c.dropMm,  value: drop,  label: 'Drop',  severity, message: c.message, source }));
      if (c.maxAreaM2 && area !== null && area > c.maxAreaM2) {
        results.push({
          severity, field: 'area',
          text: c.message || `Area ${fmtM2(area)} is over the ${fmtM2(c.maxAreaM2)} maximum`,
          detail: c.message ? `Area ${fmtM2(area)} · limit ${fmtM2(c.maxAreaM2)}` : null,
          source,
        });
      }
    }
  }

  // Two sheets can state the same bound; say it once. Errors sort first.
  const seen = new Set();
  return results
    .filter(r => { const k = `${r.severity}|${r.text}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
}

/** A one-line summary of a document's limits, for the directory. */
export function summariseLimits(limits) {
  if (!limits) return null;
  const bits = [];
  const range = (b, label) => {
    if (!b || (b.min == null && b.max == null)) return null;
    if (b.min != null && b.max != null) return `${label} ${b.min}–${b.max}mm`;
    return b.max != null ? `${label} ≤${b.max}mm` : `${label} ≥${b.min}mm`;
  };
  const w = range(limits.widthMm, 'W'); if (w) bits.push(w);
  const d = range(limits.dropMm,  'D'); if (d) bits.push(d);
  if (limits.maxAreaM2) bits.push(`≤${limits.maxAreaM2}m²`);
  const n = (limits.checks || []).length;
  if (n) bits.push(`${n} rule${n !== 1 ? 's' : ''}`);
  return bits.length ? bits.join(' · ') : null;
}

/** True when a limits object actually states something worth saving. */
export const hasLimits = (l) =>
  !!l && (l.widthMm?.min != null || l.widthMm?.max != null ||
          l.dropMm?.min  != null || l.dropMm?.max  != null ||
          l.maxAreaM2 != null || (l.checks || []).length > 0);
