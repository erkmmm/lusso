/**
 * The purchase order document itself — one definition of what a PO says,
 * shared by the builder, the print/PDF/XLSX output and the history viewer.
 *
 * Everything here works off a SNAPSHOT: a plain, self-contained object holding
 * the rendered headers and rows plus the inputs behind them. That is what gets
 * stored against a sent order, so re-opening one from history reproduces the
 * exact document the supplier received — even after the measure sheet it came
 * from has been edited.
 */

import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { getLogoDataUrl, LOGO_ASPECT } from './brandLogo';

export const PO_FOOTER =
  'Should you have any questions please call 0755284006 or email info@lusso.com.au — Address 3 Crinum Cres Southport';
// The XLSX has always carried the plain-ASCII wording; kept as-is so the
// spreadsheet a supplier already has doesn't change shape.
const PO_FOOTER_XLSX =
  'Should you have any questions please call 0755284006 or email info@lusso.com.au - Adress 3 Crinum Cres Southport';

// Column headers in the exact order of the example PO, with Motor side appended.
export const PO_HEADERS = [
  '#', 'Location', 'Product', 'Quantity', 'Fabric', 'Width', 'x', 'Drop',
  'Control', 'Return side (L/R)', 'Operation type', 'Fixing', 'Heading',
  'Linning', 'Hem', 'Track color', 'Motor side (L/R)',
];
export const MOTOR_HEADER = 'Motor side (L/R)';

// Which measure-sheet lines belong on a curtain PO. Broader than "curt" so
// sheers and drapery (which never contain "curt") aren't silently excluded —
// the builder, the "Generate Purchase Order" button and the Orders tab all
// have to agree on this, or a sheet of sheers looks like it has nothing to
// order.
export const isCurtainLine = (item) => {
  const s = (item.productNameSnapshot || item.productType || '').toLowerCase();
  return s.includes('curt') || s.includes('sheer') || s.includes('drape');
};

const lining = (item) =>
  item.attachedLining ? (item.liningFabricColour || 'Yes') : 'Disabled';

// Build the cells for one curtain row (motorSide overrides the stored value).
export function rowCells(item, i, motorSide) {
  return [
    i + 1,
    item.location || '',
    'Curt',
    item.quantity || 1,
    item.fabricColour || '',
    item.widthMm || item.width || '',
    'x',
    item.dropMm || item.drop || '',
    item.control || '',
    item.returnSide || item.controlSide || '',
    item.trackType || '',
    item.fixing || item.mountType || '',
    item.heading || '',
    lining(item),
    item.hem || '',
    item.trackColour || item.trackBaseBarColour || '',
    motorSide || '',
  ];
}

// ── Accessory labels (blank fields are omitted) ───────────────────────────────
export const wandIsEmpty   = (w) => !w.qty && !w.colour && !w.length;
export const remoteIsEmpty = (r) => !r.qty && !r.type && !r.colour;
export const wandLabel     = (w) => [w.qty ? `${w.qty} ×` : '', w.colour, w.length ? `${w.length}mm` : ''].filter(Boolean).join(' ');
export const remoteLabel   = (r) => [r.qty ? `${r.qty} ×` : '', r.type, r.colour].filter(Boolean).join(' ');

// dateRequired is stored as 'YYYY-MM-DD' (from the date picker) or the literal
// 'ASAP'. This is what actually prints on the PO — dates shown AU-style.
export const formatDateRequired = (dateRequired) =>
  !dateRequired ? '' :
  dateRequired === 'ASAP' ? 'ASAP' :
  (() => { try { return format(parseISO(dateRequired), 'dd/MM/yyyy'); } catch { return dateRequired; } })();

/**
 * Freeze the current builder state into a storable PO document.
 *
 * `rows`/`headers` are the document as printed; `lineKeys` and `motorSides`
 * are the inputs, kept so the order can be re-opened and edited later.
 */
export function buildPoSnapshot({
  jobNumber = '', customerName = '', dateOrdered = '', dateRequired = '',
  headers = [], rows = [], showMotor = false, motorised = false,
  wands = [], remotes = [], extraNotes = '',
  lineKeys = [], motorSides = {}, recipient = '', message = '',
}) {
  return {
    v: 1,
    jobNumber, customerName,
    dateOrdered,
    dateRequired,
    dateRequiredDisplay: formatDateRequired(dateRequired),
    headers, rows,
    showMotor, motorised,
    wands: wands.filter(w => !wandIsEmpty(w)),
    remotes: remotes.filter(r => !remoteIsEmpty(r)),
    extraNotes,
    lineKeys, motorSides,
    recipient, message,
  };
}

export const snapshotHasAccessories = (snap) =>
  (snap?.wands?.length || 0) > 0 || (snap?.remotes?.length || 0) > 0;

export function poFileBase(snap) {
  const base = `Curtain PO - ${snap?.jobNumber || snap?.customerName || 'sheet'}`;
  return base.replace(/[\\/:*?"<>|]/g, '');
}

// ── XLSX export — mirrors the example PO cell positions ──────────────────────
export function exportPoXlsx(snap) {
  const at = (index, value) => { const r = []; r[index] = value; return r; };

  const aoa = [];
  // Title (col 4, matching the example)
  aoa.push(at(4, 'Lusso Curtain PO sheet'));
  // Header labels + values (cols mirror the example header block)
  const lbl = []; lbl[5] = 'Job #'; lbl[7] = 'Customer'; lbl[9] = 'Date ordered'; lbl[11] = 'Date required'; lbl[14] = 'Page #';
  aoa.push(lbl);
  const val = []; val[5] = snap.jobNumber; val[7] = snap.customerName; val[9] = snap.dateOrdered; val[11] = snap.dateRequiredDisplay; val[14] = 1;
  aoa.push(val);
  aoa.push([]);
  // Column header row — '#' is the blank leading cell, then headers in col 1+
  aoa.push(['', ...snap.headers.slice(1)]);
  snap.rows.forEach(r => aoa.push(r));
  aoa.push([]);
  // Per-order accessories — only populated entries; section omitted if empty.
  if (snapshotHasAccessories(snap)) {
    aoa.push(['', 'Order accessories']);
    snap.wands.forEach(w => aoa.push(['', 'Wand', w.qty, w.colour, w.length ? `${w.length}mm` : '']));
    snap.remotes.forEach(r => aoa.push(['', 'Remote', r.qty, r.type, r.colour]));
    aoa.push([]);
  }
  if ((snap.extraNotes || '').trim()) {
    aoa.push(['', 'Extra notes']);
    aoa.push(['', snap.extraNotes]);
    aoa.push([]);
  }
  aoa.push(['', 'Special instructions']);
  aoa.push(['', PO_FOOTER_XLSX]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Curtain PO');
  XLSX.writeFile(wb, `${poFileBase(snap)}.xlsx`);
}

// ── PDF (same PO data as the XLSX export) — used for download + email ────────
export async function buildPoPdf(snap) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Larger type throughout — the workroom teams read this on paper, so the
  // table is the biggest font that still fits all columns on landscape A4.
  const logo = await getLogoDataUrl();
  if (logo) {
    doc.addImage(logo, 'PNG', 24, 24, 22 * LOGO_ASPECT, 22);
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20);
    doc.text('LUSSO', 24, 42);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(90);
  doc.text('Curtain Purchase Order', 24, 60);

  doc.setFontSize(11); doc.setTextColor(60);
  [
    [snap.jobNumber && `Job #: ${snap.jobNumber}`, snap.customerName && `Customer: ${snap.customerName}`].filter(Boolean).join('    '),
    [`Date ordered: ${snap.dateOrdered}`, snap.dateRequiredDisplay && `Required: ${snap.dateRequiredDisplay}`].filter(Boolean).join('    '),
  ].filter(Boolean).forEach((line, i) => doc.text(line, pageW - 24, 42 + i * 15, { align: 'right' }));

  autoTable(doc, {
    head: [snap.headers],
    body: snap.rows.map(r => r.map(c => (c === '' || c == null ? '' : String(c)))),
    startY: 78,
    margin: { left: 24, right: 24 },
    styles: { fontSize: 10, cellPadding: 4, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [241, 241, 241], textColor: [40, 40, 40], fontStyle: 'bold', fontSize: 9 },
  });

  let y = (doc.lastAutoTable?.finalY || 78) + 24;
  doc.setFontSize(11); doc.setTextColor(40);
  if (snapshotHasAccessories(snap)) {
    doc.setFont('helvetica', 'bold'); doc.text('Order accessories', 24, y); y += 16;
    doc.setFont('helvetica', 'normal');
    snap.wands.forEach(w => { doc.text(`Wand: ${wandLabel(w)}`, 24, y); y += 15; });
    snap.remotes.forEach(r => { doc.text(`Remote: ${remoteLabel(r)}`, 24, y); y += 15; });
    y += 8;
  }
  if ((snap.extraNotes || '').trim()) {
    doc.setFont('helvetica', 'bold'); doc.text('Extra notes', 24, y); y += 16;
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(snap.extraNotes, pageW - 48), 24, y);
  }
  doc.setFontSize(9.5); doc.setTextColor(140);
  doc.text(PO_FOOTER, 24, pageH - 24);

  return doc;
}

// Uint8Array → base64 (chunked to avoid call-stack limits on large PDFs).
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Email needs the PDF as base64; download writes the file to the device.
export async function buildPoPdfBase64(snap) {
  return bytesToBase64(new Uint8Array((await buildPoPdf(snap)).output('arraybuffer')));
}

export async function downloadPoPdf(snap) {
  (await buildPoPdf(snap)).save(`${poFileBase(snap)}.pdf`);
}

// ── Print (hidden-iframe, reliable in tab + installed PWA) ───────────────────
export function printPoNode(nodeId = 'po-print') {
  const node = document.getElementById(nodeId);
  if (!node) { window.print(); return; }
  const prev = document.getElementById('__po_print_frame');
  if (prev) prev.remove();
  const iframe = document.createElement('iframe');
  iframe.id = '__po_print_frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const cw = iframe.contentWindow;
  cw.document.open();
  cw.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>Curtain PO</title>' +
    '<style>@page{margin:10mm} html,body{margin:0;padding:0;font-family:Arial,sans-serif;font-size:11px;color:#000}' +
    'table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;white-space:nowrap}' +
    'thead th{background:#f2f2f2}</style></head><body>' + node.innerHTML + '</body></html>'
  );
  cw.document.close();
  const cleanup = () => { const f = document.getElementById('__po_print_frame'); if (f) f.remove(); };
  const run = () => { try { cw.focus(); cw.onafterprint = cleanup; cw.print(); } catch { window.print(); cleanup(); } setTimeout(cleanup, 60000); };
  if (cw.document.readyState === 'complete') setTimeout(run, 50);
  else iframe.onload = () => setTimeout(run, 50);
}
