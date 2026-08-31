/**
 * Annotated plan export.
 *
 * Burns the takeoff overlay into the plan and appends a window schedule, so the
 * measurements stop living only inside the app. That artifact is what gets
 * emailed to the builder, handed to the installer, or pulled up six months later
 * when someone asks where a dimension came from — and it's the only way to
 * check a takeoff without re-doing it.
 *
 * Pages are rasterised (not vector-overlaid) because that's what pdf.js gives
 * us cheaply and it guarantees the export looks exactly like the screen.
 */
import { loadPdf, getPageBaseSize, renderPageToCanvas } from './pdfRender';
import { pointsOf, arcMetrics, arcMidpoint } from './takeoffGeometry';

const RENDER_SCALE = 2;            // 144 DPI — legible when printed at A3
const MAX_CANVAS_EDGE = 5000;

const fmtMm = (mm) => (mm == null ? '—' : `${Math.round(mm)} mm`);

const TAG_COLOUR = {
  Width:  '#1d4ed8',
  Drop:   '#7c3aed',
  Height: '#7c3aed',
  Other:  '#475569',
};

/** Draw one page's measurements and markers onto an already-rendered canvas. */
function drawOverlay(ctx, scale, { measurements = [], markers = [], items = [] }) {
  const itemById = new Map(items.map(i => [i.id, i]));
  const S = (v) => v * scale;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const m of measurements) {
    const colour = TAG_COLOUR[m.tag] || TAG_COLOUR.Other;
    const pts = pointsOf(m);
    const isArc = m.kind === 'arc' && pts.length === 3;

    // A bay or a curve has to be drawn as what it is — an exported plan showing
    // a straight line across a bow window is a drawing of the wrong dimension.
    const trace = () => {
      ctx.beginPath();
      if (isArc) {
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

    // Halo underneath so the line reads over dark linework.
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6;
    trace(); ctx.stroke();

    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    trace(); ctx.stroke();

    // Ends get a ring; a bay's interior corners get a solid dot. An arc's middle
    // point is a construction handle, so it isn't drawn at all.
    pts.forEach((p, i) => {
      const interior = i > 0 && i < pts.length - 1;
      if (interior && isArc) return;
      ctx.beginPath();
      ctx.arc(S(p.x), S(p.y), interior ? 3.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = interior ? colour : '#fff';
      ctx.fill();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Per-facet numbers — each facet is usually its own blind on the order.
    if (m.kind === 'chain' && m.segments?.length > 1) {
      ctx.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      m.segments.forEach((seg, i) => {
        const cx = S((pts[i].x + pts[i + 1].x) / 2);
        const cy = S((pts[i].y + pts[i + 1].y) / 2);
        const t = String(Math.round(seg));
        const w = ctx.measureText(t).width + 10;
        ctx.fillStyle = 'rgba(15,23,42,0.88)';
        ctx.beginPath(); ctx.roundRect(cx - w / 2, cy + 4, w, 15, 3); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(t, cx, cy + 11.5);
      });
    }

    const item = m.itemId ? itemById.get(m.itemId) : null;
    const shape = m.kind === 'arc' && m.radiusMm ? ` (R${Math.round(m.radiusMm)})`
                : m.kind === 'chain' && m.segments?.length > 1 ? ` (${m.segments.length}-part)`
                : '';
    const label = [item?.label || m.label, fmtMm(m.lengthMm) + shape].filter(Boolean).join('  ');
    const anchor = isArc ? arcMidpoint(pts[0], pts[1], pts[2]) : longestLegMid(pts);
    const mx = S(anchor.x), my = S(anchor.y);
    ctx.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(mx - w / 2, my - 24, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, mx, my - 15);
  }

  for (const k of markers) {
    const x = S(k.x), y = S(k.y);
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(217,119,6,0.92)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(k.index ?? '•'), x, y);
  }

  ctx.restore();
}

/**
 * Build the annotated PDF.
 *
 * @param {ArrayBuffer} planBuffer  the original plan
 * @param {object} takeoff          the takeoff record
 * @param {object} meta             { jobNumber, customerName, siteAddress, preparedBy, productTypeName }
 * @returns {Promise<Blob>}
 */
export async function buildAnnotatedPlan(planBuffer, takeoff, meta = {}) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const pdf = await loadPdf(planBuffer);
  const measurements = takeoff?.measurements || [];
  const markers = takeoff?.markers || [];
  const items = takeoff?.items || [];

  // Only pages carrying work — a 40-sheet plan set with three measured pages
  // should export three pages.
  const pageNumbers = [...new Set([
    ...measurements.map(m => m.pageNumber),
    ...markers.map(k => k.pageNumber),
  ])].filter(Boolean).sort((a, b) => a - b);

  if (!pageNumbers.length) throw new Error('Nothing measured yet — nothing to export.');

  let doc = null;
  const canvas = document.createElement('canvas');

  for (const pn of pageNumbers) {
    const base = await getPageBaseSize(pdf, pn);
    const scale = Math.min(
      RENDER_SCALE,
      MAX_CANVAS_EDGE / Math.max(base.width, base.height)
    );
    await renderPageToCanvas(pdf, pn, scale, canvas, 1);
    const ctx = canvas.getContext('2d');
    drawOverlay(ctx, scale, {
      measurements: measurements.filter(m => m.pageNumber === pn),
      markers: markers.filter(k => k.pageNumber === pn),
      items,
    });

    const orientation = base.width >= base.height ? 'landscape' : 'portrait';
    const format = [base.width, base.height];
    if (!doc) doc = new jsPDF({ unit: 'pt', orientation, format });
    else doc.addPage(format, orientation);

    doc.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, base.width, base.height);

    // Provenance strip — an annotated plan with no scale on it is not evidence.
    const page = (takeoff.pages || []).find(p => p.pageNumber === pn);
    const stamp = [
      `Lusso plan takeoff`,
      meta.jobNumber ? `Job ${meta.jobNumber}` : '',
      meta.customerName || '',
      `Page ${pn}`,
      page?.pxPerMm ? `Scale ${page.scaleLabel || `1 mm = ${page.pxPerMm.toFixed(3)} px`}` : 'SCALE NOT SET',
      new Date().toLocaleDateString('en-AU'),
    ].filter(Boolean).join('  ·  ');
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.rect(8, base.height - 24, base.width - 16, 16, 'FD');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(stamp, 14, base.height - 13);
  }

  // ── Window schedule ──────────────────────────────────────────────────────
  if (items.length || measurements.length) {
    doc.addPage([595.28, 841.89], 'portrait');
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text('Window schedule', 40, 50);
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text([
      meta.customerName || '',
      meta.siteAddress || '',
      meta.jobNumber ? `Job ${meta.jobNumber}` : '',
    ].filter(Boolean).join('  ·  '), 40, 66);

    const rows = itemRows(takeoff);
    autoTable(doc, {
      startY: 82,
      head: [['#', 'Location', 'Product', 'Qty', 'Width', 'Drop', 'Page', 'Status']],
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 22 },
        3: { cellWidth: 28, halign: 'right' },
        4: { cellWidth: 52, halign: 'right' },
        5: { cellWidth: 52, halign: 'right' },
        6: { cellWidth: 32, halign: 'right' },
      },
    });

    const y = (doc.lastAutoTable?.finalY || 82) + 18;
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Dimensions marked "Plan estimate" are scaled from the drawing and must be check-measured on site before ordering.',
      40, y, { maxWidth: 515 }
    );
  }

  return doc.output('blob');
}

/** Midpoint of a polyline's longest leg — where a label has room to sit. */
function longestLegMid(pts) {
  if (pts.length < 2) return pts[0] || { x: 0, y: 0 };
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (!best || d > best.d) best = { d, a: pts[i - 1], b: pts[i] };
  }
  return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}

/** Flatten a takeoff into schedule rows (items first, then loose measurements). */
export function itemRows(takeoff) {
  const items = takeoff?.items || [];
  const measurements = takeoff?.measurements || [];
  const rows = [];
  let n = 0;

  for (const it of items) {
    const mine = measurements.filter(m => m.itemId === it.id);
    const widthM = mine.find(m => m.tag === 'Width');
    const dropM  = mine.find(m => m.tag === 'Drop' || m.tag === 'Height');
    const drop = it.dropMm !== '' && it.dropMm != null ? Number(it.dropMm) : dropM?.lengthMm;
    const widthCell = widthM == null ? '—'
      : widthM.kind === 'chain' && widthM.segments?.length > 1
        ? `${Math.round(widthM.lengthMm)} mm\n(${widthM.segments.map(v => Math.round(v)).join(' + ')})`
      : widthM.kind === 'arc'
        ? `${Math.round(widthM.lengthMm)} mm arc\nR${Math.round(widthM.radiusMm || 0)}`
        : `${Math.round(widthM.lengthMm)} mm`;
    rows.push([
      String(++n),
      it.label || '—',
      it.productNameSnapshot || '—',
      String(it.quantity || 1),
      widthCell,
      drop != null ? `${Math.round(drop)} mm` : '—',
      String(it.pageNumber || mine[0]?.pageNumber || '—'),
      it.status === 'measured' ? 'Check measured' : 'Plan estimate',
    ]);
  }

  for (const m of measurements.filter(m => !m.itemId)) {
    rows.push([
      String(++n),
      m.label || '—',
      '—',
      '1',
      m.tag === 'Width' ? `${Math.round(m.lengthMm)} mm` : '—',
      m.tag !== 'Width' ? `${Math.round(m.lengthMm)} mm` : '—',
      String(m.pageNumber || '—'),
      'Plan estimate',
    ]);
  }
  return rows;
}

// ── Client-facing export ────────────────────────────────────────────────────
// The same plan, but answering the customer's question instead of the
// workroom's. Numbered pins, product names, plain-English status — and none of
// the px-per-mm, radii or facet breakdowns that only mean something to whoever
// is placing the order.

/**
 * Draw each covering as the run it occupies, in its product colour, with a stop
 * tick at each end and its schedule number over the middle.
 *
 * The extent is the point: a customer checking their own plan can see that the
 * lounge blind reaches the corner and the ensuite one doesn't overlap the
 * shower — neither of which a dot near the window would tell them.
 */
function drawRuns(ctx, scale, entries, palette) {
  const S = (v) => v * scale;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const e of entries) {
    const pts = e.points && e.points.length > 1 ? e.points : null;
    if (!pts) continue;
    const colour = palette.get(e.product) || '#94a3b8';

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

  // Numbers last, so no run is drawn over its own label.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of entries) {
    if (!e.anchor) continue;
    const x = S(e.anchor.x), y = S(e.anchor.y);
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fillStyle = palette.get(e.product) || '#94a3b8';
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

/** A tick across the end of a run — "it stops here". */
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

/**
 * Build the customer's copy: the plan with numbered pins, then a schedule of
 * what goes where.
 *
 * @param {ArrayBuffer} planBuffer
 * @param {object} takeoff
 * @param {{entries: Array, palette: Map}} schedule  from buildClientSchedule
 * @param {object} meta  { jobNumber, customerName, siteAddress, businessName, showSizes }
 */
export async function buildClientPlan(planBuffer, takeoff, schedule, meta = {}) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const { entries = [], palette = new Map() } = schedule || {};
  if (!entries.length) throw new Error('Nothing marked up yet — nothing to show a client.');

  const pdf = await loadPdf(planBuffer);
  const pageNumbers = [...new Set(entries.map(e => e.pageNumber))].filter(Boolean).sort((a, b) => a - b);

  let doc = null;
  const canvas = document.createElement('canvas');

  for (const pn of pageNumbers) {
    const base = await getPageBaseSize(pdf, pn);
    const scale = Math.min(RENDER_SCALE, MAX_CANVAS_EDGE / Math.max(base.width, base.height));
    await renderPageToCanvas(pdf, pn, scale, canvas, 1);
    drawRuns(canvas.getContext('2d'), scale, entries.filter(e => e.pageNumber === pn), palette);

    const orientation = base.width >= base.height ? 'landscape' : 'portrait';
    if (!doc) doc = new jsPDF({ unit: 'pt', orientation, format: [base.width, base.height] });
    else doc.addPage([base.width, base.height], orientation);
    doc.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, base.width, base.height);
  }

  // ── Schedule ─────────────────────────────────────────────────────────────
  doc.addPage([595.28, 841.89], 'portrait');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Your window schedule', 40, 52);
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    [meta.customerName, meta.siteAddress, meta.jobNumber ? `Job ${meta.jobNumber}` : '']
      .filter(Boolean).join('  ·  '),
    40, 68
  );

  const measured = entries.filter(e => e.measured).length;
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    measured === entries.length
      ? 'All sizes below have been confirmed on site.'
      : `${measured} of ${entries.length} sizes have been confirmed on site. The rest are taken from the plan and will be checked before anything is ordered.`,
    40, 86, { maxWidth: 515 }
  );

  const showSizes = meta.showSizes !== false;
  const head = showSizes
    ? [['#', 'Room / opening', 'Product', 'Qty', 'Width', 'Drop', 'Status']]
    : [['#', 'Room / opening', 'Product', 'Qty', 'Status']];
  const body = entries.map(e => {
    const base = [
      String(e.number),
      [e.label, e.shape].filter(Boolean).join(' — '),
      e.product || 'To be confirmed',
      String(e.quantity || 1),
    ];
    const status = e.measured ? 'Measured on site' : 'From plan';
    return showSizes
      ? [...base, e.totalWidthMm ? `${e.totalWidthMm} mm` : '—', e.dropMm ? `${e.dropMm} mm` : '—', status]
      : [...base, status];
  });

  autoTable(doc, {
    startY: 104,
    head, body,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 24 }, 3: { cellWidth: 30, halign: 'right' } },
    // Colour the number cell to match its pin, so the table and the plan can be
    // read against each other at a glance.
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const e = entries[data.row.index];
      const hex = palette.get(e?.product) || '#94a3b8';
      data.cell.styles.fillColor = hexToRgb(hex);
      data.cell.styles.textColor = 255;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.halign = 'center';
    },
  });

  const y = (doc.lastAutoTable?.finalY || 104) + 20;
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    'Please check every room is listed and the products are what you expect. Anything missing or wrong is far easier to change now than after manufacture.',
    40, y, { maxWidth: 515 }
  );

  return doc.output('blob');
}

const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
