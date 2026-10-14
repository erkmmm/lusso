/**
 * Rotation must be perfectly reversible, or markup drifts off the windows it
 * was placed on. These check the round trip, the corners, and the invariants.
 */
import {
  normRotation, nextRotation, isQuarterTurned, rotatedSize, pageToView, viewToPage,
} from '../src/lib/planRotate.js';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const base = { width: 1000, height: 600 };   // a landscape A1-ish sheet
const xy = (p) => ({ x: p.x, y: p.y });

t('normRotation wraps',        [normRotation(0), normRotation(360), normRotation(-90), normRotation(450)], [0, 0, 270, 90]);
t('normRotation snaps',        [normRotation(89), normRotation('180'), normRotation(undefined)], [90, 180, 0]);
t('nextRotation cycles cw',    [0,90,180,270].map(d => nextRotation(d, 1)), [90, 180, 270, 0]);
t('nextRotation cycles ccw',   [0,90,180,270].map(d => nextRotation(d, -1)), [270, 0, 90, 180]);
t('quarter turns swap',        [0,90,180,270].map(isQuarterTurned), [false, true, false, true]);
t('rotatedSize 0',             rotatedSize(base, 0),   { width: 1000, height: 600 });
t('rotatedSize 90',            rotatedSize(base, 90),  { width: 600, height: 1000 });
t('rotatedSize 180',           rotatedSize(base, 180), { width: 1000, height: 600 });
t('rotatedSize 270',           rotatedSize(base, 270), { width: 600, height: 1000 });

// Corners, rotating clockwise. A=top-left, B=top-right, C=bottom-right, D=bottom-left.
const A = { x: 0, y: 0 }, B = { x: 1000, y: 0 }, C = { x: 1000, y: 600 }, D = { x: 0, y: 600 };
t('90: A top-left → top-right',    xy(pageToView(A, 90, base)), { x: 600, y: 0 });
t('90: B top-right → bottom-right',xy(pageToView(B, 90, base)), { x: 600, y: 1000 });
t('90: C → bottom-left',           xy(pageToView(C, 90, base)), { x: 0, y: 1000 });
t('90: D → top-left',              xy(pageToView(D, 90, base)), { x: 0, y: 0 });
t('180: A → bottom-right',         xy(pageToView(A, 180, base)), { x: 1000, y: 600 });
t('270: A → bottom-left',          xy(pageToView(A, 270, base)), { x: 0, y: 1000 });

// The property that actually matters: round trip is exact, for every rotation.
const pts = [A, B, C, D, { x: 1, y: 599 }, { x: 999, y: 1 }, { x: 500, y: 300 }, { x: 123.456, y: 78.9 }];
let roundTripOk = true;
for (const d of [0, 90, 180, 270]) {
  for (const p of pts) {
    const back = viewToPage(pageToView(p, d, base), d, base);
    if (Math.abs(back.x - p.x) > 1e-9 || Math.abs(back.y - p.y) > 1e-9) roundTripOk = false;
  }
}
t('round trip is exact at every rotation', roundTripOk, true);

// Rotation is rigid: distances (and therefore every measurement) are unchanged.
const d2 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
let rigid = true;
for (const deg of [0, 90, 180, 270]) {
  for (let i = 0; i < pts.length - 1; i++) {
    const before = d2(pts[i], pts[i + 1]);
    const after  = d2(pageToView(pts[i], deg, base), pageToView(pts[i + 1], deg, base));
    if (Math.abs(before - after) > 1e-9) rigid = false;
  }
}
t('distances are preserved — measurements cannot change', rigid, true);

// Every rotated point must land inside the rotated page.
let inside = true;
for (const deg of [0, 90, 180, 270]) {
  const s = rotatedSize(base, deg);
  for (const p of pts) {
    const v = pageToView(p, deg, base);
    if (v.x < -1e-9 || v.y < -1e-9 || v.x > s.width + 1e-9 || v.y > s.height + 1e-9) inside = false;
  }
}
t('rotated points stay inside the rotated page', inside, true);

// Four quarter turns must return the original exactly.
let fourTurns = pts[7];
for (let i = 0; i < 4; i++) fourTurns = pageToView(fourTurns, 90, rotatedSize(base, i * 90));
// Tolerance, not equality: four turns is four subtractions and float noise is
// expected. Sub-micron on a page measured in millimetres is not a drift.
t('four 90° turns return the original',
  Math.abs(fourTurns.x - pts[7].x) < 1e-9 && Math.abs(fourTurns.y - pts[7].y) < 1e-9, true);

// Extra fields on a point (ids, snap flags) must survive the transform.
t('extra fields carry through', pageToView({ x: 10, y: 20, id: 'p1', snap: 'end' }, 90, base),
  { x: 580, y: 10, id: 'p1', snap: 'end' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
