import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { format, addDays, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { Download, Printer, FileText, Send, Loader, Save, Trash2, Plus, ChevronDown } from 'lucide-react';
import {
  getMeasureSheet, getCustomer, getJob,
  getPoPresets, getPoPresetForEmail, savePoPreset, deletePoPreset,
  addActivity, advanceJobStatus,
} from '../store/data';
import { getLogoDataUrl, LOGO_ASPECT } from '../lib/brandLogo';
import { useProfile } from '../contexts/UserProfileContext';
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

// ── Accessory helpers (blank entries / fields are omitted from the PO) ─────────
const wandIsEmpty   = (w) => !w.qty && !w.colour && !w.length;
const remoteIsEmpty = (r) => !r.qty && !r.type && !r.colour;
const wandLabel     = (w) => [w.qty ? `${w.qty} ×` : '', w.colour, w.length ? `${w.length}mm` : ''].filter(Boolean).join(' ');

// Wands required per curtain, keyed by Control code. Most specific code first
// so "C/O F/R" isn't caught by "C/O" or "F/R".
// Keys are letters-only so every notation matches: FR / F/R, C/O-FR / C/O F/R,
// C/O / CO, etc. Most specific first so C/O-FR isn't caught by C/O or F/R.
const WAND_RULES = [
  { code: 'COFR', wands: 4 },
  { code: 'CO',   wands: 2 },
  { code: 'FR',   wands: 2 },
  { code: 'LHS',  wands: 1 },
  { code: 'RHS',  wands: 1 },
];
const normOp = (op) => String(op || '').toUpperCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
const opKey  = (op) => String(op || '').toUpperCase().replace(/[^A-Z]/g, ''); // letters only
function wandsForOp(op) {
  const k = opKey(op);
  if (!k) return 0;
  for (const r of WAND_RULES) if (k === r.code) return r.wands;      // exact
  for (const r of WAND_RULES) if (k.includes(r.code)) return r.wands; // tolerant of extra text
  return 0;
}
const remoteLabel   = (r) => [r.qty ? `${r.qty} ×` : '', r.type, r.colour].filter(Boolean).join(' ');

export default function PurchaseOrder() {
  const { id } = useParams();
  const { displayName = '' } = useProfile() || {};

  const sheet = getMeasureSheet(id);
  const customer = sheet ? getCustomer(sheet.customerId) : null;
  const job = sheet?.jobId ? getJob(sheet.jobId) : null;

  const dateOrdered = format(new Date(), 'dd/MM/yyyy');
  const jobNumber = job?.jobNumber || '';
  const customerName = customer?.name || '';
  const fileBase = `Curtain PO - ${jobNumber || customerName || 'sheet'}`.replace(/[\\/:*?"<>|]/g, '');
  const defaultMessage = `Hi,\n\nPlease find attached the curtain purchase order${jobNumber ? ` for job ${jobNumber}` : ''}${customerName ? ` (${customerName})` : ''}.\n\nThanks,\nLusso`;

  const allCurtains = useMemo(
    () => (sheet?.lineItems || []).filter(isCurtain).map((it, i) => ({ ...it, _key: it.id || `idx-${i}` })),
    [sheet],
  );

  // Which line items go on THIS order — some curtains may go to a different
  // supplier, or the customer didn't proceed with all of them. Excluded by
  // key, so a fresh order includes everything by default.
  const [excludedKeys, setExcludedKeys] = useState(() => new Set());
  const curtains = useMemo(
    () => allCurtains.filter(c => !excludedKeys.has(c._key)),
    [allCurtains, excludedKeys],
  );
  const toggleCurtain = (key) => setExcludedKeys(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Split-across-suppliers flow: keys already put on a PO this session (sent,
  // downloaded or printed). Whatever's left over can be carried into a fresh
  // order in one tap without re-ticking.
  const [orderedKeys, setOrderedKeys] = useState(() => new Set());
  const [nextDismissed, setNextDismissed] = useState(false);
  const markOrdered = () => {
    setOrderedKeys(prev => new Set([...prev, ...curtains.map(c => c._key)]));
    setNextDismissed(false); // re-arm the carry-over prompt for the new leftover
  };
  const remaining = allCurtains.filter(c => !orderedKeys.has(c._key));
  const startNextPO = () => {
    // Keep only the not-yet-ordered curtains selected.
    setExcludedKeys(new Set(orderedKeys));
    setRecipient('');
    setNextDismissed(true); // those items are now selected — hide the prompt until the next order
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`Next order started — ${remaining.length} remaining curtain${remaining.length !== 1 ? 's' : ''} selected.`);
  };

  // Per-order inputs
  const [dateRequired, setDateRequired] = useState('');
  const [extraNotes, setExtraNotes] = useState('');

  // Repeatable accessory entries (hidden until added; blanks omitted from PO).
  const [wands, setWands] = useState([]);     // { id, qty, colour, length }
  const [remotes, setRemotes] = useState([]); // { id, qty, type, colour }
  const addWand    = () => setWands(w => [...w, { id: uuidv4(), qty: '', colour: '', length: '' }]);
  const updateWand = (id, f, v) => setWands(w => w.map(x => x.id === id ? { ...x, [f]: v } : x));
  const removeWand = (id) => setWands(w => w.filter(x => x.id !== id));

  // Wands required from the curtains' Control codes (F/R, LHS, RHS, C/O…), × line qty.
  const wandCalc = useMemo(() => {
    const byCode = {};
    let total = 0, unmatched = 0;
    curtains.forEach(c => {
      const per = wandsForOp(c.control);
      const qty = Math.max(1, Number(c.quantity) || 1);
      if (per <= 0) { if (c.control) unmatched += 1; return; }
      const code = normOp(c.control);
      byCode[code] = byCode[code] || { count: 0, wands: 0 };
      byCode[code].count += qty;
      byCode[code].wands += per * qty;
      total += per * qty;
    });
    return { total, byCode, unmatched };
  }, [curtains]);

  const addSuggestedWands = () => setWands(w => [...w, { id: uuidv4(), qty: String(wandCalc.total), colour: '', length: '' }]);
  const addRemote    = () => setRemotes(r => [...r, { id: uuidv4(), qty: '', type: '', colour: '' }]);
  const updateRemote = (id, f, v) => setRemotes(r => r.map(x => x.id === id ? { ...x, [f]: v } : x));
  const removeRemote = (id) => setRemotes(r => r.filter(x => x.id !== id));

  const [recipient, setRecipient] = useState(() => localStorage.getItem(RECIPIENT_KEY) || '');
  const [sending, setSending] = useState(false);
  const [presets, setPresets] = useState(() => getPoPresets());
  // Body initialises from the remembered recipient's preset (or the default),
  // then auto-fills on recipient change via applyRecipient() — stays editable.
  const [message, setMessage] = useState(() => {
    const preset = getPoPresetForEmail(localStorage.getItem(RECIPIENT_KEY) || '');
    return preset ? preset.message : defaultMessage;
  });

  // Set the recipient and, if it matches a saved preset, auto-fill the body.
  const applyRecipient = (value) => {
    setRecipient(value);
    const preset = getPoPresetForEmail(value);
    if (preset) setMessage(preset.message);
  };

  // dateRequired is stored as 'YYYY-MM-DD' (from the date picker) or the literal
  // 'ASAP'. This is what actually prints on the PO — dates shown AU-style.
  const dateRequiredDisplay =
    !dateRequired ? '' :
    dateRequired === 'ASAP' ? 'ASAP' :
    (() => { try { return format(parseISO(dateRequired), 'dd/MM/yyyy'); } catch { return dateRequired; } })();


  // Per-line motor side, keyed by item id (defaults to the stored motorSide).
  const [motorSides, setMotorSides] = useState(() => {
    const init = {};
    allCurtains.forEach((it) => { init[it._key] = it.motorSide || ''; });
    return init;
  });
  const motorFor = (it) => motorSides[it._key] ?? '';
  const setMotor = (it, v) => setMotorSides(m => ({ ...m, [it._key]: v }));

  // Motorised tracks are the exception, so the Motor side column is off by
  // default and only added when this order actually has motors. Remembered.
  const [motorised, setMotorised] = useState(() => localStorage.getItem('lusso_po_motorised') === 'true');
  const [motorOpen, setMotorOpen] = useState(() => localStorage.getItem('lusso_po_motorised') === 'true');
  const toggleMotorised = () => setMotorised(v => { const n = !v; localStorage.setItem('lusso_po_motorised', String(n)); return n; });

  if (!sheet) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <BackButton fallback="/measure-sheets" />
        <p className="mt-6 text-slate-500">Measure sheet not found.</p>
      </div>
    );
  }

  // Drop the trailing Motor side column when this order isn't motorised.
  const headers = motorised ? PO_HEADERS : PO_HEADERS.filter(h => h !== 'Motor side (L/R)');
  const rows = curtains.map((it, i) => {
    const cells = rowCells(it, i, motorFor(it));
    return motorised ? cells : cells.slice(0, -1);
  });

  // Only entries with at least one filled field reach the PO.
  const liveWands = wands.filter(w => !wandIsEmpty(w));
  const liveRemotes = remotes.filter(r => !remoteIsEmpty(r));
  const hasAccessories = liveWands.length > 0 || liveRemotes.length > 0;

  // ── XLSX export — mirrors the example PO cell positions ────────────────────
  const handleExport = () => {
    const FOOTER = 'Should you have any questions please call 0755284006 or email info@lusso.com.au - Adress 3 Crinum Cres Southport';
    const at = (index, value) => { const r = []; r[index] = value; return r; };

    const aoa = [];
    // Title (col 4, matching the example)
    aoa.push(at(4, 'Lusso Curtain PO sheet'));
    // Header labels + values (cols mirror the example header block)
    const lbl = []; lbl[5] = 'Job #'; lbl[7] = 'Customer'; lbl[9] = 'Date ordered'; lbl[11] = 'Date required'; lbl[14] = 'Page #';
    aoa.push(lbl);
    const val = []; val[5] = jobNumber; val[7] = customerName; val[9] = dateOrdered; val[11] = dateRequiredDisplay; val[14] = 1;
    aoa.push(val);
    aoa.push([]);
    // Column header row — '#' is the blank leading cell, then headers in col 1+
    aoa.push(['', ...headers.slice(1)]);
    // Data rows
    rows.forEach(r => aoa.push(r));
    aoa.push([]);
    // Per-order accessories — only populated entries; section omitted if empty.
    if (hasAccessories) {
      aoa.push(['', 'Order accessories']);
      liveWands.forEach(w => aoa.push(['', 'Wand', w.qty, w.colour, w.length ? `${w.length}mm` : '']));
      liveRemotes.forEach(r => aoa.push(['', 'Remote', r.qty, r.type, r.colour]));
      aoa.push([]);
    }
    // Extra notes — omitted if blank
    if (extraNotes.trim()) {
      aoa.push(['', 'Extra notes']);
      aoa.push(['', extraNotes]);
      aoa.push([]);
    }
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
    markOrdered();
  };

  // ── PDF (same PO data as the XLSX export) — used for download + email ──────
  const buildPdfDoc = async () => {
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
      [jobNumber && `Job #: ${jobNumber}`, customerName && `Customer: ${customerName}`].filter(Boolean).join('    '),
      [`Date ordered: ${dateOrdered}`, dateRequiredDisplay && `Required: ${dateRequiredDisplay}`].filter(Boolean).join('    '),
    ].filter(Boolean).forEach((line, i) => doc.text(line, pageW - 24, 42 + i * 15, { align: 'right' }));

    autoTable(doc, {
      head: [headers],
      body: rows.map(r => r.map(c => (c === '' || c == null ? '' : String(c)))),
      startY: 78,
      margin: { left: 24, right: 24 },
      styles: { fontSize: 10, cellPadding: 4, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: [241, 241, 241], textColor: [40, 40, 40], fontStyle: 'bold', fontSize: 9 },
    });

    let y = (doc.lastAutoTable?.finalY || 78) + 24;
    doc.setFontSize(11); doc.setTextColor(40);
    if (hasAccessories) {
      doc.setFont('helvetica', 'bold'); doc.text('Order accessories', 24, y); y += 16;
      doc.setFont('helvetica', 'normal');
      liveWands.forEach(w => { doc.text(`Wand: ${wandLabel(w)}`, 24, y); y += 15; });
      liveRemotes.forEach(r => { doc.text(`Remote: ${remoteLabel(r)}`, 24, y); y += 15; });
      y += 8;
    }
    if (extraNotes.trim()) {
      doc.setFont('helvetica', 'bold'); doc.text('Extra notes', 24, y); y += 16;
      doc.setFont('helvetica', 'normal');
      doc.text(doc.splitTextToSize(extraNotes, pageW - 48), 24, y);
    }
    doc.setFontSize(9.5); doc.setTextColor(140);
    doc.text('Should you have any questions please call 0755284006 or email info@lusso.com.au — Address 3 Crinum Cres Southport', 24, pageH - 24);

    return doc;
  };

  // Email needs the PDF as base64; download writes the file to the device.
  const buildPdfBase64 = async () => bytesToBase64(new Uint8Array((await buildPdfDoc()).output('arraybuffer')));

  const handleDownloadPdf = async () => {
    try {
      (await buildPdfDoc()).save(`${fileBase}.pdf`);
      markOrdered();
    } catch (e) {
      console.error('[PO] PDF download failed', e);
      toast('Could not generate the PDF.', 'error');
    }
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
        message: (message || '').trim() || defaultMessage,
        filename: `${fileBase}.pdf`,
        contentBase64,
      });
      localStorage.setItem(RECIPIENT_KEY, to);
      // Stage 2: log a note on the linked job recording the send, and move
      // the job forward — a sent PO means the order is placed.
      if (sheet.jobId) {
        addActivity({
          jobId: sheet.jobId,
          type: 'po_sent',
          message: `Curtain PO sent to ${to}`,
          user: displayName || 'System',
        });
        advanceJobStatus(sheet.jobId, 'Ordered', displayName || 'System');
      }
      markOrdered();
      toast(`Purchase order sent to ${to}.`);
    } catch (err) {
      toast(err.message || 'Could not send the purchase order.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleSavePreset = () => {
    const email = recipient.trim();
    if (!EMAIL_RE.test(email)) { toast('Enter a valid email before saving a preset.', 'error'); return; }
    savePoPreset({ email, message });
    setPresets(getPoPresets());
    toast(`Saved message preset for ${email}.`);
  };

  const handleDeletePreset = (preset) => {
    deletePoPreset(preset.id);
    setPresets(getPoPresets());
    toast('Preset deleted.', 'info');
  };

  const activePreset = getPoPresetForEmail(recipient);

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
              {curtains.length === allCurtains.length
                ? `${curtains.length} curtain${curtains.length !== 1 ? 's' : ''}`
                : `${curtains.length} of ${allCurtains.length} curtains selected`} from {customerName || 'this sheet'}
              {jobNumber ? ` · ${jobNumber}` : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center w-full sm:w-auto sm:flex-shrink-0 sm:justify-end">
            <input
              type="email"
              list="po-preset-emails"
              value={recipient}
              onChange={e => applyRecipient(e.target.value)}
              placeholder="supplier@email.com"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full sm:w-52 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <datalist id="po-preset-emails">
              {presets.map(p => <option key={p.id} value={p.email} />)}
            </datalist>
            <button onClick={handleSend} disabled={sending || !curtains.length}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white">
              {sending ? <Loader size={13} className="animate-spin" /> : <Send size={13} />} Send PO
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
              <Printer size={13} /> Print
            </button>
            <button onClick={handleDownloadPdf} disabled={!curtains.length}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
              <FileText size={13} /> Download PDF
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
              <Download size={13} /> Export XLSX
            </button>
          </div>
        </div>
      </Card>

      {/* Carry-over prompt: some curtains ordered, others still to place */}
      {orderedKeys.size > 0 && remaining.length > 0 && !nextDismissed && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {remaining.length} curtain{remaining.length !== 1 ? 's' : ''} not yet ordered
            </p>
            <p className="text-xs text-amber-700 mt-0.5">Start a fresh PO with just those — e.g. for a different supplier.</p>
          </div>
          <button onClick={startNextPO}
            className="flex-shrink-0 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold rounded-lg px-3 py-2 transition-colors">
            <Plus size={13} /> Next PO
          </button>
          <button onClick={() => setNextDismissed(true)} className="flex-shrink-0 text-xs font-medium text-amber-600 hover:text-amber-800 px-1.5">
            Dismiss
          </button>
        </div>
      )}

      {allCurtains.length === 0 ? (
        <Card><p className="p-8 text-center text-sm text-slate-400">This measure sheet has no curtain items to order.</p></Card>
      ) : (
        <>
          {/* Line-item selection — choose which curtains go on this order */}
          {allCurtains.length > 1 && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-800 text-sm">Curtains on this order</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Untick anything going to a different supplier, or that the customer didn't proceed with.</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setExcludedKeys(new Set())}
                    className="text-xs font-medium text-amber-600 hover:underline">All</button>
                  <span className="text-slate-300">·</span>
                  <button onClick={() => setExcludedKeys(new Set(allCurtains.map(c => c._key)))}
                    className="text-xs font-medium text-slate-500 hover:underline">None</button>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {allCurtains.map((c, i) => {
                  const included = !excludedKeys.has(c._key);
                  return (
                    <button key={c._key} onClick={() => toggleCurtain(c._key)}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50 transition-colors ${included ? '' : 'opacity-50'}`}>
                      <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${included ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                        {included && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums w-5 flex-shrink-0">{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-800">{c.location || 'Curtain'}</span>
                        <span className="text-xs text-slate-400 ml-2">
                          {[c.fabricColour, (c.widthMm || c.width) && `${c.widthMm || c.width}×${c.dropMm || c.drop || '?'}`, c.control].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {curtains.length === 0 && (
                <p className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">Nothing selected — tick at least one curtain to build the order.</p>
              )}
            </Card>
          )}

          {/* Email message + presets */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-800 text-sm">Email message</h2>
              <button onClick={handleSavePreset}
                className="text-xs font-medium text-amber-600 hover:underline flex items-center gap-1 flex-shrink-0">
                <Save size={12} /> {activePreset ? 'Update preset' : 'Save as preset'}
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">
                  Body sent with the PO{recipient ? ` to ${recipient}` : ''}
                  {activePreset && <span className="ml-1 text-amber-600">· auto-filled from saved preset</span>}
                </p>
                <textarea rows={4} value={message} onChange={e => setMessage(e.target.value)}
                  className={inputCls} placeholder="Message to the supplier…" />
              </div>
              {presets.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Saved message presets</p>
                  <div className="space-y-1.5">
                    {presets.map(p => (
                      <div key={p.id} className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${activePreset?.id === p.id ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-slate-700 truncate block">{p.email}</span>
                          <span className="text-xs text-slate-400 truncate block">{p.message?.replace(/\n/g, ' ') || '—'}</span>
                        </div>
                        <button onClick={() => applyRecipient(p.email)}
                          className="text-xs font-medium text-amber-600 hover:underline flex-shrink-0">Use</button>
                        <button onClick={() => handleDeletePreset(p)}
                          className="text-slate-400 hover:text-red-500 flex-shrink-0" title="Delete preset">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Order details */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Order Details</h2>
            </div>
            <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Date required</span>
                {dateRequired === 'ASAP' ? (
                  <div className={`${inputCls} flex items-center justify-between`}>
                    <span className="font-medium text-slate-800">ASAP</span>
                    <button type="button" onClick={() => setDateRequired('')}
                      className="text-xs text-amber-600 hover:underline">Pick a date</button>
                  </div>
                ) : (
                  <input type="date" className={inputCls} value={dateRequired}
                    onChange={e => setDateRequired(e.target.value)} />
                )}
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <button type="button" onClick={() => setDateRequired(format(addDays(new Date(), 21), 'yyyy-MM-dd'))}
                    className="text-xs font-medium px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">3 weeks</button>
                  <button type="button" onClick={() => setDateRequired(format(addDays(new Date(), 28), 'yyyy-MM-dd'))}
                    className="text-xs font-medium px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">4 weeks</button>
                  <button type="button" onClick={() => setDateRequired('ASAP')}
                    className="text-xs font-medium px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">ASAP</button>
                </div>
              </div>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Date ordered</span>
                <input className={inputCls} value={dateOrdered} disabled />
              </label>
              <label className="text-sm sm:col-span-2 lg:col-span-3">
                <span className="block text-xs text-slate-500 mb-1">Extra notes</span>
                <textarea rows={2} className={inputCls} value={extraNotes} onChange={e => setExtraNotes(e.target.value)} placeholder="Anything the supplier should know…" />
              </label>
            </div>
          </Card>

          {/* Motorised order — expandable; controls the Motor side column on the PO */}
          <Card>
            <button type="button" onClick={() => setMotorOpen(o => !o)} aria-expanded={motorOpen}
              className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-semibold text-slate-800 text-sm">Motorised order</h2>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${motorised ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{motorised ? 'On' : 'Off'}</span>
              </div>
              <ChevronDown size={16} className={`text-slate-400 flex-shrink-0 transition-transform ${motorOpen ? 'rotate-180' : ''}`} />
            </button>
            {motorOpen && (
              <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-500 flex-1">Adds the Motor side (L/R) column to the PO plus the per-curtain inputs below. Leave off for non-motorised orders.</p>
                  <button type="button" onClick={toggleMotorised} role="switch" aria-checked={motorised}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${motorised ? 'bg-amber-500' : 'bg-slate-200'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${motorised ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {motorised && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-600 mb-2">Motor side (per curtain)</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {curtains.map((it, i) => (
                        <div key={it.id || i} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2">
                          <span className="text-sm text-slate-700 truncate">{i + 1}. {it.location || '—'}</span>
                          <div className="flex gap-1 flex-shrink-0">
                            {['L', 'R'].map(side => (
                              <button key={side} onClick={() => setMotor(it, motorFor(it) === side ? '' : side)}
                                className={`text-xs font-semibold w-8 py-1 rounded-md border transition-colors ${
                                  motorFor(it) === side ? 'bg-amber-500 text-white border-amber-500' : 'text-slate-500 border-slate-200 hover:border-slate-300'
                                }`}>
                                {side}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Accessories — repeatable wand & remote entries (hidden until added) */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Accessories</h2>
              <p className="text-xs text-slate-400 mt-0.5">Add wands and remotes as needed — only added items appear on the PO.</p>
            </div>
            {wandCalc.total > 0 ? (
              <div className="mx-5 mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-800">Suggested: {wandCalc.total} wand{wandCalc.total !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {Object.entries(wandCalc.byCode).map(([code, d]) => `${d.count}× ${code} → ${d.wands}`).join('  ·  ')}
                    {wandCalc.unmatched > 0 && `  ·  ${wandCalc.unmatched} without a recognised control code`}
                  </p>
                </div>
                <button type="button" onClick={addSuggestedWands}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white flex-shrink-0">
                  <Plus size={13} /> Add {wandCalc.total} wands
                </button>
              </div>
            ) : (
              <div className="mx-5 mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs text-slate-500">
                  Auto wand count: set each curtain's <span className="font-medium text-slate-600">Control</span> to F/R, LHS, RHS, C/O or C/O F/R and Lusso will suggest the wand quantity here (F/R 2, LHS 1, RHS 1, C/O 2, C/O F/R 4).
                </p>
              </div>
            )}
            <div className="p-5 space-y-6">
              {[
                { label: 'Wands', addLabel: 'Add wands', items: wands, add: addWand, update: updateWand, remove: removeWand,
                  fields: [['qty', 'Quantity', 'number', 'e.g. 10'], ['colour', 'Colour', 'text', 'e.g. White'], ['length', 'Length (mm)', 'number', 'e.g. 1200']] },
                { label: 'Remotes', addLabel: 'Add remote', items: remotes, add: addRemote, update: updateRemote, remove: removeRemote,
                  fields: [['qty', 'Quantity', 'number', 'e.g. 2'], ['type', 'Type', 'text', 'e.g. 5-channel'], ['colour', 'Colour', 'text', 'e.g. White']] },
              ].map(group => (
                <div key={group.label}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-sm font-medium text-slate-700">{group.label}</p>
                    <button type="button" onClick={group.add}
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50">
                      <Plus size={13} /> {group.addLabel}
                    </button>
                  </div>
                  {group.items.length === 0 ? (
                    <p className="text-xs text-slate-400">No {group.label.toLowerCase()} added.</p>
                  ) : (
                    <div className="space-y-2">
                      {group.items.map(item => (
                        <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 sm:items-end border border-slate-200 rounded-lg p-3">
                          {group.fields.map(([f, fLabel, fType, fPh]) => (
                            <label key={f} className="text-xs">
                              <span className="block text-slate-500 mb-1">{fLabel}</span>
                              <input type={fType} min={fType === 'number' ? '0' : undefined} className={inputCls}
                                value={item[f]} onChange={e => group.update(item.id, f, e.target.value)} placeholder={fPh} />
                            </label>
                          ))}
                          <button type="button" onClick={() => group.remove(item.id)} title="Remove"
                            className="h-[38px] flex items-center justify-center gap-1.5 px-3 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200">
                            <Trash2 size={14} /><span className="sm:hidden text-xs font-medium">Remove</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                  {(jobNumber || customerName) && (
                    <div>
                      {jobNumber && <><span className="text-slate-400">Job #:</span> {jobNumber}</>}
                      {jobNumber && customerName && ' · '}
                      {customerName && <><span className="text-slate-400">Customer:</span> {customerName}</>}
                    </div>
                  )}
                  <div>
                    <span className="text-slate-400">Date ordered:</span> {dateOrdered}
                    {dateRequiredDisplay && <> · <span className="text-slate-400">Required:</span> {dateRequiredDisplay}</>}
                  </div>
                </div>
              </div>

              {/* Line items table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      {headers.map(h => (
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

              {/* Per-order accessories + notes — populated entries only */}
              {(hasAccessories || extraNotes.trim()) && (
                <div className="grid sm:grid-cols-2 gap-4 mt-4 text-xs">
                  {hasAccessories && (
                    <div>
                      <div className="font-semibold text-slate-700 mb-1">Order accessories</div>
                      {liveWands.map(w => <div key={w.id} className="text-slate-600">Wand: {wandLabel(w)}</div>)}
                      {liveRemotes.map(r => <div key={r.id} className="text-slate-600">Remote: {remoteLabel(r)}</div>)}
                    </div>
                  )}
                  {extraNotes.trim() && (
                    <div>
                      <div className="font-semibold text-slate-700 mb-1">Extra notes</div>
                      <div className="text-slate-600 whitespace-pre-wrap">{extraNotes}</div>
                    </div>
                  )}
                </div>
              )}

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
