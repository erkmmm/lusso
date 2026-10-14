/**
 * Rotating a plan for viewing, without moving anything that was marked on it.
 *
 * Architects hand over drawings in whatever orientation the sheet happened to
 * be set up in — a floor plan sideways on an A1 landscape page is normal. You
 * cannot measure a window you are reading with your head tilted.
 *
 * The rule that makes this safe: rotation is a VIEW setting, never a change to
 * the data. Every measurement, marker and item stays stored in the page's own
 * unrotated base coordinates, exactly as it was. Rotating transforms the view,
 * not the record — so a plan can be rotated, un-rotated, and rotated again
 * after a hundred windows are marked up, and every mark stays on the window it
 * was put on. Nothing is ever rewritten, so nothing can be lost in the rewrite.
 *
 * Rotation is clockwise, matching PDF.js's own `rotation` viewport option, so
 * the rendered page and these transforms always agree.
 *
 *   base (stored)              view (displayed, rotation 90)
 *   ┌───────────────┐          ┌──────┐
 *   │A             B│          │ D  A │
 *   │               │   →      │      │
 *   │D             C│          │ C  B │
 *   └───────────────┘          └──────┘
 */

export const ROTATIONS = [0, 90, 180, 270];

/** Snap any angle to one of the four quarter turns, always 0–270. */
export const normRotation = (deg) =>
  (((Math.round((Number(deg) || 0) / 90) * 90) % 360) + 360) % 360;

export const nextRotation = (deg, dir = 1) => normRotation(normRotation(deg) + dir * 90);

/** True when the quarter turn swaps width and height. */
export const isQuarterTurned = (deg) => normRotation(deg) % 180 !== 0;

/** The page's size AS DISPLAYED at this rotation. `base` is the unrotated size. */
export const rotatedSize = (base, deg) => {
  if (!base) return base;
  return isQuarterTurned(deg)
    ? { width: base.height, height: base.width }
    : { width: base.width,  height: base.height };
};

/**
 * Stored page point → the point on screen.
 * `base` is the UNROTATED page size; rotation is clockwise.
 */
export const pageToView = (p, deg, base) => {
  if (!p) return p;
  switch (normRotation(deg)) {
    case 90:  return { ...p, x: base.height - p.y, y: p.x };
    case 180: return { ...p, x: base.width  - p.x, y: base.height - p.y };
    case 270: return { ...p, x: p.y,               y: base.width  - p.x };
    default:  return { ...p, x: p.x,               y: p.y };
  }
};

/** The inverse: a point picked on screen → the point to store. */
export const viewToPage = (p, deg, base) => {
  if (!p) return p;
  switch (normRotation(deg)) {
    case 90:  return { ...p, x: p.y,               y: base.height - p.x };
    case 180: return { ...p, x: base.width  - p.x, y: base.height - p.y };
    case 270: return { ...p, x: base.width - p.y,  y: p.x };
    default:  return { ...p, x: p.x,               y: p.y };
  }
};

/** Human label for the current rotation, for the button's tooltip. */
export const rotationLabel = (deg) => {
  const d = normRotation(deg);
  return d === 0 ? 'Not rotated' : `Rotated ${d}°`;
};
