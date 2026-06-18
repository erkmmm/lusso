import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { Download, Printer, FileText, Send, Loader } from 'lucide-react';
import { getMeasureSheet, getCustomer, getJob } from '../store/data';
import { sendPurchaseOrder } from '../lib/email';
import { toast } from '../components/ToastContainer';
import Card from '../components/Card';
import BackButton from '../components/BackButton';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECIPIENT_KEY = 'lusso_po_recipient';

// Uint8Array → base64 (chunked to avoid call-stack limits on large PDFs).
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ── Field helpers ─────────────────────────────────────────────────────────────
const isCurtain = (item) =>
  (item.productNameSnapshot || item.productType || '').toLowerCase().includes('curt');

const lining = (item) =>
  item.attachedLining ? (item.liningFabricColour || 'Yes') : 'Disabled';

// Column headers in the exact order of the example PO, with Motor side appended.
const PO_HEADERS = [
  '#', 'Location', 'Product', 'Quantity', 'Fabric', 'Width', 'x', 'Drop',
  'Control', 'Return side (L/R)', 'Operation type', 'Fixing', 'Heading',
  'Linning', 'Hem', 'Track color', 'Motor side (L/R)',
];

// Build the cells for one curtain row (motorSide overrides the stored value).
function rowCells(item, i, motorSide) {
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

export default function PurchaseOrder() {
  const { id } = useParams();

  const sheet = getMeasureSheet(id);
  const customer = sheet ? getCustomer(sheet.customerId) : null;
  const job = sheet?.jobId ? getJob(sheet.jobId) : null;

  const curtains = useMemo(
    () => (sheet?.lineItems || []).filter(isCurtain),
    [sheet],
  );

  // Per-order inputs
  const [supplier, setSupplier] = useState('');
  const [dateRequired, setDateRequired] = useState('');
  const [wandQty, setWandQty] = useState('');
  const [wandColour, setWandColour] = useState('');
  const [remotesQty, setRemotesQty] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [recipient, setRecipient] = useState(() => localStorage.getItem(RECIPIENT_KEY) || '');
  const [sending, setSending] = useState(false);

  // Per-line motor side, keyed by item id (defaults to the stored motorSide).
  const [motorSides, setMotorSides] = useState(() => {
    const init = {};
    curtains.forEach((it, i) => { init[it.id || i] = it.motorSide || ''; });
    return init;
  });
  const motorFor = (it, i) => motorSides[it.id || i] ?? '';
  const setMotor = (it, i, v) => setMotorSides(m => ({ ...m, [it.id || i]: v }));

  if (!sheet) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <BackButton fallback="/measure-sheets" />
        <p className="mt-6 text-slate-500">Measure sheet not found.</p>
      </div>
    );
  }

  const dateOrdered = format(new Date(), 'dd/MM/yyyy');
  const jobNumber = job?.jobNumber || '';
  const customerName = customer?.name || '';
  const fileBase = `Curtain PO - ${jobNumber || customerName || 'sheet'}`.replace(/[\\/:*?"<>|]/g, '');

  const rows = curtains.map((it, i) => rowCells(it, i, motorFor(it, i)));

  // ── XLSX export — mirrors the example PO cell positions ────────────────────
  const handleExport = () => {
    const FOOTER = 'Should you have any questions please call 0755284006 or email info@lusso.com.au - Adress 3 Crinum Cres Southport';
    const at = (index, value) => { const r = []; r[index] = value; return r; };

    const aoa = [];
    // Title (col 4, matching the example)
    aoa.push(at(4, 'Lusso Curtain PO sheet'));
    // Header labels + values (cols mirror the example header block)
    const lbl = []; lbl[4] = 'To'; lbl[5] = 'Job #'; lbl[7] = 'Customer'; lbl[9] = 'Date ordered'; lbl[11] = 'Date required'; lbl[14] = 'Page #';
    aoa.push(lbl);
    const val = []; val[4] = supplier; val[5] = jobNumber; val[7] = customerName; val[9] = dateOrdered; val[11] = dateRequired; val[14] = 1;
    aoa.push(val);
    aoa.push([]);
    // Column header row — '#' is the blank leading cell, then headers in col 1+
    aoa.push(['', ...PO_HEADERS.slice(1)]);
    // Data rows
    rows.forEach(r => aoa.push(r));
    aoa.push([]);
    // Per-order accessories
    aoa.push(['', 'Order accessories']);
    aoa.push(['', 'Wands', wandQty, wandColour]);
    aoa.push(['', 'Remotes', remotesQty]);
    aoa.push([]);
    // Extra notes
    aoa.push(['', 'Extra notes']);
    aoa.push(['', extraNotes]);
    aoa.push([]);
    aoa.push(['', 'Special instructions']);
    aoa.push(['', FOOTER]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Curtain PO');
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
  };

  // ── Print (hidden-iframe, reliable in tab + installed PWA) ─────────────────
  const handlePrint = () => {
    const node = document.getElementById('po-print');
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
  };

  // ── PDF (same PO data as the XLSX export) → base64 for the email attachment ─
  const buildPdfBase64 = async () => {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20);
    doc.text('LUSSO', 40, 42);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
    doc.text('Curtain Purchase Order', 40, 58);

    doc.setFontSize(9); doc.setTextColor(60);
    [
      `To: ${supplier || '—'}`,
      `Job #: ${jobNumber || '—'}    Customer: ${customerName || '—'}`,
      `Date ordered: ${dateOrdered}    Required: ${dateRequired || '—'}`,
    ].forEach((line, i) => doc.text(line, pageW - 40, 40 + i * 13, { align: 'right' }));

    autoTable(doc, {
      head: [PO_HEADERS],
      body: rows.map(r => r.map(c => (c === '' || c == null ? '' : String(c)))),
      startY: 78,
      margin: { left: 40, right: 40 },
      styles: { fontSize: 6.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [241, 241, 241], textColor: [40, 40, 40], fontStyle: 'bold' },
    });

    let y = (doc.lastAutoTable?.finalY || 78) + 22;
    doc.setFontSize(9); doc.setTextColor(40);
    doc.setFont('helvetica', 'bold'); doc.text('Order accessories', 40, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`Wands: ${wandQty || '0'}${wandColour ? ` × ${wandColour}` : ''}      Remotes: ${remotesQty || '0'}`, 40, y + 14);
    if (extraNotes) {
      doc.setFont('helvetica', 'bold'); doc.text('Extra notes', 40, y + 34);
      doc.setFont('helvetica', 'normal');
      doc.text(doc.splitTextToSize(extraNotes, pageW - 80), 40, y + 48);
    }
    doc.setFontSize(8); doc.setTextColor(140);
    doc.text('Should you have any questions please call 0755284006 or email info@lusso.com.au — Address 3 Crinum Cres Southport', 40, pageH - 24);

    return bytesToBase64(new Uint8Array(doc.output('arraybuffer')));
  };

  const handleSend = async () => {
    const to = recipient.trim();
    if (!EMAIL_RE.test(to)) { toast('Enter a valid recipient email address.', 'error'); return; }
    if (!curtains.length) { toast('No curtains to send.', 'error'); return; }
    setSending(true);
    try {
      const contentBase64 = await buildPdfBase64();
      await sendPurchaseOrder({
        to,
        subject: `Curtain Purchase Order${jobNumber ? ` – ${jobNumber}` : customerName ? ` – ${customerName}` : ''}`,
        message: `Hi,\n\nPlease find attached the curtain purchase order${jobNumber ? ` for job ${jobNumber}` : ''}${customerName ? ` (${customerName})` : ''}.\n\nThanks,\nLusso`,
        filename: `${fileBase}.pdf`,
        contentBase64,
      });
      localStorage.setItem(RECIPIENT_KEY, to);
      toast(`Purchase order sent to ${to}.`);
    } catch (err) {
      toast(err.message || 'Could not send the purchase order.', 'error');
    } finally {
      setSending(false);
    }
  };

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400';

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <BackButton fallback={`/measure-sheets/${id}`} />

      {/* Header + actions */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText size={18} /> Curtain Purchase Order
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {curtains.length} curtain{curtains.length !== 1 ? 's' : ''} from {customerName || 'this sheet'}
              {jobNumber ? ` · ${jobNumber}` : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap items-center justify-end">
            <input
              type="email"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="supplier@email.com"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button onClick={handleSend} disabled={sending || !curtains.length}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white">
              {sending ? <Loader size={13} className="animate-spin" /> : <Send size={13} />} Send PO
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
              <Printer size={13} /> Print
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
              <Download size={13} /> Export XLSX
            </button>
          </div>
        </div>
      </Card>

      {curtains.length === 0 ? (
        <Card><p className="p-8 text-center text-sm text-slate-400">This measure sheet has no curtain items to order.</p></Card>
      ) : (
        <>
          {/* Order details + accessories (per-order inputs) */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Order Details</h2>
            </div>
            <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">To (supplier)</span>
                <input className={inputCls} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier name" />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Date required</span>
                <input type="date" className={inputCls} value={dateRequired} onChange={e => setDateRequired(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Date ordered</span>
                <input className={inputCls} value={dateOrdered} disabled />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Wand quantity</span>
                <input type="number" min="0" className={inputCls} value={wandQty} onChange={e => setWandQty(e.target.value)} placeholder="0" />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Wand colour</span>
                <input className={inputCls} value={wandColour} onChange={e => setWandColour(e.target.value)} placeholder="e.g. White" />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Remotes (quantity)</span>
                <input type="number" min="0" className={inputCls} value={remotesQty} onChange={e => setRemotesQty(e.target.value)} placeholder="0" />
              </label>
              <label className="text-sm sm:col-span-2 lg:col-span-3">
                <span className="block text-xs text-slate-500 mb-1">Extra notes</span>
                <textarea rows={2} className={inputCls} value={extraNotes} onChange={e => setExtraNotes(e.target.value)} placeholder="Anything the supplier should know…" />
              </label>
            </div>
          </Card>

          {/* Editable motor side per curtain */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Motor side (per curtain)</h2>
              <p className="text-xs text-slate-400 mt-0.5">Set L or R for each curtain — this fills the Motor side column on the PO.</p>
            </div>
            <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {curtains.map((it, i) => (
                <div key={it.id || i} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2">
                  <span className="text-sm text-slate-700 truncate">{i + 1}. {it.location || '—'}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    {['L', 'R'].map(side => (
                      <button key={side} onClick={() => setMotor(it, i, motorFor(it, i) === side ? '' : side)}
                        className={`text-xs font-semibold w-8 py-1 rounded-md border transition-colors ${
                          motorFor(it, i) === side ? 'bg-amber-500 text-white border-amber-500' : 'text-slate-500 border-slate-200 hover:border-slate-300'
                        }`}>
                        {side}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* PO preview (printed/exported layout) */}
          <Card>
            <div id="po-print" className="p-5">
              {/* Header block */}
              <div className="flex items-start justify-between border-b-2 border-amber-500 pb-3 mb-4">
                <div>
                  <div className="text-lg font-bold text-amber-700">LUSSO</div>
                  <div className="text-xs text-slate-500">Curtain Purchase Order</div>
                </div>
                <div className="text-right text-xs text-slate-600 space-y-0.5">
                  <div><span className="text-slate-400">To:</span> {supplier || '—'}</div>
                  <div><span className="text-slate-400">Job #:</span> {jobNumber || '—'} · <span className="text-slate-400">Customer:</span> {customerName || '—'}</div>
                  <div><span className="text-slate-400">Date ordered:</span> {dateOrdered} · <span className="text-slate-400">Required:</span> {dateRequired || '—'}</div>
                </div>
              </div>

              {/* Line items table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      {PO_HEADERS.map(h => (
                        <th key={h} className="border border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((cell, ci) => (
                          <td key={ci} className="border border-slate-200 px-2 py-1.5 text-slate-700 whitespace-nowrap">{cell === '' || cell == null ? '' : cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Per-order accessories + notes */}
              <div className="grid sm:grid-cols-2 gap-4 mt-4 text-xs">
                <div>
                  <div className="font-semibold text-slate-700 mb-1">Order accessories</div>
                  <div className="text-slate-600">Wands: {wandQty || '0'}{wandColour ? ` × ${wandColour}` : ''}</div>
                  <div className="text-slate-600">Remotes: {remotesQty || '0'}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-700 mb-1">Extra notes</div>
                  <div className="text-slate-600 whitespace-pre-wrap">{extraNotes || '—'}</div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
                Should you have any questions please call 0755284006 or email info@lusso.com.au — Address 3 Crinum Cres Southport
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
