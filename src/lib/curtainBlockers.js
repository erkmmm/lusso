/**
 * Why a curtain on a quote can't be priced, and where to go and fix it.
 *
 * The calculator already knows — it returns a warning for every reason it
 * fell back to $0. What it could not do is say where the missing thing lives:
 * a drop belongs on the measure sheet, a heading nobody has rated belongs on
 * the rate card, an unknown fabric belongs in the price library. Without that
 * the builder showed a blank cost and left you to work out which of three
 * screens to open.
 *
 * Every reason routes somewhere. A reason that did not would be the one that
 * left someone stuck.
 */

/** Where each warning code is fixed. `onLine` means it is editable right here. */
const ROUTES = {
  'no-width':               { what: 'No width recorded',        where: 'sheet',   onLine: true },
  'no-drop':                { what: 'No drop recorded',         where: 'sheet',   onLine: true },
  'no-heading':            { what: 'No heading chosen',         where: 'sheet',   onLine: true },
  'no-track-type':         { what: 'No track type chosen',      where: 'sheet',   onLine: true },
  'no-fabric-price':       { what: 'No price for this fabric',  where: 'library' },
  'unknown-heading':       { what: 'Heading has no making rate', where: 'rates' },
  'unknown-lining-heading': { what: 'Lining heading has no making rate', where: 'rates' },
  'unknown-track-type':    { what: 'Track type is not on the rate card', where: 'rates' },
  'track-over-max':        { what: 'Track is not priced this wide', where: 'rates' },
};

const DESTINATIONS = {
  rates:   { label: 'Curtain rate card', href: '/settings?section=curtains' },
  library: { label: 'Price library',     href: '/settings?section=pricing' },
};

/**
 * @param {Array}  warnings        `result.warnings` from calcCurtain
 * @param {Object} opts
 * @param {string} opts.measureSheetId  the sheet this line came from, if known
 * @returns {Array<{code, what, detail, fixLabel, href, onLine}>}
 */
export function curtainBlockers(warnings = [], { measureSheetId } = {}) {
  const seen = new Set();
  const out = [];
  for (const w of warnings) {
    // Tolerate the old string form: a quote saved before warnings carried
    // codes should still say something rather than nothing.
    const code = typeof w === 'string' ? null : w?.code;
    const message = typeof w === 'string' ? w : w?.message;
    const route = code && ROUTES[code];
    if (!route) {
      if (message && !seen.has(message)) { seen.add(message); out.push({ code: code || 'other', what: message, detail: '', fixLabel: '', href: '', onLine: true }); }
      continue;
    }
    if (seen.has(code)) continue;
    seen.add(code);

    let fixLabel = '';
    let href = '';
    if (route.where === 'sheet') {
      // The sheet is the source of truth for a measurement, but the line here
      // is editable too — so offer the sheet only when we know which one.
      if (measureSheetId) { fixLabel = 'Open the measure sheet'; href = `/measure-sheets/${measureSheetId}/edit`; }
    } else {
      const d = DESTINATIONS[route.where];
      fixLabel = `Open the ${d.label.toLowerCase()}`;
      href = d.href;
    }

    out.push({
      code,
      what: route.what,
      detail: w.heading || w.trackType
        ? `“${w.heading || w.trackType}”${w.maxMm ? ` — priced to ${w.maxMm}mm` : ''}`
        : '',
      fixLabel,
      href,
      onLine: !!route.onLine,
    });
  }
  return out;
}

/** One line summarising why, for a collapsed row. */
export const blockerSummary = (blockers = []) =>
  blockers.length === 0 ? ''
    : blockers.length === 1 ? blockers[0].what
    : `${blockers[0].what} +${blockers.length - 1} more`;
