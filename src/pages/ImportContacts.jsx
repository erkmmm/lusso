import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Upload, FileText, ChevronRight, ChevronDown, AlertTriangle,
  CheckCircle2, XCircle, SkipForward, RefreshCw, Users,
  Download, History, ArrowRight, Info, X, Loader2,
} from 'lucide-react';
import {
  getCustomers, createImportBatch, runContactImport,
  saveImportBatch, getImportBatches,
} from '../store/data';
import Card from '../components/Card';

// ─── Field definitions ─────────────────────────────────────────────────────────

const LUSSO_FIELDS = [
  { key: '',             label: '— Skip column —' },
  { key: 'firstName',    label: 'First Name' },
  { key: 'lastName',     label: 'Last Name' },
  { key: 'businessName', label: 'Business / Company Name' },
  { key: 'email',        label: 'Email' },
  { key: 'phone',        label: 'Phone' },
  { key: 'mobile',       label: 'Mobile' },
  { key: 'address',      label: 'Address' },
  { key: 'suburb',       label: 'Suburb / City' },
  { key: 'state',        label: 'State' },
  { key: 'postcode',     label: 'Postcode / Zip' },
  { key: 'country',      label: 'Country' },
  { key: 'notes',        label: 'Notes' },
  { key: 'tags',         label: 'Tags' },
];

const FIELD_ALIASES = {
  firstname: 'firstName', lastname: 'lastName',
  companyname: 'businessName', company: 'businessName', organisation: 'businessName', organization: 'businessName',
  email: 'email', emailaddress: 'email',
  phone: 'phone', phonenumber: 'phone', telephone: 'phone',
  mobile: 'mobile', mobilenumber: 'mobile', cellphone: 'mobile',
  address: 'address', streetaddress: 'address', street: 'address',
  city: 'suburb', suburb: 'suburb',
  state: 'state', province: 'state',
  zip: 'postcode', postcode: 'postcode', zipcode: 'postcode', postalcode: 'postcode',
  country: 'country',
  notes: 'notes', note: 'notes',
  tags: 'tags', tag: 'tags',
};

// ─── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text) {
  text = text.replace(/^﻿/, ''); // strip BOM
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i += 2; }
      else if (c === '"') { inQ = false; i++; }
      else { field += c; i++; }
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === ',') { row.push(field.trim()); field = ''; i++; }
      else if (c === '\r' && n === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i += 2; }
      else if (c === '\n' || c === '\r') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; }
      else { field += c; i++; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(f => f)) rows.push(row); }
  return rows;
}

function normalizeHeader(h) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function autoDetectMapping(headers) {
  const map = {};
  headers.forEach(h => {
    map[h] = FIELD_ALIASES[normalizeHeader(h)] ?? '';
  });
  return map;
}

// ─── Row processing helpers ────────────────────────────────────────────────────

const PLACEHOLDER = /^\.+$|^0\.?$/;

function cleanVal(v) {
  const s = (v || '').trim();
  return PLACEHOLDER.test(s) ? '' : s;
}

function normalizePhone(p) {
  if (!p) return '';
  return p.replace(/[\s\-().]/g, '');
}

function buildName(m) {
  const fn = m.firstName, ln = m.lastName, biz = m.businessName;
  if (fn && ln) return `${fn} ${ln}`;
  if (fn) return fn;
  if (ln) return ln;
  if (biz) return biz;
  return '';
}

function validateEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function findDuplicate(existing, mapped) {
  if (mapped.email) {
    const m = existing.find(c => c.email && c.email.toLowerCase() === mapped.email.toLowerCase());
    if (m) return { customer: m, field: 'email' };
  }
  if (mapped.phone) {
    const p = normalizePhone(mapped.phone);
    const m = existing.find(c => c.phone && normalizePhone(c.phone) === p);
    if (m) return { customer: m, field: 'phone' };
  }
  if (mapped.mobile) {
    const p = normalizePhone(mapped.mobile);
    const m = existing.find(c => (c.mobile || c.phone) && normalizePhone(c.mobile || c.phone) === p);
    if (m) return { customer: m, field: 'mobile' };
  }
  if (mapped.name && mapped.address) {
    const m = existing.find(c =>
      c.name?.toLowerCase() === mapped.name.toLowerCase() &&
      c.address?.toLowerCase().includes(mapped.address.toLowerCase())
    );
    if (m) return { customer: m, field: 'name+address' };
  }
  return null;
}

function processRows(rawRows, headers, columnMap, existingCustomers, globalDupAction) {
  const seen = new Set(); // detect intra-CSV dupes
  return rawRows.map((cells, idx) => {
    // Map raw cells to Lusso fields
    const raw = {};
    headers.forEach((h, i) => {
      const field = columnMap[h];
      if (field) raw[field] = cleanVal(cells[i]);
    });

    const mapped = {
      firstName:    raw.firstName    || '',
      lastName:     raw.lastName     || '',
      businessName: raw.businessName || '',
      email:        raw.email        || '',
      phone:        raw.phone        || '',
      mobile:       raw.mobile       || '',
      address:      raw.address      || '',
      suburb:       raw.suburb       || '',
      state:        raw.state        || '',
      postcode:     raw.postcode     || '',
      country:      raw.country      || '',
      notes:        raw.notes        || '',
      tags:         raw.tags         || '',
    };
    mapped.name = buildName(mapped);

    // Validate
    const errors = [];
    const hasId = mapped.name || mapped.email || mapped.phone || mapped.mobile;
    if (!hasId) {
      return { rowNum: idx + 1, mapped, rawCells: cells, status: 'empty', errors: ['Empty row'], isDuplicate: false, duplicate: null, rowAction: 'skip' };
    }
    if (mapped.email && !validateEmail(mapped.email)) errors.push('Invalid email address');

    // Intra-CSV duplicate detection
    const dedupKey = [mapped.email, normalizePhone(mapped.phone), normalizePhone(mapped.mobile)].filter(Boolean).join('|');
    const intraDupe = dedupKey && seen.has(dedupKey);
    if (dedupKey) seen.add(dedupKey);
    if (intraDupe) errors.push('Duplicate within CSV');

    if (errors.length > 0 && errors.some(e => e === 'Duplicate within CSV')) {
      return { rowNum: idx + 1, mapped, rawCells: cells, status: 'error', errors, isDuplicate: true, duplicate: null, rowAction: 'skip' };
    }
    if (errors.length > 0) {
      return { rowNum: idx + 1, mapped, rawCells: cells, status: 'error', errors, isDuplicate: false, duplicate: null, rowAction: 'skip' };
    }

    // Check against existing customers
    const dupResult = findDuplicate(existingCustomers, mapped);
    if (dupResult) {
      return {
        rowNum: idx + 1, mapped, rawCells: cells,
        status: 'duplicate',
        errors: [`Matches existing customer by ${dupResult.field}`],
        isDuplicate: true,
        duplicate: dupResult.customer,
        dupField: dupResult.field,
        rowAction: globalDupAction,
      };
    }

    return { rowNum: idx + 1, mapped, rawCells: cells, status: 'ready', errors: [], isDuplicate: false, duplicate: null, rowAction: 'import' };
  });
}

// ─── CSV download helper ───────────────────────────────────────────────────────

function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadErrorReport(rows, fileName) {
  const headers = ['Row', 'Name', 'Business', 'Email', 'Phone', 'Address', 'Status', 'Reason', 'Duplicate Match'];
  const body = rows
    .filter(r => r.status === 'error' || r.status === 'empty' || (r.isDuplicate && r.rowAction === 'skip'))
    .map(r => [
      r.rowNum,
      csvEscape(r.mapped?.name || ''),
      csvEscape(r.mapped?.businessName || ''),
      csvEscape(r.mapped?.email || ''),
      csvEscape(r.mapped?.phone || ''),
      csvEscape(r.mapped?.address || ''),
      r.status,
      csvEscape(r.errors?.join('; ') || ''),
      csvEscape(r.duplicate ? `${r.duplicate.name} (${r.duplicate.email || r.duplicate.phone})` : ''),
    ].join(','));
  const csv = [headers.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-errors-${fileName.replace(/[^a-z0-9]/gi, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function RowStatusBadge({ status, action }) {
  if (status === 'empty')     return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400"><SkipForward size={10}/>Empty</span>;
  if (status === 'error')     return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-500"><XCircle size={10}/>Error</span>;
  if (status === 'duplicate') {
    if (action === 'skip')   return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600"><AlertTriangle size={10}/>Duplicate</span>;
    if (action === 'update') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600"><RefreshCw size={10}/>Update</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-600"><Users size={10}/>Create New</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-600"><CheckCircle2 size={10}/>Ready</span>;
}

// ─── Main component ────────────────────────────────────────────────────────────

const STEPS = ['upload', 'map', 'preview', 'done'];

export default function ImportContacts() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [activeTab, setActiveTab] = useState('import');

  // Wizard state
  const [step, setStep]           = useState('upload');
  const [fileName, setFileName]   = useState('');
  const [headers, setHeaders]     = useState([]);
  const [rawRows, setRawRows]     = useState([]);
  const [columnMap, setColumnMap] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [globalDupAction, setGlobalDupAction] = useState('skip');
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState(null);
  const [batchId, setBatchId]     = useState(null);
  const [dragOver, setDragOver]   = useState(false);

  const [batches, setBatches] = useState(() => getImportBatches());

  const stepIndex = STEPS.indexOf(step);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { alert('CSV appears to be empty or has no data rows.'); return; }
      const hdrs = rows[0];
      const data = rows.slice(1).filter(r => r.some(c => cleanVal(c)));
      setHeaders(hdrs);
      setRawRows(data);
      setColumnMap(autoDetectMapping(hdrs));
      setStep('map');
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  const onFilePick = (e) => handleFile(e.target.files?.[0]);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); };

  // ── Build preview ──────────────────────────────────────────────────────────

  const buildPreview = () => {
    const existing = getCustomers();
    const rows = processRows(rawRows, headers, columnMap, existing, globalDupAction);
    setPreviewRows(rows);
    setStep('preview');
  };

  // ── Update per-row action ──────────────────────────────────────────────────

  const setRowAction = (rowNum, action) => {
    setPreviewRows(prev => prev.map(r => r.rowNum === rowNum ? { ...r, rowAction: action } : r));
  };

  // ── Apply global dup action ────────────────────────────────────────────────

  const applyGlobalDupAction = (action) => {
    setGlobalDupAction(action);
    setPreviewRows(prev => prev.map(r => r.status === 'duplicate' ? { ...r, rowAction: action } : r));
  };

  // ── Run import ─────────────────────────────────────────────────────────────

  const runImport = async () => {
    setImporting(true);
    await new Promise(r => setTimeout(r, 60)); // let UI update

    const importable = previewRows.filter(r => r.status !== 'empty');
    const batch = createImportBatch(fileName, importable.length);
    setBatchId(batch.id);

    const finalResult = runContactImport(batch.id, previewRows);
    setResult(finalResult);
    setBatches(getImportBatches());
    setImporting(false);
    setStep('done');
  };

  // ── Summary counts ─────────────────────────────────────────────────────────

  const counts = previewRows.reduce((acc, r) => {
    if (r.status === 'empty') { acc.empty++; return acc; }
    if (r.status === 'error') { acc.errors++; return acc; }
    if (r.status === 'duplicate') {
      if (r.rowAction === 'skip')   acc.willSkip++;
      else if (r.rowAction === 'update') acc.willUpdate++;
      else acc.willImport++;
      return acc;
    }
    acc.willImport++;
    return acc;
  }, { willImport: 0, willUpdate: 0, willSkip: 0, errors: 0, empty: 0 });

  const resetWizard = () => {
    setStep('upload'); setFileName(''); setHeaders([]); setRawRows([]);
    setColumnMap({}); setPreviewRows([]); setResult(null); setBatchId(null);
    setGlobalDupAction('skip');
    if (fileRef.current) fileRef.current.value = '';
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Import Contacts</h1>
          <p className="text-slate-500 text-sm mt-0.5">Upload a CSV to import customer contacts into Lusso.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['import', Upload, 'Import'], ['history', History, 'History']].map(([t, Icon, label]) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {activeTab === 'import' && (
        <>
          {/* Step indicator */}
          {step !== 'done' && (
            <div className="flex items-center gap-2">
              {[['upload', 'Upload'], ['map', 'Map Columns'], ['preview', 'Preview']].map(([s, label], i) => (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <ChevronRight size={14} className="text-slate-300" />}
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${stepIndex >= i ? 'text-amber-600' : 'text-slate-400'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${stepIndex > i ? 'bg-amber-500 text-white' : stepIndex === i ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                      {stepIndex > i ? '✓' : i + 1}
                    </span>
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Step 1: Upload ── */}
          {step === 'upload' && (
            <Card>
              <div className="p-8">
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-amber-300 hover:bg-slate-50'}`}
                >
                  <div className="w-14 h-14 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
                    <Upload size={24} className="text-amber-500" />
                  </div>
                  <p className="text-slate-700 font-medium">Drag & drop your CSV file here</p>
                  <p className="text-slate-400 text-sm mt-1">or click to browse — CSV files only</p>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFilePick} />
                </div>

                <div className="mt-5 p-4 bg-slate-50 rounded-lg flex items-start gap-3">
                  <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-500 space-y-1">
                    <p className="font-medium text-slate-600">Supported formats</p>
                    <p>Quotient contact exports are auto-detected. Other CSVs can be mapped manually.</p>
                    <p>Required: at least one of — name, company, email, or phone number.</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ── Step 2: Map Columns ── */}
          {step === 'map' && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800">Map Columns</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{rawRows.length} data rows · {headers.length} columns · <span className="font-medium text-slate-600">{fileName}</span></p>
                </div>
                <button onClick={resetWizard} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><X size={12}/>Change file</button>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-500 mb-4">
                  We've auto-detected the column mapping. Adjust any that are incorrect, or set to <em>Skip column</em> to ignore it.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 font-medium">
                        <th className="px-4 py-2.5 text-left rounded-tl-lg">CSV Column</th>
                        <th className="px-4 py-2.5 text-left">Sample Values</th>
                        <th className="px-4 py-2.5 text-left rounded-tr-lg">Maps to Lusso Field</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {headers.map(h => {
                        const samples = rawRows.slice(0, 3).map(r => cleanVal(r[headers.indexOf(h)])).filter(Boolean).slice(0, 2);
                        return (
                          <tr key={h} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">{h}</td>
                            <td className="px-4 py-2.5 text-slate-400 text-xs max-w-xs truncate">{samples.join(', ') || <span className="italic">—</span>}</td>
                            <td className="px-4 py-2.5">
                              <select
                                value={columnMap[h] || ''}
                                onChange={e => setColumnMap(m => ({ ...m, [h]: e.target.value }))}
                                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 w-full max-w-xs"
                              >
                                {LUSSO_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-5 flex gap-3">
                  <button onClick={resetWizard} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Back</button>
                  <button onClick={buildPreview} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
                    Continue to Preview <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </Card>
          )}

          {/* ── Step 3: Preview ── */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Summary bar */}
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-green-600 font-medium"><CheckCircle2 size={15}/>{counts.willImport} to import</div>
                  {counts.willUpdate > 0 && <div className="flex items-center gap-1.5 text-blue-600 font-medium"><RefreshCw size={15}/>{counts.willUpdate} to update</div>}
                  {counts.willSkip > 0 && <div className="flex items-center gap-1.5 text-yellow-600 font-medium"><SkipForward size={15}/>{counts.willSkip} duplicates (skip)</div>}
                  {counts.errors > 0 && <div className="flex items-center gap-1.5 text-red-500 font-medium"><XCircle size={15}/>{counts.errors} errors</div>}
                  {counts.empty > 0 && <div className="flex items-center gap-1.5 text-slate-400 font-medium"><SkipForward size={15}/>{counts.empty} empty rows</div>}

                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-slate-500">Duplicates:</span>
                    <select
                      value={globalDupAction}
                      onChange={e => applyGlobalDupAction(e.target.value)}
                      className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="skip">Skip all</option>
                      <option value="update">Update existing</option>
                      <option value="create">Create new anyway</option>
                    </select>
                  </div>
                </div>
              </Card>

              {/* Preview table */}
              <Card>
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800 text-sm">{previewRows.length} rows</h2>
                  <button onClick={() => setStep('map')} className="text-xs text-slate-400 hover:text-slate-600">← Back to mapping</button>
                </div>
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="sticky top-0 bg-white border-b border-slate-100 z-10">
                      <tr className="text-xs text-slate-500 font-medium">
                        <th className="px-4 py-2.5 text-left w-12">#</th>
                        <th className="px-4 py-2.5 text-left">Name / Company</th>
                        <th className="px-4 py-2.5 text-left">Email</th>
                        <th className="px-4 py-2.5 text-left">Phone</th>
                        <th className="px-4 py-2.5 text-left">Address</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {previewRows.map(r => {
                        const displayName = r.mapped?.name || r.mapped?.businessName || r.mapped?.email || '—';
                        const addrShort = [r.mapped?.suburb, r.mapped?.state].filter(Boolean).join(', ') || r.mapped?.address?.slice(0, 30) || '';
                        return (
                          <tr key={r.rowNum} className={`${r.status === 'empty' ? 'opacity-40' : ''} hover:bg-slate-50`}>
                            <td className="px-4 py-2.5 text-slate-400 text-xs">{r.rowNum}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-700 truncate max-w-[160px]">{displayName}</div>
                              {r.mapped?.businessName && r.mapped.businessName !== displayName && (
                                <div className="text-xs text-slate-400 truncate">{r.mapped.businessName}</div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 text-xs truncate max-w-[140px]">{r.mapped?.email || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{r.mapped?.phone || r.mapped?.mobile || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-400 text-xs truncate max-w-[120px]">{addrShort || '—'}</td>
                            <td className="px-4 py-2.5">
                              <div className="space-y-1">
                                <RowStatusBadge status={r.status} action={r.rowAction} />
                                {r.errors?.length > 0 && (
                                  <div className="text-xs text-red-400 max-w-[140px] truncate" title={r.errors.join('; ')}>{r.errors[0]}</div>
                                )}
                                {r.status === 'duplicate' && r.duplicate && (
                                  <div className="text-xs text-slate-400 truncate max-w-[140px]">← {r.duplicate.name || r.duplicate.email}</div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {r.status === 'duplicate' && (
                                <select
                                  value={r.rowAction}
                                  onChange={e => setRowAction(r.rowNum, e.target.value)}
                                  className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                                >
                                  <option value="skip">Skip</option>
                                  <option value="update">Update</option>
                                  <option value="create">Create new</option>
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Import button */}
              <div className="flex items-center gap-3">
                <button onClick={() => setStep('map')} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Back</button>
                <button
                  onClick={runImport}
                  disabled={importing || (counts.willImport + counts.willUpdate) === 0}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  {importing ? <><Loader2 size={15} className="animate-spin"/>Importing…</> : <>Import {counts.willImport + counts.willUpdate} Contacts <ArrowRight size={14}/></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 'done' && result && (
            <div className="space-y-4">
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center">
                    <CheckCircle2 size={24} className="text-green-500" />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-900 text-lg">Import Complete</h2>
                    <p className="text-slate-500 text-sm">{result.fileName}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                  {[
                    { label: 'Total Rows',  value: result.totalRows,      color: 'text-slate-700', bg: 'bg-slate-50' },
                    { label: 'Imported',    value: result.importedCount,   color: 'text-green-600', bg: 'bg-green-50' },
                    { label: 'Updated',     value: result.updatedCount,    color: 'text-blue-600',  bg: 'bg-blue-50' },
                    { label: 'Duplicates',  value: result.duplicateCount,  color: 'text-yellow-600',bg: 'bg-yellow-50' },
                    { label: 'Errors',      value: result.errorCount,      color: 'text-red-500',   bg: 'bg-red-50' },
                    { label: 'Skipped',     value: result.skippedCount,    color: 'text-slate-400', bg: 'bg-slate-50' },
                  ].map(s => (
                    <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                      <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button onClick={() => navigate('/customers')} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
                    <Users size={14}/>View Customers
                  </button>
                  {(result.errorCount > 0 || result.duplicateCount > 0) && (
                    <button onClick={() => downloadErrorReport(previewRows, result.fileName)} className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                      <Download size={14}/>Download Error Report
                    </button>
                  )}
                  <button onClick={resetWizard} className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                    <Upload size={14}/>Import Another File
                  </button>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Import History</h2>
          </div>
          {batches.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <History size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No imports yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500 font-medium border-b border-slate-100">
                    <th className="px-5 py-2.5 text-left">File</th>
                    <th className="px-5 py-2.5 text-left">Date</th>
                    <th className="px-5 py-2.5 text-right">Total</th>
                    <th className="px-5 py-2.5 text-right">Imported</th>
                    <th className="px-5 py-2.5 text-right">Updated</th>
                    <th className="px-5 py-2.5 text-right">Dupes</th>
                    <th className="px-5 py-2.5 text-right">Errors</th>
                    <th className="px-5 py-2.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {batches.map(b => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-slate-400 flex-shrink-0" />
                          <span className="text-slate-700 font-medium truncate max-w-[200px]">{b.fileName}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 pl-5">{b.uploadedBy}</div>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {b.completedAt ? format(parseISO(b.completedAt), 'd MMM yyyy h:mm a') : '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{b.totalRows}</td>
                      <td className="px-5 py-3 text-right text-green-600 font-medium">{b.importedCount}</td>
                      <td className="px-5 py-3 text-right text-blue-600">{b.updatedCount}</td>
                      <td className="px-5 py-3 text-right text-yellow-600">{b.duplicateCount}</td>
                      <td className="px-5 py-3 text-right text-red-500">{b.errorCount}</td>
                      <td className="px-5 py-3">
                        <BatchStatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function BatchStatusBadge({ status }) {
  const map = {
    'Completed':              'bg-green-50 text-green-600',
    'Completed with errors':  'bg-yellow-50 text-yellow-600',
    'Failed':                 'bg-red-50 text-red-500',
    'Processing':             'bg-blue-50 text-blue-600',
    'Previewed':              'bg-slate-100 text-slate-500',
    'Uploaded':               'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] || 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}
