import { useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, ChevronDown,
  CheckSquare, Square, AlertTriangle, CheckCircle2,
  X, Trash2, ArrowRight, Search, ClipboardList, Plus,
  UserCheck, UserPlus,
} from 'lucide-react';
import BackButton from '../components/BackButton';
import {
  getCustomers, getJobs, saveMeasureSheet, getMeasureSheetsByJob,
  getActiveProductTypes, getCustomer, createJobFromMeasureSheet, JOB_TYPES,
  saveCustomer,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import Card from '../components/Card';

// ─── Lusso field definitions ──────────────────────────────────────────────────
const LUSSO_FIELDS = [
  { key: 'location',            label: 'Location / Room' },
  { key: 'productNameSnapshot', label: 'Product / Service' },
  { key: 'quantity',            label: 'Quantity' },
  { key: 'widthMm',             label: 'Width (mm)' },
  { key: 'dropMm',              label: 'Drop / Height (mm)' },
  { key: 'fabricColour',        label: 'Fabric / Colour' },
  { key: 'control',             label: 'Control' },
  { key: 'returnSide',          label: 'Return (L/R)' },
  { key: 'fixing',              label: 'Fixing' },
  { key: 'heading',             label: 'Heading / Roll' },
  { key: 'hem',                 label: 'Hem' },
  { key: 'trackBaseBarColour',  label: 'Track / Base Bar Colour' },
  { key: 'chainColour',         label: 'Chain Colour' },
  { key: 'notes',               label: 'Notes' },
  { key: '__skip',              label: '— Skip this column —' },
];

// ─── Auto-detect column mapping from header labels ────────────────────────────
const HEADER_RULES = [
  { patterns: ['location', 'room', 'area', 'zone'],                      field: 'location' },
  { patterns: ['product', 'service', 'item', 'blind', 'curtain', 'type'], field: 'productNameSnapshot' },
  { patterns: ['qty', 'quantity', 'count', 'no.', 'num'],                 field: 'quantity' },
  { patterns: ['width', 'w (mm)', 'w(mm)'],                               field: 'widthMm' },
  { patterns: ['drop', 'height', 'length', 'h (mm)', 'd (mm)', 'h(mm)'],  field: 'dropMm' },
  { patterns: ['fabric', 'colour', 'color', 'fabric/color', 'fabric/col'], field: 'fabricColour' },
  { patterns: ['lining', 'linning', 'linn'],                               field: 'notes' },
  { patterns: ['control'],                                                 field: 'control' },
  { patterns: ['return'],                                                  field: 'returnSide' },
  { patterns: ['fixing', 'fix'],                                           field: 'fixing' },
  { patterns: ['heading', 'head', 'roll'],                                 field: 'heading' },
  { patterns: ['hem'],                                                     field: 'hem' },
  { patterns: ['track', 'base bar', 'bar col'],                            field: 'trackBaseBarColour' },
  { patterns: ['chain'],                                                   field: 'chainColour' },
  { patterns: ['note', 'comment', 'special'],                              field: 'notes' },
];

function autoDetectMapping(headers) {
  const mapping = {};
  const usedFields = new Set();
  headers.forEach((header, idx) => {
    const h = String(header || '').toLowerCase().trim();
    if (!h) { mapping[idx] = '__skip'; return; }
    let matched = '__skip';
    for (const rule of HEADER_RULES) {
      if (rule.patterns.some(p => h.includes(p)) && !usedFields.has(rule.field)) {
        matched = rule.field;
        usedFields.add(rule.field);
        break;
      }
    }
    mapping[idx] = matched;
  });
  return mapping;
}

// ─── Find the header row index ─────────────────────────────────────────────────
// Scan up to 20 rows looking for the row with the most keyword hits
function findHeaderRowIndex(rows) {
  const keywords = ['location', 'product', 'width', 'drop', 'qty', 'quantity',
    'fabric', 'colour', 'color', 'control', 'heading', 'return', 'fixing', 'hem',
    'track', 'chain', 'note', 'room', 'area'];
  let bestIdx = 0;
  let bestScore = 0;
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    const score = row.filter(cell => {
      const v = String(cell || '').toLowerCase().trim();
      return keywords.some(k => v.includes(k));
    }).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestScore >= 2 ? bestIdx : 0;
}

// ─── Row parsing ───────────────────────────────────────────────────────────────
function safeNum(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = parseFloat(String(val).replace(/[^\d.]/g, ''));
  return isNaN(n) ? '' : n;
}

const HEADER_KEYWORDS = ['location', 'product', 'quantity', 'width', 'drop', 'fabric', 'colour', 'color', 'control'];

function isSkipRow(row, headerIdx, rowIdx) {
  if (rowIdx <= headerIdx) return true;
  const cells = row.filter(c => c !== undefined && c !== null && String(c).trim() !== '');
  if (cells.length === 0) return true;
  const first = String(row[0] || '').toLowerCase().trim();
  if (/^(total|sub.total|grand total|sum|subtotal)/.test(first)) return true;
  // Skip repeated header rows (e.g. rows 31, 57 in the standard template)
  const headerHits = cells.filter(c => {
    const v = String(c).toLowerCase().trim();
    return HEADER_KEYWORDS.some(k => v === k || v.startsWith(k));
  }).length;
  if (headerHits >= 3) return true;
  return false;
}

function parseRows(rawRows, headerRowIdx, mapping) {
  const items = [];
  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    if (isSkipRow(row, headerRowIdx, i)) continue;

    const item = {
      id: uuidv4(),
      location: '', productNameSnapshot: '', quantity: 1,
      widthMm: '', dropMm: '', fabricColour: '', control: '',
      returnSide: '', fixing: '', heading: '', hem: '',
      trackBaseBarColour: '', chainColour: '', notes: '',
      productTypeId: '', motorSide: '', attachedLining: false,
      liningFabricColour: '', trackType: '', baseBarType: '', sortOrder: i,
      _sourceRow: i + 1,
      _warnings: [],
    };

    let hasAnyData = false;

    Object.entries(mapping).forEach(([colIdx, field]) => {
      if (field === '__skip') return;
      const val = row[Number(colIdx)];
      const str = String(val ?? '').trim();
      if (!str || str === '0') return;
      hasAnyData = true;

      if (field === 'quantity') {
        const n = safeNum(str);
        item.quantity = n !== '' ? n : 1;
      } else if (field === 'widthMm' || field === 'dropMm') {
        item[field] = safeNum(str);
      } else {
        item[field] = str;
      }
    });

    if (!hasAnyData) continue;

    // Warnings
    if (!item.location) item._warnings.push('Missing location/room');
    if (!item.productNameSnapshot) item._warnings.push('Missing product name');
    if (!item.quantity || item.quantity <= 0) item._warnings.push('Invalid quantity');

    items.push(item);
  }
  return items;
}

// ─── Excel column letter helper ────────────────────────────────────────────────
function colLetter(idx) {
  let s = '';
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function StageIndicator({ stage }) {
  const stages = ['upload', 'mapping', 'preview', 'done'];
  const labels = ['Upload', 'Map Columns', 'Preview', 'Done'];
  const current = stages.indexOf(stage);
  return (
    <div className="flex items-center gap-1 mb-6">
      {stages.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            i < current ? 'bg-green-500 text-white' :
            i === current ? 'bg-amber-500 text-white' :
            'bg-slate-100 text-slate-400'
          }`}>
            {i < current ? <CheckCircle2 size={12} /> : i + 1}
          </div>
          <span className={`text-xs font-medium hidden sm:inline ${
            i === current ? 'text-slate-800' : 'text-slate-400'
          }`}>{labels[i]}</span>
          {i < stages.length - 1 && <div className={`w-6 h-px mx-1 ${i < current ? 'bg-green-300' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );
}

function ContextBanner({ customer, job }) {
  if (!customer) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm mb-4">
      <ClipboardList size={14} className="text-amber-500 flex-shrink-0" />
      <span className="text-amber-800 font-medium">{customer.name}</span>
      {job && <><span className="text-amber-400">·</span><span className="text-amber-700">{job.jobNumber}</span></>}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function ImportMeasureSheet() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAM = true, displayName = '' } = useProfile() || {};

  const preCustomerId = searchParams.get('customerId') || null;
  const preJobId      = searchParams.get('jobId')      || null;

  const [refreshKey, setRefreshKey] = useState(0);
  const allCustomers = useMemo(() => getCustomers(), [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const allJobs      = useMemo(() => getJobs(),      []);

  // Context
  const [customerId,     setCustomerId]     = useState(preCustomerId);
  const [jobId,          setJobId]          = useState(preJobId);
  const [jobMode,        setJobMode]        = useState(preJobId ? 'select' : 'select'); // 'select' | 'create' | 'skip'
  const [newJobType,     setNewJobType]     = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [editingCust,    setEditingCust]    = useState(!preCustomerId);

  // New customer creation
  const [customerMode,      setCustomerMode]      = useState('select'); // 'select' | 'new'
  const [newCustomerForm,   setNewCustomerForm]   = useState({ name: '', phone: '', email: '', address: '', notes: '' });
  const [newCustomerErrors, setNewCustomerErrors] = useState({});
  const [potentialDups,     setPotentialDups]     = useState([]);
  const [dupConfirmed,      setDupConfirmed]      = useState(false);
  const [creatingCustomer,  setCreatingCustomer]  = useState(false);

  const customer = useMemo(() => customerId ? allCustomers.find(c => c.id === customerId) : null, [customerId, allCustomers]);
  const job      = useMemo(() => (jobId && jobId !== '__none') ? allJobs.find(j => j.id === jobId) : null, [jobId, allJobs]);

  // Stage
  const [stage, setStage] = useState('upload');

  // File / workbook
  const [fileName,   setFileName]   = useState('');
  const [workbook,   setWorkbook]   = useState(null);
  const [activeSheet,setActiveSheet]= useState('');
  const [parseError, setParseError] = useState('');
  const [fileLoading,setFileLoading]= useState(false);
  const fileRef = useRef(null);

  // Mapping
  const [rawRows,      setRawRows]      = useState([]);
  const [headerRowIdx, setHeaderRowIdx] = useState(0);
  const [headers,      setHeaders]      = useState([]);
  const [mapping,      setMapping]      = useState({});

  // Preview
  const [previewRows, setPreviewRows] = useState([]);
  const [selectedRows,setSelectedRows]= useState(new Set());
  const [editingRow,  setEditingRow]  = useState(null);

  // Save
  const [saving,       setSaving]       = useState(false);
  const [savedSheetId, setSavedSheetId] = useState(null);

  // ── Customer / Job selection ─────────────────────────────────────────────
  const customerResults = useMemo(() => {
    if (!customerSearch.trim() || customerSearch.length < 2) return [];
    const q = customerSearch.toLowerCase();
    return allCustomers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    ).slice(0, 6);
  }, [customerSearch, allCustomers]);

  const availableJobs = useMemo(() =>
    customerId ? allJobs.filter(j => j.customerId === customerId) : [],
    [customerId, allJobs]
  );

  const jobResolved = !!(job || jobMode === 'create' || jobMode === 'skip' || jobId === '__none' || availableJobs.length === 0);

  // ── Parse sheet when active sheet changes ────────────────────────────────
  const loadSheet = useCallback((wb, name) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const hIdx = findHeaderRowIndex(rows);
    const hRow = (rows[hIdx] || []).map(c => String(c ?? '').trim());
    setRawRows(rows);
    setHeaderRowIdx(hIdx);
    setHeaders(hRow);
    setMapping(autoDetectMapping(hRow));
  }, []);

  // ── File upload ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setParseError(`Unsupported file type ".${ext}". Please upload an .xlsx, .xls, or .csv file.`);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setParseError('File is too large (max 20 MB).');
      return;
    }
    setFileLoading(true);
    setParseError('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      // Always use Sheet1 — other sheets are pricing/calculation references
      const sheetName = wb.SheetNames.includes('Sheet1') ? 'Sheet1' : wb.SheetNames[0];
      setWorkbook(wb);
      setActiveSheet(sheetName);
      setFileName(file.name);
      loadSheet(wb, sheetName);
      setStage('mapping');
    } catch (err) {
      setParseError(`Could not parse file: ${err.message}`);
    } finally {
      setFileLoading(false);
    }
  }, [loadSheet]);

  const onFileChange = (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); };
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── Proceed to preview ───────────────────────────────────────────────────
  const handleGoPreview = () => {
    const rows = parseRows(rawRows, headerRowIdx, mapping);
    setPreviewRows(rows);
    const auto = new Set(rows.filter(r => r._warnings.length === 0).map(r => r.id));
    setSelectedRows(auto);
    setStage('preview');
  };

  const toggleRow = (id) => setSelectedRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll   = () => setSelectedRows(new Set(previewRows.map(r => r.id)));
  const deselectAll = () => setSelectedRows(new Set());

  const updatePreviewRow = (id, field, value) => {
    setPreviewRows(rows => rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const removePreviewRow = (id) => {
    setPreviewRows(rows => rows.filter(r => r.id !== id));
    setSelectedRows(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  // ── Create new customer ──────────────────────────────────────────────────
  const handleCreateCustomer = (force = false) => {
    const errors = {};
    if (!newCustomerForm.name.trim()) errors.name = 'Name is required';
    setNewCustomerErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Duplicate detection (skip if already confirmed or force=true)
    if (!dupConfirmed && !force) {
      const q = newCustomerForm.name.toLowerCase().trim();
      const ph = newCustomerForm.phone?.replace(/\D/g, '') || '';
      const em = newCustomerForm.email?.toLowerCase().trim() || '';

      const dups = allCustomers.filter(c => {
        const nameMatch  = q.length >= 3 && (c.name || '').toLowerCase().includes(q);
        const phoneMatch = ph.length >= 7 && (c.phone || '').replace(/\D/g, '').includes(ph);
        const emailMatch = em.length >= 5 && (c.email || '').toLowerCase() === em;
        return nameMatch || phoneMatch || emailMatch;
      }).slice(0, 4);

      if (dups.length > 0) {
        setPotentialDups(dups);
        return; // Show dup panel — user must confirm or use existing
      }
    }

    setCreatingCustomer(true);
    try {
      const newId = uuidv4();
      const newCust = {
        id:      newId,
        name:    newCustomerForm.name.trim(),
        phone:   newCustomerForm.phone.trim(),
        email:   newCustomerForm.email.trim(),
        address: newCustomerForm.address.trim(),
        notes:   newCustomerForm.notes.trim(),
      };
      saveCustomer(newCust);
      setRefreshKey(k => k + 1);
      setCustomerId(newId);
      setEditingCust(false);
      setCustomerMode('select');
      setNewCustomerForm({ name: '', phone: '', email: '', address: '', notes: '' });
      setNewCustomerErrors({});
      setPotentialDups([]);
      setDupConfirmed(false);
    } catch (err) {
      setNewCustomerErrors({ submit: err.message || 'Failed to create customer' });
    } finally {
      setCreatingCustomer(false);
    }
  };

  const ncf = (field, value) => {
    setNewCustomerForm(f => ({ ...f, [field]: value }));
    setNewCustomerErrors(e => { const n = { ...e }; delete n[field]; return n; });
    setPotentialDups([]);
    setDupConfirmed(false);
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!customerId) { alert('Please select a customer first.'); return; }
    setSaving(true);
    try {
      const selectedItems = previewRows
        .filter(r => selectedRows.has(r.id))
        .map((r, i) => {
          const { _sourceRow, _warnings, ...item } = r;
          return { ...item, sortOrder: i };
        });

      const cust = getCustomer(customerId);
      const sheetId = uuidv4();
      const now = new Date().toISOString();

      const resolvedJobId = (jobId && jobId !== '__none') ? jobId : null;

      const sheet = {
        id: sheetId,
        status: 'Submitted',
        customerId,
        jobId: resolvedJobId,
        customerName:  cust?.name    || '',
        phone:         cust?.phone   || '',
        email:         cust?.email   || '',
        siteAddress:   cust?.address || '',
        billingAddress: cust?.billingAddress || cust?.address || '',
        preferredContact: 'Any',
        customerNotes: cust?.notes || '',
        measurer: displayName || 'Imported',
        jobType: job?.jobType || '',
        measureDate: now.slice(0, 10),
        urgency: 'Normal',
        accessInstructions: '', parkingNotes: '', siteConditionNotes: '',
        internalNotes: `Imported from Excel: ${fileName}`,
        lineItems: selectedItems,
        importedFromExcel: true,
        originalFileName: fileName,
        importedAt: now,
        createdAt: now,
      };

      saveMeasureSheet(sheet);

      // Create and link a new job if requested
      if (jobMode === 'create' && !resolvedJobId) {
        const sheetForJob = { ...sheet, jobType: newJobType || '' };
        const newJob = createJobFromMeasureSheet(sheetForJob, cust);
        saveMeasureSheet({ ...sheet, jobId: newJob.id, status: 'Submitted' });
      }

      setSavedSheetId(sheetId);
      setStage('done');
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = selectedRows.size;
  const warnCount = previewRows.filter(r => selectedRows.has(r.id) && r._warnings.length > 0).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 pb-24">

      {/* Header */}
      <BackButton fallback={preJobId ? `/jobs/${preJobId}` : '/measure-sheets'} />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import Measure Sheet</h1>
        <p className="text-slate-500 text-sm mt-0.5">Convert an Excel measure sheet into a Lusso record</p>
      </div>

      <StageIndicator stage={stage} />

      {/* Compact context banner — shown when launched from a Job Workspace */}
      {(preCustomerId && preJobId) && customer && stage !== 'done' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <ClipboardList size={16} className="text-amber-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">{customer.name}</p>
            {job && <p className="text-xs text-amber-700 mt-0.5">{job.jobNumber} · {job.jobType || job.status}</p>}
          </div>
          <span className="ml-auto text-xs text-amber-600 font-medium">Importing into this job</span>
        </div>
      )}

      {/* Context picker — hidden when launched from a Job Workspace (both IDs pre-set) */}
      {stage !== 'done' && !(preCustomerId && preJobId) && (
        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-slate-800 text-sm">Link to Customer & Job</h2>

          {/* ── Customer ─────────────────────────────────────────────────── */}
          {customer && !editingCust ? (
            /* Customer confirmed */
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{customer.name}</p>
                <p className="text-xs text-slate-400">{customer.phone || customer.email || customer.address || ''}</p>
              </div>
              <button
                onClick={() => { setCustomerId(null); setJobId(null); setCustomerSearch(''); setEditingCust(true); setCustomerMode('select'); }}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Mode toggle */}
              <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-medium">
                <button
                  onClick={() => { setCustomerMode('select'); setPotentialDups([]); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                    customerMode === 'select'
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <UserCheck size={14} />
                  <span>Select Existing</span>
                </button>
                <button
                  onClick={() => { setCustomerMode('new'); setCustomerSearch(''); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                    customerMode === 'new'
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <UserPlus size={14} />
                  <span>Create New</span>
                </button>
              </div>

              {customerMode === 'select' ? (
                /* ── Search existing ── */
                <div className="space-y-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      autoFocus
                      value={customerSearch}
                      onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Search by name, phone or email…"
                      className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  {customerResults.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 shadow-sm">
                      {customerResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => { setCustomerId(c.id); setJobId(null); setCustomerSearch(''); setEditingCust(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 text-left transition-colors"
                        >
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-700">
                            {c.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                            <p className="text-xs text-slate-400 truncate">{c.phone || c.email || c.address || ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {customerSearch.length > 0 && customerSearch.length < 2 && (
                    <p className="text-xs text-slate-400 pl-1">Keep typing to search…</p>
                  )}
                </div>
              ) : (
                /* ── Create new customer form ── */
                <div className="space-y-3">
                  {/* Duplicate warning panel */}
                  {potentialDups.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                        <p className="text-xs font-semibold text-amber-800">
                          {potentialDups.length} possible match{potentialDups.length !== 1 ? 'es' : ''} found
                        </p>
                      </div>
                      <div className="space-y-1">
                        {potentialDups.map(c => (
                          <div key={c.id} className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                            <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-700">
                              {c.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">{c.name}</p>
                              <p className="text-xs text-slate-400 truncate">{c.phone || c.email || ''}</p>
                            </div>
                            <button
                              onClick={() => { setCustomerId(c.id); setEditingCust(false); setCustomerMode('select'); setPotentialDups([]); }}
                              className="text-xs font-semibold text-amber-700 hover:text-amber-900 whitespace-nowrap flex-shrink-0"
                            >
                              Use this
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => { setPotentialDups([]); handleCreateCustomer(true); }}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                      >
                        Create anyway — this is a different person
                      </button>
                    </div>
                  )}

                  {/* Form fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Full Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        autoFocus
                        value={newCustomerForm.name}
                        onChange={e => ncf('name', e.target.value)}
                        placeholder="e.g. Sarah Mitchell"
                        className={`w-full border rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                          newCustomerErrors.name ? 'border-red-400 bg-red-50' : 'border-slate-200'
                        }`}
                      />
                      {newCustomerErrors.name && (
                        <p className="text-xs text-red-500 mt-1">{newCustomerErrors.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={newCustomerForm.phone}
                        onChange={e => ncf('phone', e.target.value)}
                        placeholder="04xx xxx xxx"
                        className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                      <input
                        type="email"
                        value={newCustomerForm.email}
                        onChange={e => ncf('email', e.target.value)}
                        placeholder="name@example.com"
                        className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
                      <input
                        value={newCustomerForm.address}
                        onChange={e => ncf('address', e.target.value)}
                        placeholder="Street address"
                        className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                      <textarea
                        value={newCustomerForm.notes}
                        onChange={e => ncf('notes', e.target.value)}
                        rows={2}
                        placeholder="Any notes about this customer…"
                        className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                      />
                    </div>
                  </div>

                  {newCustomerErrors.submit && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                      <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
                      <p className="text-xs text-red-700">{newCustomerErrors.submit}</p>
                    </div>
                  )}

                  <button
                    onClick={() => handleCreateCustomer(false)}
                    disabled={creatingCustomer || !newCustomerForm.name.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-5 rounded-xl transition-colors"
                  >
                    {creatingCustomer ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <UserPlus size={14} />
                        Create Customer &amp; Continue
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Job ──────────────────────────────────────────────────────── */}
          {customer && !editingCust && (
            job && jobMode === 'select' ? (
              /* Existing job confirmed */
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <CheckCircle2 size={16} className="text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{job.jobNumber} — {job.jobType}</p>
                  <p className="text-xs text-slate-400">{job.status}</p>
                </div>
                {!preJobId && (
                  <button onClick={() => { setJobId(null); setJobMode('select'); }}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                    Change
                  </button>
                )}
              </div>
            ) : jobMode === 'create' ? (
              /* Create new job mode */
              <div className="space-y-2.5 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Create New Job on Import</p>
                  <button onClick={() => setJobMode('select')} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                    Cancel
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Job Type</label>
                  <select
                    value={newJobType}
                    onChange={e => setNewJobType(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">— Select job type —</option>
                    {(JOB_TYPES || []).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <p className="text-xs text-amber-700">A new job will be created and linked to this measure sheet when you import.</p>
              </div>
            ) : jobMode === 'skip' ? (
              /* Skipped */
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                <p className="text-sm text-slate-500 flex-1">No job — linked to customer only</p>
                <button onClick={() => setJobMode('select')} className="text-xs text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
                  Change
                </button>
              </div>
            ) : (
              /* Job picker */
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Job <span className="font-normal normal-case text-slate-400">(optional)</span>
                </p>

                {availableJobs.length > 0 && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 shadow-sm">
                    {availableJobs.map(j => (
                      <button
                        key={j.id}
                        onClick={() => { setJobId(j.id); setJobMode('select'); }}
                        className="w-full flex items-center gap-3 px-3 py-3 hover:bg-amber-50 text-left transition-colors"
                      >
                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <ClipboardList size={13} className="text-slate-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800">{j.jobNumber}</p>
                          <p className="text-xs text-slate-400">{j.jobType} · {j.status}</p>
                        </div>
                        <ArrowRight size={13} className="text-slate-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Create new job option */}
                <button
                  onClick={() => setJobMode('create')}
                  className="w-full flex items-center gap-2 px-3 py-3 border border-dashed border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-xl text-left transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-200 flex items-center justify-center flex-shrink-0">
                    <Plus size={13} className="text-amber-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Create new job on import</p>
                    <p className="text-xs text-amber-600">Automatically creates and links a job</p>
                  </div>
                </button>

                <button
                  onClick={() => setJobMode('skip')}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors pl-1"
                >
                  Skip — link to customer only
                </button>
              </div>
            )
          )}
        </Card>
      )}

      {/* ── STAGE: UPLOAD ─────────────────────────────────────────────────── */}
      {stage === 'upload' && (
        <Card className="p-6">
          <div
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed border-slate-200 hover:border-amber-400 rounded-2xl p-12 text-center transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            {fileLoading ? (
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto animate-pulse">
                  <FileSpreadsheet size={24} className="text-amber-500" />
                </div>
                <p className="text-sm text-slate-500 animate-pulse">Parsing Excel file…</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
                  <Upload size={26} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Drop your Excel file here</p>
                  <p className="text-xs text-slate-400 mt-1">Supports .xlsx · .xls · .csv · Max 20 MB</p>
                </div>
                <button className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                  <FileSpreadsheet size={15} /> Browse Files
                </button>
              </div>
            )}
          </div>
          {parseError && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{parseError}</p>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
        </Card>
      )}

      {/* ── STAGE: MAPPING ────────────────────────────────────────────────── */}
      {stage === 'mapping' && workbook && (
        <div className="space-y-4">
          {/* File info */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
                <FileSpreadsheet size={14} className="text-green-600" />
                <span className="text-sm font-medium text-green-700 truncate max-w-[200px]">{fileName}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>Sheet: <strong className="text-slate-600">{activeSheet}</strong></span>
                <span>·</span>
                <span>Header at row <strong className="text-slate-600">{headerRowIdx + 1}</strong></span>
                <span>·</span>
                <span><strong className="text-slate-600">{headers.filter(Boolean).length}</strong> columns</span>
                <span>·</span>
                <span><strong className="text-slate-600">{rawRows.length - headerRowIdx - 1}</strong> data rows</span>
              </div>
            </div>
          </Card>

          {/* Column mapping */}
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm">Map Columns</h2>
              <p className="text-xs text-slate-400">Confirm how each Excel column maps to a Lusso field</p>
            </div>
            <div className="divide-y divide-slate-50 max-h-[50vh] overflow-y-auto">
              {headers.map((header, idx) => (
                <div key={idx} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 text-xs font-bold text-slate-400 font-mono flex-shrink-0">
                    {colLetter(idx)}
                  </div>
                  <div className="w-36 flex-shrink-0 truncate">
                    <span className="text-sm text-slate-700 font-medium">{header || <span className="text-slate-300 italic">empty</span>}</span>
                  </div>
                  <ArrowRight size={12} className="text-slate-300 flex-shrink-0" />
                  <select
                    value={mapping[idx] || '__skip'}
                    onChange={e => setMapping(m => ({ ...m, [idx]: e.target.value }))}
                    className="flex-1 border border-slate-200 rounded-lg text-sm px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {LUSSO_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex gap-3">
            <button onClick={() => setStage('upload')}
              className="flex-1 sm:flex-none border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 px-5 rounded-xl transition-colors">
              ← Back
            </button>
            <button onClick={handleGoPreview}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 px-5 rounded-xl transition-colors flex items-center justify-center gap-2">
              Preview Rows <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── STAGE: PREVIEW ────────────────────────────────────────────────── */}
      {stage === 'preview' && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-700">
                <span className="font-bold text-slate-900">{previewRows.length}</span> rows detected
                {warnCount > 0 && (
                  <span className="ml-2 text-amber-600 flex items-center gap-1 inline-flex">
                    <AlertTriangle size={12} /> {warnCount} warning{warnCount !== 1 ? 's' : ''}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{selectedCount} selected for import</p>
            </div>
            <button onClick={selectAll}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              <CheckSquare size={13} /> Select All
            </button>
            <button onClick={deselectAll}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              <Square size={13} /> Deselect All
            </button>
          </div>

          {/* Preview table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-3 py-2.5 w-8"></th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-8">#</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Location</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Product</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-14">Qty</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-20">Width mm</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 w-20">Drop mm</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Colour</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Notes</th>
                    <th className="px-3 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-400 text-sm">
                        No data rows detected. Try adjusting the column mapping or selecting a different sheet.
                      </td>
                    </tr>
                  ) : previewRows.map((row, i) => {
                    const sel = selectedRows.has(row.id);
                    const editing = editingRow === row.id;
                    const hasWarn = row._warnings.length > 0;
                    return (
                      <tr key={row.id}
                        className={`transition-colors ${
                          sel
                            ? hasWarn ? 'bg-amber-50/60' : 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/80 opacity-50'
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-3 py-2.5">
                          <button onClick={() => toggleRow(row.id)}>
                            {sel
                              ? <CheckSquare size={15} className="text-amber-500" />
                              : <Square size={15} className="text-slate-300" />}
                          </button>
                        </td>
                        {/* Row # */}
                        <td className="px-3 py-2.5 text-xs text-slate-400">{row._sourceRow}</td>
                        {/* Editable cells */}
                        {editing ? (
                          <>
                            <EditCell value={row.location}            onChange={v => updatePreviewRow(row.id, 'location', v)} />
                            <EditCell value={row.productNameSnapshot} onChange={v => updatePreviewRow(row.id, 'productNameSnapshot', v)} />
                            <EditCell value={row.quantity}            onChange={v => updatePreviewRow(row.id, 'quantity', v)} type="number" width="w-14" />
                            <EditCell value={row.widthMm}             onChange={v => updatePreviewRow(row.id, 'widthMm', v)} type="number" width="w-20" />
                            <EditCell value={row.dropMm}              onChange={v => updatePreviewRow(row.id, 'dropMm', v)} type="number" width="w-20" />
                            <EditCell value={row.fabricColour}        onChange={v => updatePreviewRow(row.id, 'fabricColour', v)} />
                            <EditCell value={row.notes}               onChange={v => updatePreviewRow(row.id, 'notes', v)} />
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2.5 text-sm text-slate-700 max-w-[120px] truncate">
                              {row.location || <span className="text-slate-300">—</span>}
                              {row._warnings.includes('Missing location/room') && <span className="text-amber-500 ml-1 text-xs">⚠</span>}
                            </td>
                            <td className="px-3 py-2.5 text-sm text-slate-700 max-w-[140px] truncate">
                              {row.productNameSnapshot || <span className="text-slate-300">—</span>}
                              {row._warnings.includes('Missing product name') && <span className="text-amber-500 ml-1 text-xs">⚠</span>}
                            </td>
                            <td className="px-3 py-2.5 text-sm text-slate-700 w-14">{row.quantity ?? '—'}</td>
                            <td className="px-3 py-2.5 text-sm text-slate-700 w-20">{row.widthMm || '—'}</td>
                            <td className="px-3 py-2.5 text-sm text-slate-700 w-20">{row.dropMm || '—'}</td>
                            <td className="px-3 py-2.5 text-sm text-slate-700 max-w-[100px] truncate">{row.fabricColour || '—'}</td>
                            <td className="px-3 py-2.5 text-sm text-slate-400 max-w-[120px] truncate">{row.notes || ''}</td>
                          </>
                        )}
                        {/* Actions */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingRow(editing ? null : row.id)}
                              className={`p-1 rounded transition-colors ${editing ? 'text-amber-500' : 'text-slate-300 hover:text-slate-600'}`}
                              title={editing ? 'Done editing' : 'Edit row'}
                            >
                              {editing ? <CheckCircle2 size={13} /> : <ChevronDown size={13} />}
                            </button>
                            <button onClick={() => removePreviewRow(row.id)}
                              className="p-1 rounded text-slate-200 hover:text-red-500 transition-colors"
                              title="Remove row">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Warnings summary */}
          {warnCount > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">
                  {warnCount} selected row{warnCount !== 1 ? 's have' : ' has'} warnings
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Rows with ⚠ are missing required fields. They'll be imported but may need editing after import.
                </p>
              </div>
            </div>
          )}

          {!customerId && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">Please select a customer above before importing.</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStage('mapping')}
              className="flex-1 sm:flex-none border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 px-5 rounded-xl transition-colors">
              ← Back
            </button>
            <button
              onClick={handleSave}
              disabled={saving || selectedCount === 0 || !customerId}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-5 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {saving
                ? 'Saving…'
                : `Import ${selectedCount} Row${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── STAGE: DONE ───────────────────────────────────────────────────── */}
      {stage === 'done' && savedSheetId && (
        <Card className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-green-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Import Complete</h2>
            <p className="text-slate-500 text-sm mt-1">
              {selectedCount} item{selectedCount !== 1 ? 's' : ''} imported from <span className="font-medium">{fileName}</span>
            </p>
            {customer && (
              <p className="text-slate-400 text-xs mt-1">
                Linked to {customer.name}{job ? ` · ${job.jobNumber}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              onClick={() => navigate(`/measure-sheets/${savedSheetId}`)}
              className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 px-6 rounded-xl transition-colors"
            >
              View Measure Sheet
            </button>
            <button
              onClick={() => navigate('/measure-sheets')}
              className="border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 px-6 rounded-xl transition-colors"
            >
              All Measure Sheets
            </button>
          </div>
        </Card>
      )}

    </div>
  );
}

// ─── Inline edit cell ──────────────────────────────────────────────────────────
function EditCell({ value, onChange, type = 'text', width = '' }) {
  return (
    <td className={`px-1 py-1.5 ${width}`}>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(type === 'number' ? e.target.valueAsNumber || '' : e.target.value)}
        className="w-full border border-amber-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-amber-50"
      />
    </td>
  );
}
