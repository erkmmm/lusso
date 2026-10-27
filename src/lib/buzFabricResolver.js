import CODES from '../data/buzRollCodes.json';

/**
 * Derive a BUZ INVENTORY CODE from a free-text Lusso fabric name.
 *
 * BUZ builds the code by concatenating the three dropdown tokens from its own
 * product form — group + brand + material type + colour — with no separators:
 *
 *   ROLL + M110 (Shaw) + T801 (Linesque Blockout) + B59 (Blanco)
 *     = ROLLM110T801B59
 *
 * src/data/buzRollCodes.json is those tokens, read off the live BUZ catalogue
 * (see docs/buz/). Lusso stores fabric as ONE free-text field ("vibe ice",
 * "Linesque Soba Blockout"), so getting to a code means matching that text back
 * to a (material type, colour) pair.
 *
 * The rule throughout: resolve only when the answer is unambiguous. A wrong
 * code orders the wrong fabric, which is worse than a blank the export already
 * knows how to report. Anything uncertain comes back as a reason, not a guess.
 */

// Words that describe a fabric's opacity rather than its range. They appear in
// BUZ's material-type names ("Linesque Blockout" vs "Linesque Light Filtering")
// and usually in the Lusso text too, so they disambiguate ranges that exist in
// more than one opacity — but only when the user actually typed one.
const OPACITY = [
  [/\b(block\s?out|b\s?\/\s?o|bo)\b/, 'blockout'],
  [/\b(light\s?filter(ing)?|lightfilter|l\s?\/\s?f|lf|privacy)\b/, 'lightfilter'],
  [/\b(sheer|voile)\b/, 'sheer'],
  [/\b(sun\s?screen|screen|mesh)\b/, 'screen'],
];

const opacityOf = (s) => {
  for (const [re, tag] of OPACITY) if (re.test(s)) return tag;
  return null;
};

/** Lowercase, drop punctuation and bracketed asides, collapse whitespace. */
const normalise = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')   // "(New)", "(Runout-Discontinued)", "(4.5m Left)"
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

const tokens = (s) => normalise(s).split(' ').filter(Boolean);

/** Material-type name minus its opacity words — the range itself ("linesque"). */
const coreTokens = (materialName) => {
  const t = tokens(materialName);
  const drop = new Set(['block', 'out', 'blockout', 'light', 'filtering', 'filter',
    'lightfilter', 'privacy', 'sheer', 'voile', 'screen', 'sunscreen', 'mesh',
    'fabric', 'b', 'o', 'l', 'f']);
  const core = t.filter((w) => !drop.has(w));
  return core.length ? core : t;   // never reduce a name to nothing
};

/**
 * Flattened catalogue: one entry per (brand, material type, colour), carrying
 * the tokens needed to match and the code to emit. Built once on first use.
 */
let INDEX = null;

const buildIndex = () => {
  const out = [];
  for (const [brandCode, brand] of Object.entries(CODES.brands)) {
    for (const [matCode, mat] of Object.entries(brand.m)) {
      const core = coreTokens(mat.n);
      const op = opacityOf(normalise(mat.n));
      for (const [colCode, colName] of mat.c) {
        const colTokens = tokens(colName);
        out.push({
          code: CODES.group + brandCode + matCode + colCode,
          brand: brand.n,
          material: mat.n,
          colour: colName,
          core,
          opacity: op,
          colourTokens: colTokens,
          coreJoined: core.join(''),
          colourJoined: colTokens.join(''),
        });
      }
    }
  }
  return out;
};

const index = () => (INDEX ||= buildIndex());

const containsAll = (hayTokens, needles) => needles.every((n) => hayTokens.includes(n));

/**
 * Word-boundary matching, then a de-spaced fallback: BUZ writes some ranges as
 * one word where people type two ("Kleenscreen" vs "Kleen screen"). The
 * fallback needs 5+ characters so a short range can't match inside an unrelated
 * word — and the caller requires range AND colour to match, so a stray hit on
 * one of them alone is not enough to produce a code.
 */
const matches = (hayTokens, hayJoined, needles, joined) =>
  containsAll(hayTokens, needles) || (joined.length >= 5 && hayJoined.includes(joined));

/**
 * Resolve free text to a BUZ inventory code.
 *
 * Returns one of:
 *   { code, brand, material, colour }                  — single confident match
 *   { code: '', reason: 'empty' }                      — nothing to resolve
 *   { code: '', reason: 'nomatch' }                    — no catalogue entry fits
 *   { code: '', reason: 'ambiguous', candidates: [] }  — several fit equally
 *
 * A match requires BOTH the range and the colour to appear in the text. Where
 * one range exists in several opacities, an opacity word in the text picks one;
 * without that word the result is ambiguous rather than a coin flip.
 */
export function deriveBuzInventoryCode(fabricText) {
  const t = tokens(fabricText);
  if (!t.length) return { code: '', reason: 'empty' };

  const wantOpacity = opacityOf(normalise(fabricText));

  const joined = t.join('');
  let hits = index().filter(
    (e) => matches(t, joined, e.core, e.coreJoined)
        && matches(t, joined, e.colourTokens, e.colourJoined),
  );
  if (!hits.length) return { code: '', reason: 'nomatch' };

  // An opacity word in the text is a filter, not a tiebreak: honour it before
  // scoring so "linesque soba blockout" can never land on a Light Filtering row.
  if (wantOpacity) {
    const byOpacity = hits.filter((e) => e.opacity === wantOpacity);
    if (byOpacity.length) hits = byOpacity;
  }

  // Prefer the most specific reading — the one explaining the most of the text.
  const score = (e) => e.core.length + e.colourTokens.length;
  const best = Math.max(...hits.map(score));
  hits = hits.filter((e) => score(e) === best);

  const codes = [...new Set(hits.map((e) => e.code))];
  if (codes.length > 1) {
    return {
      code: '',
      reason: 'ambiguous',
      candidates: hits.map((e) => ({
        code: e.code, brand: e.brand, material: e.material, colour: e.colour,
      })),
    };
  }

  const { code, brand, material, colour } = hits[0];
  return { code, brand, material, colour };
}

/** Every (brand, material, colour) the catalogue knows — for Settings/debug UI. */
export const buzCatalogueSize = () => index().length;

export const buzCatalogueMeta = () => ({
  group: CODES.group,
  capturedAt: CODES.capturedAt,
  brands: Object.keys(CODES.brands).length,
  combinations: index().length,
});
