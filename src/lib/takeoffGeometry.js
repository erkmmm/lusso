/**
 * Pure geometry helpers for placing takeoff lines accurately.
 *
 * Three snaps, applied in order of trust:
 *   1. an existing endpoint  — you meant to start where the last line ended
 *   2. the drawing's linework — the darkest pixel nearby is a wall face
 *   3. orthogonal            — plans are drawn on axes; a 1° skew is a slip
 *
 * Everything works in BASE coordinates (the page at scale 1), the same space
 * measurements are stored in, so a snap is zoom-independent.
 */

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Angle of a→b in degrees, 0 = east, positive clockwise (screen y grows down). */
export const angleOf = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/**
 * Constrain b so a→b lies on an axis (or a 45° diagonal when `diagonals`).
 * `threshold` degrees of slop; pass Infinity to force the snap.
 */
export function orthoConstrain(a, b, { threshold = 2.5, diagonals = false } = {}) {
  if (!a || !b) return b;
  const steps = diagonals ? 45 : 90;
  const ang = angleOf(a, b);
  const nearest = Math.round(ang / steps) * steps;
  if (Math.abs(ang - nearest) > threshold) return b;
  const len = dist(a, b);
  const rad = (nearest * Math.PI) / 180;
  return { x: a.x + Math.cos(rad) * len, y: a.y + Math.sin(rad) * len, snapped: 'ortho' };
}

/**
 * Nearest endpoint of an existing measurement, within `radius` base px.
 * Chaining off a shared corner is how a room gets measured without drift.
 */
export function snapToEndpoint(point, measurements, radius, { excludeId = null } = {}) {
  if (!point || !measurements?.length || !(radius > 0)) return null;
  let best = null;
  for (const m of measurements) {
    if (m.id === excludeId) continue;
    for (const p of [{ x: m.x1, y: m.y1 }, { x: m.x2, y: m.y2 }]) {
      const d = dist(point, p);
      if (d <= radius && (!best || d < best.d)) best = { ...p, d, snapped: 'endpoint' };
    }
  }
  return best;
}

/**
 * Pull a point onto the nearest dark pixel of the rendered page — i.e. onto the
 * linework. Plans draw walls as thin dark lines on white, so "darkest pixel
 * within a few px" is a reliable wall-face detector and removes the wobble of
 * placing a point by hand at 3 a.m. on a phone.
 *
 * `canvas` is the raster of the page; `rasterScale` and `dpr` convert base
 * coordinates into its backing-store pixels. Returns null when nothing nearby
 * is dark enough (i.e. you're out in whitespace, where there's nothing to snap
 * to and pretending otherwise would move the point somewhere wrong).
 */
export function snapToInk(point, canvas, { rasterScale = 1, dpr = 1, radiusBasePx = 5, threshold = 150 } = {}) {
  if (!point || !canvas) return null;
  const k = rasterScale * dpr;
  const r = Math.max(2, Math.round(radiusBasePx * k));
  const cx = Math.round(point.x * k);
  const cy = Math.round(point.y * k);
  const x0 = cx - r, y0 = cy - r, size = r * 2 + 1;
  if (x0 < 0 || y0 < 0 || x0 + size > canvas.width || y0 + size > canvas.height) return null;

  let data;
  try {
    data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, size, size).data;
  } catch {
    return null; // tainted or zero-sized canvas — snapping is optional
  }

  let best = null;
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const i = (iy * size + ix) * 4;
      // Perceived luminance; plans are greyscale linework so this is plenty.
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > threshold) continue;
      const dx = ix - r, dy = iy - r;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      // Prefer dark first, near second: a wall face beats a faint hatch.
      const score = lum + d * 12;
      if (!best || score < best.score) best = { score, dx, dy };
    }
  }
  if (!best) return null;
  return {
    x: (cx + best.dx) / k,
    y: (cy + best.dy) / k,
    snapped: 'ink',
  };
}

/**
 * The full snap pipeline for one candidate point.
 * `anchor` is the line's first point when drawing the second (enables ortho).
 */
export function resolveSnap(point, {
  anchor = null,
  measurements = [],
  canvas = null,
  rasterScale = 1,
  dpr = 1,
  viewScale = 1,
  forceOrtho = false,
  snapEnabled = true,
  excludeId = null,
} = {}) {
  if (!point) return point;
  // Snap radii are specified in SCREEN px and converted, so the tool feels the
  // same at every zoom level instead of grabbing half a room when zoomed out.
  const toBase = (screenPx) => screenPx / Math.max(viewScale, 0.0001);
  let out = { ...point, snapped: null };

  if (snapEnabled) {
    const ep = snapToEndpoint(point, measurements, toBase(12), { excludeId });
    if (ep) return { x: ep.x, y: ep.y, snapped: 'endpoint' };
  }

  if (anchor && (forceOrtho || snapEnabled)) {
    const o = orthoConstrain(anchor, out, { threshold: forceOrtho ? Infinity : 2.5 });
    if (o.snapped) out = { ...o };
  }

  if (snapEnabled && canvas) {
    const ink = snapToInk(out, canvas, { rasterScale, dpr, radiusBasePx: toBase(7) });
    if (ink) {
      // Re-apply ortho after the ink snap so a wall-face grab can't reintroduce
      // the skew the ortho lock just removed.
      if (anchor && forceOrtho) {
        const o = orthoConstrain(anchor, ink, { threshold: Infinity });
        return { x: o.x, y: o.y, snapped: 'ortho' };
      }
      return ink;
    }
  }
  return out;
}

/** Distance from a point to a line segment — used for hit-testing a measurement. */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// ── Multi-point measurements ────────────────────────────────────────────────
// A window is not always one straight run. Bay and splayed windows are two or
// three facets meeting at an angle; bow windows are a genuine curve. Measuring
// either with a single straight line reads the CHORD, which is shorter than the
// track that actually has to be made — so it under-orders every time.

/** Total length of a polyline, plus each leg on its own. */
export function polylineMetrics(points = []) {
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i]);
    segments.push(d);
    total += d;
  }
  return { segments, total, chord: points.length > 1 ? dist(points[0], points[points.length - 1]) : 0 };
}

/**
 * Circle through three points. Returns null when they're collinear (no unique
 * circle) — the caller falls back to treating the run as straight.
 */
export function circleFrom3Points(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

/**
 * Arc through start → via → end.
 *
 * `arcLength` is what the track and fabric are made to; `chord` is what a
 * straight measurement would have given you; `radius` is what the supplier bends
 * to. All three go on the order, which is why all three are returned.
 * Falls back to a straight line for three collinear points.
 */
export function arcMetrics(a, via, b) {
  const circle = circleFrom3Points(a, via, b);
  const chord = dist(a, b);
  if (!circle || !Number.isFinite(circle.r)) {
    return { straight: true, radius: null, arcLength: chord, chord, sweepDeg: 0 };
  }
  const { cx, cy, r } = circle;
  const ang = (p) => Math.atan2(p.y - cy, p.x - cx);
  const a0 = ang(a), aV = ang(via), a1 = ang(b);

  // Normalise so the sweep is the one that actually passes through `via` —
  // otherwise a shallow bow reads as the 300° major arc going the other way.
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccwFromStart = (t) => norm(t - a0);
  const sweepCcw = ccwFromStart(a1);
  const viaCcw = ccwFromStart(aV);
  const goesCcw = viaCcw <= sweepCcw;
  const sweep = goesCcw ? sweepCcw : 2 * Math.PI - sweepCcw;

  return {
    straight: false,
    cx, cy, radius: r,
    arcLength: r * sweep,
    chord,
    sweepDeg: (sweep * 180) / Math.PI,
    ccw: goesCcw,
    largeArc: sweep > Math.PI,
  };
}

/**
 * SVG path for an arc, in whatever space `toScreen` maps into.
 * Screen space never mirrors, so the sweep flag carries straight through.
 */
export function arcPathD(a, via, b, toScreen, viewScale = 1) {
  const m = arcMetrics(a, via, b);
  const p0 = toScreen(a), p1 = toScreen(b);
  if (m.straight || !(m.radius > 0)) return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
  const r = m.radius * viewScale;
  // SVG sweep-flag is 1 for a positive-angle (clockwise on screen) direction.
  const sweepFlag = m.ccw ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${m.largeArc ? 1 : 0} ${sweepFlag} ${p1.x} ${p1.y}`;
}

/** Midpoint of an arc — where its label goes. */
export function arcMidpoint(a, via, b) {
  const m = arcMetrics(a, via, b);
  if (m.straight || !(m.radius > 0)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ang = (p) => Math.atan2(p.y - m.cy, p.x - m.cx);
  const a0 = ang(a);
  const half = ((m.ccw ? 1 : -1) * (m.sweepDeg * Math.PI / 180)) / 2;
  return { x: m.cx + Math.cos(a0 + half) * m.radius, y: m.cy + Math.sin(a0 + half) * m.radius };
}

/** The stored points of any measurement, old or new. */
export const pointsOf = (m) =>
  (m?.points?.length ? m.points : [{ x: m.x1, y: m.y1 }, { x: m.x2, y: m.y2 }]);

// ── Bending a curve ─────────────────────────────────────────────────────────
// A curve is placed as its two ends and then BENT by dragging the middle. That
// keeps the interaction to one degree of freedom — how much bulge — which is
// the only thing you're actually judging by eye. Placing a third point freehand
// asks you to hit two things at once (position along the run AND depth), which
// is why it was hard to land accurately.

/**
 * Project `p` onto the perpendicular bisector of a→b.
 * Constraining the bend handle this way makes the arc symmetric, so dragging
 * moves the apex straight out from the chord instead of skewing the curve.
 */
export function projectToBisector(a, b, p) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return mid;
  const nx = -dy / len, ny = dx / len;      // unit normal to the chord
  const t = (p.x - mid.x) * nx + (p.y - mid.y) * ny;
  return { x: mid.x + nx * t, y: mid.y + ny * t, sagitta: t };
}

/** Signed bulge depth of the middle point away from the chord. */
export function sagittaOf(a, via, b) {
  return projectToBisector(a, b, via).sagitta ?? 0;
}

/** The apex point for a given signed bulge depth. */
export function viaForSagitta(a, b, sagitta) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return mid;
  const nx = -dy / len, ny = dx / len;
  return { x: mid.x + nx * sagitta, y: mid.y + ny * sagitta };
}

/**
 * The apex that produces a given radius, keeping the current bend direction.
 *
 * Sagitta from radius: h = r − √(r² − (c/2)²). A radius below half the chord
 * can't span the two ends at all, so it returns null and the caller can say so
 * rather than drawing something impossible.
 */
export function viaForRadius(a, b, radius, direction = 1) {
  const c = dist(a, b);
  const r = Math.abs(Number(radius) || 0);
  if (!(c > 0) || r < c / 2) return null;
  const h = r - Math.sqrt(Math.max(0, r * r - (c / 2) * (c / 2)));
  return viaForSagitta(a, b, h * (direction < 0 ? -1 : 1));
}

/** Smallest radius that can still span a chord — the floor for a radius input. */
export const minRadiusFor = (a, b) => dist(a, b) / 2;

/**
 * The apex expressed in the chord's own frame:
 *   `along` — how far it sits towards one end, as a fraction of the chord
 *             (0 = centred, ±0.5 = at an end). This is the skew.
 *   `depth` — how far it stands off the chord. This is the bow.
 *
 * Storing the apex this way is what lets an END move without dragging the
 * curve's shape around with it — the bow and the skew are preserved and the
 * arc is simply rebuilt against the new chord.
 */
export function chordFrame(a, b, via) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { along: 0, depth: 0 };
  const tx = dx / len, ty = dy / len;       // along the chord
  const nx = -ty, ny = tx;                  // perpendicular to it
  const vx = via.x - mid.x, vy = via.y - mid.y;
  return { along: (vx * tx + vy * ty) / len, depth: vx * nx + vy * ny };
}

/** Rebuild the apex from a chord frame. Inverse of `chordFrame`. */
export function viaFromFrame(a, b, { along = 0, depth = 0 } = {}) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return mid;
  const tx = dx / len, ty = dy / len;
  const nx = -ty, ny = tx;
  // Keep the apex clear of the ends, where three points stop defining a usable
  // circle and the arc degenerates.
  const k = clamp(along, -0.45, 0.45) * len;
  return { x: mid.x + tx * k + nx * depth, y: mid.y + ty * k + ny * depth };
}
