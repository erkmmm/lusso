/**
 * Attaching a plan takeoff to a quote.
 *
 * The customer quote page is anonymous — no login, no session — so it cannot
 * read the private takeoff bucket or run PDF.js over a plan set. So attaching
 * RENDERS the client view to flat images and stores those in a public bucket,
 * alongside a copy of the schedule.
 *
 * That it's a snapshot is the point, not a workaround: a quote should show the
 * plan it was priced against. If the takeoff changes afterwards — a revision
 * lands, a window is re-measured — the quote the customer is looking at doesn't
 * silently change underneath them. Re-attaching is a deliberate act.
 */
import { supabase } from './supabase';
import { loadPdf, getPageBaseSize, renderPageToCanvas } from './pdfRender';
import { downloadTakeoffPlan } from './takeoffStorage';
import { buildClientSchedule, colourFor } from './clientSchedule';
import { arcMetrics } from './takeoffGeometry';
import { QUOTE_PLAN_BUCKET as BUCKET, removeQuotePlan } from './quotePlanStorage';

// Re-exported so callers on the capture side have one import, not two.
export { removeQuotePlan };
const RENDER_SCALE = 2;          // 144 DPI — sharp on a retina phone, still small
const MAX_EDGE = 2600;           // a customer is not zooming into a 5000px sheet
const JPEG_QUALITY = 0.82;

/** Draw one page's coverings onto the rendered canvas. Mirrors the client view. */
function drawRuns(ctx, scale, entries, palette) {
  const S = (v) => v * scale;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const e of entries) {
    const pts = e.points && e.points.length > 1 ? e.points : null;
    if (!pts) continue;
    const colour = colourFor(palette, e.product);

    const trace = () => {
      ctx.beginPath();
      if (e.kind === 'arc' && pts.length === 3) {
        const a = arcMetrics(pts[0], pts[1], pts[2]);
        if (!a.straight && a.radius > 0) {
          const ang = (p) => Math.atan2(p.y - a.cy, p.x - a.cx);
          ctx.arc(S(a.cx), S(a.cy), S(a.radius), ang(pts[0]), ang(pts[2]), !a.ccw);
          return;
        }
      }
      ctx.moveTo(S(pts[0].x), S(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(S(pts[i].x), S(pts[i].y));
    };

    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 12;
    trace(); ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 6;
    trace(); ctx.stroke();

    endStop(ctx, S, pts[0], pts[1], colour);
    endStop(ctx, S, pts[pts.length - 1], pts[pts.length - 2], colour);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of entries) {
    if (!e.anchor) continue;
    const x = S(e.anchor.x), y = S(e.anchor.y);
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fillStyle = colourFor(palette, e.product);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 15px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(String(e.number), x, y + 0.5);
  }
  ctx.restore();
}

function endStop(ctx, S, p, towards, colour) {
  if (!p || !towards) return;
  const dx = towards.x - p.x, dy = towards.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const h = 10;
  const x1 = S(p.x) - nx * h, y1 = S(p.y) - ny * h;
  const x2 = S(p.x) + nx * h, y2 = S(p.y) + ny * h;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

const toBlob = (canvas) => new Promise((resolve) => {
  canvas.toBlob(b => resolve(b), 'image/jpeg', JPEG_QUALITY);
});

/**
 * Capture the takeoff for a quote.
 *
 * Only pages carrying coverings are rendered — a 40-sheet plan set with three
 * measured pages becomes three images, not forty.
 *
 * @returns the `planSnapshot` object to store on the quote.
 */
export async function captureQuotePlan(takeoff, quoteId, { showSizes = true, capturedBy = '' } = {}) {
  if (!supabase) throw new Error('Supabase not configured');
  if (!takeoff?.filePath) throw new Error('This job has no plan uploaded yet.');

  const schedule = buildClientSchedule(takeoff);
  if (!schedule.entries.length) throw new Error('Nothing marked up on the plan yet.');

  const buf = await downloadTakeoffPlan(takeoff.filePath);
  if (!buf) throw new Error('Could not load the plan file.');

  const pdf = await loadPdf(buf);
  const pageNumbers = [...new Set(schedule.entries.map(e => e.pageNumber))].filter(Boolean).sort((a, b) => a - b);
  const canvas = document.createElement('canvas');
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const pages = [];

  for (const pn of pageNumbers) {
    const base = await getPageBaseSize(pdf, pn);
    const scale = Math.min(RENDER_SCALE, MAX_EDGE / Math.max(base.width, base.height));
    await renderPageToCanvas(pdf, pn, scale, canvas, 1);
    drawRuns(canvas.getContext('2d'), scale, schedule.entries.filter(e => e.pageNumber === pn), schedule.palette);

    const blob = await toBlob(canvas);
    if (!blob) throw new Error('Could not render the plan page.');
    const path = `${quoteId}/${stamp}-p${pn}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    pages.push({
      pageNumber: pn,
      path,
      url: data?.publicUrl || '',
      width: canvas.width,
      height: canvas.height,
    });
  }

  return {
    takeoffId: takeoff.id,
    takeoffRevision: takeoff.revision || 1,
    fileName: takeoff.fileName || '',
    capturedAt: new Date().toISOString(),
    capturedBy,
    showSizes,
    pages,
    // The palette travels with the snapshot so the customer page's legend
    // matches the pins in the images, without recomputing anything.
    legend: [...schedule.palette.entries()].map(([product, colour]) => ({ product, colour })),
    schedule: schedule.entries.map(e => ({
      number: e.number,
      label: e.label,
      product: e.product,
      quantity: e.quantity,
      widthMm: e.totalWidthMm,
      dropMm: e.dropMm,
      shape: e.shape,
      measured: e.measured,
      pageNumber: e.pageNumber,
      colour: colourFor(schedule.palette, e.product),
    })),
  };
}

/** Has the takeoff moved on since this snapshot was taken? */
export function snapshotIsStale(snapshot, takeoff) {
  if (!snapshot || !takeoff) return false;
  if (snapshot.takeoffId !== takeoff.id) return true;
  if ((snapshot.takeoffRevision || 1) !== (takeoff.revision || 1)) return true;
  return Date.parse(takeoff.updatedAt || 0) > Date.parse(snapshot.capturedAt || 0);
}
