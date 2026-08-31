/**
 * Plan scale maths for the takeoff tool.
 *
 * A PDF page's base coordinates are PostScript points (1/72"), so the physical
 * size of the sheet is known exactly without measuring anything. If a drawing
 * was plotted to a stated ratio, that's all you need to derive px-per-mm:
 *
 *   1 base px = 25.4/72 mm of paper = (25.4/72) × ratio mm of building
 *   ⇒ pxPerMm = 72 / (25.4 × ratio)
 *
 * The wrinkle is that architects routinely issue an A1 drawing as an A3 PDF.
 * The title block still says 1:100 but the sheet has been shrunk, so the true
 * ratio is 100 × (A1 long edge ÷ A3 long edge). `effectiveRatio` handles that,
 * which is why the UI asks for BOTH "drawn at" and the detected sheet size.
 *
 * Two-point calibration remains the source of truth when a plan is unscaled,
 * cropped, or plotted "not to scale" — this module just removes the common case.
 */

const MM_PER_PT = 25.4 / 72;

/** ISO A series + the common imperial sheets, long edge first, in mm. */
export const PAPER_SIZES = [
  { name: 'A0',      long: 1189, short: 841 },
  { name: 'A1',      long: 841,  short: 594 },
  { name: 'A2',      long: 594,  short: 420 },
  { name: 'A3',      long: 420,  short: 297 },
  { name: 'A4',      long: 297,  short: 210 },
  { name: 'ARCH E',  long: 1219, short: 914 },
  { name: 'ARCH D',  long: 914,  short: 610 },
  { name: 'ARCH C',  long: 610,  short: 457 },
  { name: 'ARCH B',  long: 457,  short: 305 },
  { name: 'Tabloid', long: 432,  short: 279 },
  { name: 'Letter',  long: 279,  short: 216 },
];

/** Ratios worth offering as one tap. Architectural plans cluster hard here. */
export const SCALE_RATIOS = [20, 25, 50, 100, 200, 250, 500, 1000];

/** Base px (points) → mm of physical paper. */
export const ptToPaperMm = (pt) => pt * MM_PER_PT;

/**
 * The page's physical sheet size, long edge first.
 * Returns `{ longMm, shortMm, widthMm, heightMm, landscape }`.
 */
export function paperSizeOf(baseSize) {
  if (!baseSize) return null;
  const widthMm  = ptToPaperMm(baseSize.width);
  const heightMm = ptToPaperMm(baseSize.height);
  return {
    widthMm,
    heightMm,
    longMm:  Math.max(widthMm, heightMm),
    shortMm: Math.min(widthMm, heightMm),
    landscape: widthMm >= heightMm,
  };
}

/**
 * Best-matching standard sheet for a page. `tolerance` is how far off the long
 * edge may be (mm) and still count as that sheet — PDF writers round, and some
 * plans carry a few mm of bleed.
 */
export function detectPaperSize(baseSize, tolerance = 8) {
  const paper = paperSizeOf(baseSize);
  if (!paper) return null;
  let best = null;
  for (const p of PAPER_SIZES) {
    const delta = Math.abs(p.long - paper.longMm) + Math.abs(p.short - paper.shortMm);
    if (!best || delta < best.delta) best = { ...p, delta };
  }
  if (!best) return null;
  return {
    ...best,
    ...paper,
    exact: Math.abs(best.long - paper.longMm) <= tolerance
        && Math.abs(best.short - paper.shortMm) <= tolerance,
  };
}

/** px-per-mm for a plain ratio (no sheet resizing involved). */
export const pxPerMmForRatio = (ratio) => {
  const r = Number(ratio) || 0;
  return r > 0 ? 72 / (25.4 * r) : 0;
};

/**
 * True ratio once a "drawn at" sheet has been re-plotted onto the sheet the PDF
 * actually is. Shrinking A1→A3 halves the drawing, so the ratio doubles.
 * `drawnSheet` / `actualSheet` are entries from PAPER_SIZES (or anything with
 * a `long` in mm). Either missing ⇒ the ratio is used as-is.
 */
export function effectiveRatio(drawnRatio, drawnSheet, actualSheet) {
  const r = Number(drawnRatio) || 0;
  if (!(r > 0)) return 0;
  const from = Number(drawnSheet?.long) || 0;
  const to   = Number(actualSheet?.long) || Number(actualSheet?.longMm) || 0;
  if (!(from > 0) || !(to > 0)) return r;
  return r * (from / to);
}

/**
 * Everything the calibration dialog needs for one preset choice.
 * `pxPerMm` is what gets stored on the page; the rest is explanatory.
 */
export function scaleFromPreset({ baseSize, ratio, drawnSheetName }) {
  const actual = detectPaperSize(baseSize);
  const drawn  = PAPER_SIZES.find(p => p.name === drawnSheetName) || null;
  const eff    = drawn && actual && drawn.name !== actual.name
    ? effectiveRatio(ratio, drawn, actual)
    : Number(ratio) || 0;
  const pxPerMm = pxPerMmForRatio(eff);
  return {
    pxPerMm,
    ratio: Number(ratio) || 0,
    effectiveRatio: eff,
    resized: !!(drawn && actual && drawn.name !== actual.name),
    actualSheet: actual,
    drawnSheet: drawn,
    // How wide the whole sheet is in building terms — the sanity check that
    // catches a wrong preset instantly ("my house isn't 168 m across").
    sheetCoversMm: baseSize && pxPerMm > 0 ? baseSize.width / pxPerMm : 0,
  };
}

/** Nearest ratio to a measured pxPerMm, for "this looks like 1:100" hints. */
export function nearestRatio(pxPerMm) {
  if (!(pxPerMm > 0)) return null;
  const ratio = 72 / (25.4 * pxPerMm);
  let best = null;
  for (const r of SCALE_RATIOS) {
    const err = Math.abs(r - ratio) / r;
    if (!best || err < best.err) best = { ratio: r, err };
  }
  return best && best.err <= 0.04 ? best.ratio : null;
}

// ── Plausibility ────────────────────────────────────────────────────────────
// Bad calibration is the single most expensive mistake in a takeoff: every
// number is wrong by the same factor and nothing about the plan looks off. The
// ranges below are deliberately wide — they only catch order-of-magnitude
// errors (a 1:100 plan calibrated as 1:1000), not unusual-but-real windows.

export const PLAUSIBLE = {
  Width:  { min: 200,  max: 6000,  soft: 4000 },
  Drop:   { min: 200,  max: 4000,  soft: 3300 },
  Height: { min: 200,  max: 4000,  soft: 3300 },
  Other:  { min: 10,   max: 60000, soft: 60000 },
};

/**
 * Classify one measurement's length. `hard` means it can't be a window opening
 * at all; `soft` means unusual enough to be worth a second look.
 */
export function plausibility(tag, lengthMm) {
  const range = PLAUSIBLE[tag] || PLAUSIBLE.Other;
  const mm = Number(lengthMm) || 0;
  if (mm < range.min || mm > range.max) return 'hard';
  if (mm > range.soft) return 'soft';
  return 'ok';
}

/** Common door leaf widths — the fastest independent check of a page's scale. */
export const DOOR_WIDTHS = [720, 770, 820, 870, 920];

/**
 * Compare a measured door against the standard leaf widths.
 * Returns the closest standard, the % error, and the ratio the scale would need
 * to be corrected by — so the dialog can offer "fix the scale to match".
 *
 * `correctable` is the important one. The leaf widths sit ~6% apart, so "nearest
 * standard" only identifies a specific door while the reading is already close
 * to one. A grossly wrong scale (a 1:100 plan calibrated as 1:1000) measures a
 * door at 8700 mm, where 920 ranks nearer than 870 — snapping to it would leave
 * the page quietly 5.7% out, which is far worse than being obviously 10× out.
 * So beyond CORRECTABLE_ERROR we report the scale as wrong and refuse to guess.
 */
const CORRECTABLE_ERROR = 0.15;

export function checkAgainstDoor(measuredMm) {
  const mm = Number(measuredMm) || 0;
  if (!(mm > 0)) return null;
  let best = null;
  for (const w of DOOR_WIDTHS) {
    const err = Math.abs(w - mm) / w;
    if (!best || err < best.err) best = { standard: w, err };
  }
  return {
    ...best,
    errorPercent: best.err * 100,
    correction: best.standard / mm,   // multiply pxPerMm by 1/correction to fix
    ok: best.err <= 0.05,
    correctable: best.err > 0.05 && best.err <= CORRECTABLE_ERROR,
  };
}
