import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Upload, FileText, ChevronRight, AlertTriangle, CheckCircle2,
  XCircle, SkipForward, RefreshCw, Download, History, ArrowRight,
  Info, X, Loader2, Library, Plus, Search, Edit2, Trash2,
  ToggleLeft, ToggleRight, DollarSign, Tag, ChevronDown, Cloud, CloudOff, Sparkles,
  CheckSquare, Square,
} from 'lucide-react';
import {
  getPricedItems, savePricedItem, deletePricedItem,
  getPricedItemBatches, createPricedItemBatch, runPricedItemImport,
  savePricedItemBatch,
} from '../store/data';
import Card from '../components/Card';
import BackButton from '../components/BackButton';
import { v4 as uuidv4 } from 'uuid';

// ─── Field definitions ────────────────────────────────────────────────────────

const LUSSO_ITEM_FIELDS = [
  { key: '',             label: '— Skip column —' },
  { key: 'itemName',     label: 'Item Name / Title' },
  { key: 'itemCode',     label: 'Item Code / SKU' },
  { key: 'description',  label: 'Description' },
  { key: 'category',     label: 'Category' },
  { key: 'supplier',     label: 'Supplier' },
  { key: 'unitType',     label: 'Unit Type' },
  { key: 'costPrice',    label: 'Cost Price' },
  { key: 'sellPrice',    label: 'Sell Price / Unit Price' },
  { key: 'labourCost',   label: 'Labour Cost' },
  { key: 'marginPercent',label: 'Margin %' },
  { key: 'taxRate',      label: 'Tax Rate / GST' },
  { key: 'notes',        label: 'Notes' },
  { key: 'tags',         label: 'Tags' },
];

const FIELD_ALIASES = {
  itemcode: 'itemCode', code: 'itemCode', sku: 'itemCode',
  itemtitle: 'itemName', title: 'itemName', name: 'itemName', item: 'itemName',
  longdescription: 'description', description: 'description',
  costprice: 'costPrice', cost: 'costPrice',
  unitprice: 'sellPrice', sellprice: 'sellPrice', price: 'sellPrice',
  salescategory: 'category', category: 'category',
  taxrate: 'taxRate', tax: 'taxRate', gst: 'taxRate',
  supplier: 'supplier',
  unit: 'unitType', unittype: 'unitType',
  notes: 'notes', tags: 'tags',
  labourcost: 'labourCost', labor: 'labourCost', labour: 'labourCost',
  marginpercent: 'marginPercent', margin: 'marginPercent',
};

// ─── CSV parser (same as ImportContacts) ──────────────────────────────────────

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
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

function normalizeHeader(h) { return h.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function autoDetectMapping(headers) {
  const map = {};
  headers.forEach(h => { map[h] = FIELD_ALIASES[normalizeHeader(h)] ?? ''; });
  return map;
}

// ─── Pricing helpers ──────────────────────────────────────────────────────────

function parsePrice(v) {
  const s = String(v || '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseTaxRate(v) {
  if (!v) return { taxRate: 10, gstApplicable: true };
  const m = String(v).match(/(\d+(?:\.\d+)?)\s*%/);
  return {
    taxRate: m ? parseFloat(m[1]) : 10,
    gstApplicable: /gst/i.test(String(v)) || Boolean(m),
  };
}

function calcPricing(costPrice, sellPrice, labourCost, marginPercent) {
  const cost   = costPrice   ?? 0;
  const labour = labourCost  ?? 0;
  const total  = cost + labour;

  if (sellPrice != null && sellPrice > 0) {
    const gp      = sellPrice - total;
    const margin  = (gp / sellPrice) * 100;
    const markup  = total > 0 ? (gp / total) * 100 : 0;
    return { sellPrice, marginPercent: margin, markupPercent: markup };
  }
  if (marginPercent != null && marginPercent > 0 && marginPercent < 100) {
    const sell   = total / (1 - marginPercent / 100);
    const gp     = sell - total;
    const markup = total > 0 ? (gp / total) * 100 : 0;
    return { sellPrice: sell, marginPercent, markupPercent: markup };
  }
  return { sellPrice: null, marginPercent: null, markupPercent: null };
}

function fmtPrice(v) {
  if (v == null || v === '') return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(v);
}

// ─── Row processing ───────────────────────────────────────────────────────────

function processItemRows(rawRows, headers, columnMap, existing, globalDupAction) {
  const seen = new Set();
  return rawRows.map((cells, idx) => {
    const raw = {};
    headers.forEach((h, i) => {
      const field = columnMap[h];
      if (field) raw[field] = cells[i]?.trim() || '';
    });

    const mapped = {
      itemName:    raw.itemName    || '',
      itemCode:    raw.itemCode    || '',
      description: raw.description || '',
      category:    raw.category    || '',
      supplier:    raw.supplier    || '',
      unitType:    raw.unitType    || '',
      costPrice:   parsePrice(raw.costPrice),
      sellPrice:   parsePrice(raw.sellPrice),
      labourCost:  parsePrice(raw.labourCost),
      notes:       raw.notes       || '',
      tags:        raw.tags        || '',
      ...parseTaxRate(raw.taxRate),
    };

    // Calculate derived pricing
    const pricing = calcPricing(mapped.costPrice, mapped.sellPrice, mapped.labourCost, parsePrice(raw.marginPercent));
    mapped.sellPrice     = pricing.sellPrice;
    mapped.marginPercent = pricing.marginPercent;
    mapped.markupPercent = pricing.markupPercent;

    // Validate
    const errors = [];
    if (!mapped.itemName && !mapped.description) {
      return { rowNum: idx + 1, mapped, status: 'empty', errors: ['Empty row'], isDuplicate: false, duplicate: null, rowAction: 'skip' };
    }
    if (mapped.costPrice != null && mapped.costPrice < 0) errors.push('Cost price must be ≥ 0');
    if (mapped.sellPrice != null && mapped.sellPrice < 0) errors.push('Sell price must be ≥ 0');

    // Intra-CSV dupe detection
    const dedup = [mapped.itemCode, mapped.itemName].filter(Boolean).join('|').toLowerCase();
    if (dedup && seen.has(dedup)) errors.push('Duplicate within CSV');
    if (dedup) seen.add(dedup);

    if (errors.length > 0) {
      return { rowNum: idx + 1, mapped, status: 'error', errors, isDuplicate: errors.some(e => e.includes('Duplicate')), duplicate: null, rowAction: 'skip' };
    }

    // Check against existing
    const dup = findItemDuplicate(existing, mapped);
    if (dup) {
      return { rowNum: idx + 1, mapped, status: 'duplicate', errors: [`Matches by ${dup.field}`], isDuplicate: true, duplicate: dup.item, dupField: dup.field, rowAction: globalDupAction };
    }

    return { rowNum: idx + 1, mapped, status: 'ready', errors: [], isDuplicate: false, duplicate: null, rowAction: 'import' };
  });
}

function findItemDuplicate(existing, mapped) {
  if (mapped.itemCode) {
    const m = existing.find(p => p.itemCode && p.itemCode.toLowerCase() === mapped.itemCode.toLowerCase());
    if (m) return { item: m, field: 'item code' };
  }
  if (mapped.itemName) {
    const nm = mapped.itemName.toLowerCase();
    const m  = existing.find(p => p.itemName.toLowerCase() === nm);
    if (m) return { item: m, field: 'item name' };
  }
  return null;
}

// ─── CSV download ─────────────────────────────────────────────────────────────

function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadErrorReport(rows, fileName) {
  const hdrs = ['Row', 'Item Name', 'Code', 'Category', 'Cost', 'Sell', 'Status', 'Reason', 'Duplicate Match'];
  const body = rows
    .filter(r => r.status !== 'ready')
    .map(r => [
      r.rowNum,
      csvEscape(r.mapped?.itemName || ''),
      csvEscape(r.mapped?.itemCode || ''),
      csvEscape(r.mapped?.category || ''),
      r.mapped?.costPrice ?? '',
      r.mapped?.sellPrice ?? '',
      r.status,
      csvEscape(r.errors?.join('; ') || ''),
      csvEscape(r.duplicate ? `${r.duplicate.itemName} (${r.duplicate.itemCode})` : ''),
    ].join(','));
  const csv = [hdrs.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `priced-items-errors-${fileName.replace(/[^a-z0-9]/gi, '-')}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Status badges ────────────────────────────────────────────────────────────

function RowStatusBadge({ status, action }) {
  if (status === 'empty')     return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400"><SkipForward size={10}/>Empty</span>;
  if (status === 'error')     return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-500"><XCircle size={10}/>Error</span>;
  if (status === 'duplicate') {
    if (action === 'update') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600"><RefreshCw size={10}/>Update</span>;
    if (action === 'create') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-600"><Plus size={10}/>Create New</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600"><AlertTriangle size={10}/>Duplicate</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-600"><CheckCircle2 size={10}/>Ready</span>;
}

// ─── EMPTY ITEM form ──────────────────────────────────────────────────────────

const EMPTY_ITEM = () => ({
  id: uuidv4(), itemName: '', itemCode: '', description: '', category: '',
  supplier: '', unitType: '', costPrice: '', labourCost: '', sellPrice: '',
  marginPercent: '', pricePerSqm: '', gstApplicable: true, taxRate: 10,
  isActive: true, notes: '', tags: '', source: 'Manual',
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function PricedItems() {
  useDataRefresh();
  const fileRef    = useRef(null);
  const pdfFileRef = useRef(null);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // PDF pick — uses History API directly because Vite's minifier treats the local
  // variable named "navigate" as the browser global window.navigate and doesn't
  // rename it correctly, causing ReferenceError in production.
  const pickPdf = (f) => {
    if (!f) return;
    const ok = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    if (!ok) return;
    window.__lussoPendingPdf = f;
    // Push the route via History API — React Router listens to popstate
    window.history.pushState({}, '', '/priced-items/import-pdf');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return t === 'import' || t === 'history' ? t : 'library';
  });

  // Library state
  const [items, setItems]               = useState(() => getPricedItems());
  const [search, setSearch]             = useState('');
  const [filterCat, setFilterCat]       = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [editItem, setEditItem]         = useState(null); // null | item object (new = no id match)
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Import wizard state
  const [step, setStep]               = useState('upload');
  const [fileName, setFileName]       = useState('');
  const [headers, setHeaders]         = useState([]);
  const [rawRows, setRawRows]         = useState([]);
  const [columnMap, setColumnMap]     = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [globalDupAction, setGlobalDupAction] = useState('skip');
  const [importing, setImporting]     = useState(false);
  const [result, setResult]           = useState(null);
  const [dragOver, setDragOver]       = useState(false);
  const [batches, setBatches]         = useState(() => getPricedItemBatches());

  const stepIndex = ['upload', 'map', 'preview', 'done'].indexOf(step);

  const reload = () => { setItems(getPricedItems()); setBatches(getPricedItemBatches()); };

  // ── Library helpers ──────────────────────────────────────────────────────

  const categories = [...new Set(items.map(p => p.category).filter(Boolean))].sort();

  const filteredItems = items.filter(p => {
    if (filterStatus === 'active'   && !p.isActive) return false;
    if (filterStatus === 'inactive' &&  p.isActive) return false;
    if (filterCat && p.category !== filterCat) return false;
    if (search) {
      const q = search.toLowerCase();
      return (p.itemName || '').toLowerCase().includes(q) ||
             (p.itemCode || '').toLowerCase().includes(q) ||
             (p.description || '').toLowerCase().includes(q) ||
             (p.category || '').toLowerCase().includes(q);
    }
    return true;
  });

  const handleSaveItem = (item) => {
    savePricedItem({
      ...item,
      costPrice:    item.costPrice    !== '' ? parseFloat(item.costPrice)    || 0 : null,
      labourCost:   item.labourCost   !== '' ? parseFloat(item.labourCost)   || 0 : null,
      sellPrice:    item.sellPrice    !== '' ? parseFloat(item.sellPrice)    || 0 : null,
      marginPercent:item.marginPercent!== '' ? parseFloat(item.marginPercent)|| 0 : null,
      taxRate:      parseFloat(item.taxRate) || 0,
    });
    reload();
    setEditItem(null);
  };

  const handleToggleActive = (id) => {
    const item = getPricedItems().find(p => p.id === id);
    if (item) { savePricedItem({ ...item, isActive: !item.isActive }); reload(); }
  };

  const handleDelete = (id) => {
    deletePricedItem(id);
    reload();
    setDeleteConfirm(null);
  };

  const handleBulkDelete = () => {
    selectedIds.forEach(id => deletePricedItem(id));
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    reload();
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(p => p.id)));
    }
  };

  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const handleDeleteAll = () => {
    getPricedItems().forEach(p => deletePricedItem(p.id));
    reload();
    setShowDeleteAll(false);
  };

  // ── File handling ────────────────────────────────────────────────────────

  const handleFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { alert('CSV appears empty or has no data rows.'); return; }
      const hdrs = rows[0];
      const data = rows.slice(1).filter(r => r.some(c => c?.trim()));
      setHeaders(hdrs); setRawRows(data); setColumnMap(autoDetectMapping(hdrs)); setStep('map');
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  const onFilePick = (e) => handleFile(e.target.files?.[0]);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); };

  const buildPreview = () => {
    setPreviewRows(processItemRows(rawRows, headers, columnMap, getPricedItems(), globalDupAction));
    setStep('preview');
  };

  const applyGlobalDupAction = (action) => {
    setGlobalDupAction(action);
    setPreviewRows(prev => prev.map(r => r.status === 'duplicate' ? { ...r, rowAction: action } : r));
  };

  const setRowAction = (rowNum, action) => {
    setPreviewRows(prev => prev.map(r => r.rowNum === rowNum ? { ...r, rowAction: action } : r));
  };

  const runImport = async () => {
    setImporting(true);
    await new Promise(r => setTimeout(r, 60));
    const batch = createPricedItemBatch(fileName, previewRows.filter(r => r.status !== 'empty').length);
    // runPricedItemImport is async — awaits Supabase batch upsert before returning
    const res = await runPricedItemImport(batch.id, previewRows);
    setResult(res);
    reload();
    setImporting(false);
    setStep('done');
  };

  const resetWizard = () => {
    setStep('upload'); setFileName(''); setHeaders([]); setRawRows([]);
    setColumnMap({}); setPreviewRows([]); setResult(null); setGlobalDupAction('skip');
    if (fileRef.current) fileRef.current.value = '';
  };

  const counts = previewRows.reduce((acc, r) => {
    if (r.status === 'empty') { acc.empty++; return acc; }
    if (r.status === 'error') { acc.errors++; return acc; }
    if (r.status === 'duplicate') {
      if (r.rowAction === 'update') acc.willUpdate++;
      else if (r.rowAction === 'create') acc.willImport++;
      else acc.willSkip++;
      return acc;
    }
    acc.willImport++;
    return acc;
  }, { willImport: 0, willUpdate: 0, willSkip: 0, errors: 0, empty: 0 });

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

      {/* Back button — guards against leaving mid-import */}
      <BackButton
        fallback="/settings"
        guard={() => {
          // Warn if the user is mid-import (file selected, not yet done)
          if (activeTab === 'import' && step !== 'upload' && step !== 'done') {
            return window.confirm('You have an import in progress. Leave this page?');
          }
          return true;
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Priced Items</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your reusable pricing library and import from CSV.</p>
        </div>
        {activeTab === 'library' && !editItem && (
          <button
            onClick={() => setEditItem(EMPTY_ITEM())}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors flex-shrink-0"
          >
            <Plus size={15}/> Add Item
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['library', Library, 'Library'], ['import', Upload, 'Import'], ['history', History, 'History']].map(([t, Icon, label]) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Icon size={14}/>{label}
            {t === 'library' && <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">{items.filter(p=>p.isActive).length}</span>}
          </button>
        ))}
      </div>

      {/* ── Library Tab ── */}
      {activeTab === 'library' && (
        <div className="space-y-4">
          {/* Add / Edit form panel */}
          {editItem && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">{editItem.id && getPricedItems().some(p => p.id === editItem.id) ? 'Edit Item' : 'Add New Item'}</h2>
                <button onClick={() => setEditItem(null)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
              </div>
              <div className="p-5">
                <ItemForm item={editItem} onChange={setEditItem} onSave={handleSaveItem} onCancel={() => setEditItem(null)} />
              </div>
            </Card>
          )}

          {/* Search & filter bar */}
          <Card className="px-4 py-3 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, code, or description…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <select
              value={filterCat}
              onChange={e => setFilterCat(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Status</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            {getPricedItems().length > 0 && (
              <button
                onClick={() => setShowDeleteAll(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 border border-red-200 text-red-500 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Trash2 size={13} /> Delete All
              </button>
            )}
          </Card>

          {/* Delete All confirmation modal */}
          {showDeleteAll && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <Trash2 size={18} className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Delete all priced items?</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      This will permanently delete all {getPricedItems().length} items from the library. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowDeleteAll(false)}
                    className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAll}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                  >
                    Yes, delete all
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bulk delete action bar — shows when items selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-red-700">
                {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 bg-white transition-colors"
                >
                  Cancel
                </button>
                {confirmBulkDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600 font-medium">Delete {selectedIds.size} items permanently?</span>
                    <button onClick={handleBulkDelete} className="text-xs font-bold text-white bg-red-500 hover:bg-red-400 px-3 py-1.5 rounded-lg transition-colors">
                      Yes, delete
                    </button>
                    <button onClick={() => setConfirmBulkDelete(false)} className="text-xs text-slate-500 px-2 py-1.5">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-400 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Trash2 size={12} /> Delete {selectedIds.size} selected
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Items table */}
          <Card>
            {filteredItems.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Library size={32} className="mx-auto mb-3 opacity-40"/>
                <p className="text-sm font-medium">No priced items found.</p>
                <p className="text-xs mt-1">Add items manually or import from CSV.</p>
                <div className="flex gap-3 justify-center mt-4">
                  <button onClick={() => setEditItem(EMPTY_ITEM())} className="text-xs font-medium px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-white rounded-lg transition-colors flex items-center gap-1.5"><Plus size={12}/>Add Item</button>
                  <button onClick={() => setActiveTab('import')} className="text-xs font-medium px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5"><Upload size={12}/>Import CSV</button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500 font-medium border-b border-slate-100">
                      <th className="pl-4 pr-2 py-2.5 w-8">
                        <button onClick={toggleSelectAll} className="flex items-center">
                          {selectedIds.size === filteredItems.length && filteredItems.length > 0
                            ? <CheckSquare size={14} className="text-amber-500" />
                            : <Square size={14} className="text-slate-300 hover:text-slate-400" />
                          }
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-left">Name / Code</th>
                      <th className="px-3 py-2.5 text-left">Category</th>
                      <th className="px-3 py-2.5 text-right">Cost</th>
                      <th className="px-3 py-2.5 text-right">Sell / $/m²</th>
                      <th className="px-3 py-2.5 text-right">Margin</th>
                      <th className="px-3 py-2.5 text-left">Source</th>
                      <th className="px-3 py-2.5 text-center">Status</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredItems.map(p => (
                      <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${!p.isActive ? 'opacity-50' : ''} ${selectedIds.has(p.id) ? 'bg-amber-50/60' : ''}`}>
                        <td className="pl-4 pr-2 py-3 w-8">
                          <button onClick={() => toggleSelect(p.id)} className="flex items-center">
                            {selectedIds.has(p.id)
                              ? <CheckSquare size={14} className="text-amber-500" />
                              : <Square size={14} className="text-slate-300 hover:text-amber-400" />
                            }
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-slate-800 break-words min-w-[160px]">{p.itemName}</div>
                          {p.itemCode && <div className="text-xs text-slate-400 font-mono">{p.itemCode}</div>}
                        </td>
                        <td className="px-3 py-3 text-slate-500 text-xs">{p.category || '—'}</td>
                        <td className="px-3 py-3 text-right text-slate-600 text-xs tabular-nums">{fmtPrice(p.costPrice)}</td>
                        <td className="px-3 py-3 text-right font-medium text-slate-800 text-xs tabular-nums">
                          {p.pricePerSqm
                            ? <span className="text-violet-600 font-semibold">${p.pricePerSqm}/m²</span>
                            : fmtPrice(p.sellPrice)
                          }
                        </td>
                        <td className="px-3 py-3 text-right text-xs tabular-nums">
                          {p.marginPercent != null ? <span className="text-green-600 font-medium">{p.marginPercent.toFixed(1)}%</span> : '—'}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-400 truncate max-w-[100px]">{p.source || '—'}</td>
                        <td className="px-3 py-3 text-center">
                          <button onClick={() => handleToggleActive(p.id)} title={p.isActive ? 'Disable' : 'Enable'}>
                            {p.isActive
                              ? <ToggleRight size={20} className="text-green-500"/>
                              : <ToggleLeft  size={20} className="text-slate-300"/>}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditItem({ ...p })} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"><Edit2 size={13}/></button>
                            {deleteConfirm === p.id
                              ? <div className="flex items-center gap-1">
                                  <span className="text-xs text-red-500">Delete?</span>
                                  <button onClick={() => handleDelete(p.id)} className="text-xs font-medium text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded bg-red-50">Yes</button>
                                  <button onClick={() => setDeleteConfirm(null)} className="text-xs text-slate-400">No</button>
                                </div>
                              : <button onClick={() => setDeleteConfirm(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={13}/></button>
                            }
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-5 py-3 border-t border-slate-50 text-xs text-slate-400">
                  {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} · {items.filter(p => p.isActive).length} active
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Import Tab ── */}
      {activeTab === 'import' && (
        <>
          {step !== 'done' && (
            <div className="flex items-center gap-2">
              {[['upload', 'Upload'], ['map', 'Map Columns'], ['preview', 'Preview']].map(([s, label], i) => (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <ChevronRight size={14} className="text-slate-300"/>}
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${stepIndex >= i ? 'text-amber-600' : 'text-slate-400'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${stepIndex >= i ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                      {stepIndex > i ? '✓' : i + 1}
                    </span>
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Import method chooser — shown before any file is picked */}
          {step === 'upload' && (
            <div className="grid sm:grid-cols-2 gap-4 mb-2">

              {/* ── PDF import (AI) ── */}
              <div className="bg-white border-2 border-violet-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={18} className="text-violet-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 leading-tight">Import from Supplier PDF</p>
                    <p className="text-[11px] text-violet-600 font-medium">AI-powered</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-3">
                  Drop any supplier price list — AI extracts products, normalises categories, no column mapping needed.
                </p>
                <input ref={pdfFileRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => pickPdf(e.target.files?.[0])} />
                <div
                  onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(true); }}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(true); }}
                  onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(false); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(false); pickPdf(e.dataTransfer.files[0]); }}
                  onClick={() => pdfFileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl py-4 text-center cursor-pointer transition-colors text-xs select-none ${
                    pdfDragOver ? 'border-violet-400 bg-violet-50 text-violet-600 font-semibold' : 'border-violet-200 hover:border-violet-400 hover:bg-violet-50 text-slate-500'
                  }`}
                >
                  {pdfDragOver ? 'Drop it!' : 'Click to browse or drag PDF here'}
                </div>
              </div>

              {/* ── CSV import ── */}
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Upload size={18} className="text-amber-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 leading-tight">Import from CSV</p>
                    <p className="text-[11px] text-slate-400">Quotient or custom format</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-3">
                  Quotient Saved Price Items export or any structured CSV. Columns auto-detected and mapped.
                </p>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl py-4 text-center cursor-pointer transition-colors text-xs select-none ${dragOver ? 'border-amber-400 bg-amber-50 text-amber-600 font-semibold' : 'border-slate-200 hover:border-amber-300 hover:bg-slate-50 text-slate-500'}`}
                >
                  {dragOver ? 'Drop it!' : 'Click to browse or drag CSV here'}
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFilePick}/>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Map Columns */}
          {step === 'map' && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800">Map Columns</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{rawRows.length} rows · {headers.length} columns · <span className="font-medium text-slate-600">{fileName}</span></p>
                </div>
                <button onClick={resetWizard} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><X size={12}/>Change file</button>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-500 mb-4">Quotient columns have been auto-detected. Adjust any incorrect mappings.</p>
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
                        const samples = rawRows.slice(0, 3).map(r => r[headers.indexOf(h)]?.trim()).filter(s => s && s !== '.').slice(0, 2);
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
                                {LUSSO_ITEM_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
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
                    Continue to Preview <ChevronRight size={14}/>
                  </button>
                </div>
              </div>
            </Card>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-green-600 font-medium"><CheckCircle2 size={15}/>{counts.willImport} to import</div>
                  {counts.willUpdate > 0 && <div className="flex items-center gap-1.5 text-blue-600 font-medium"><RefreshCw size={15}/>{counts.willUpdate} to update</div>}
                  {counts.willSkip  > 0 && <div className="flex items-center gap-1.5 text-yellow-600 font-medium"><SkipForward size={15}/>{counts.willSkip} duplicate (skip)</div>}
                  {counts.errors    > 0 && <div className="flex items-center gap-1.5 text-red-500 font-medium"><XCircle size={15}/>{counts.errors} errors</div>}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-slate-500">Duplicates:</span>
                    <select value={globalDupAction} onChange={e => applyGlobalDupAction(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                      <option value="skip">Skip all</option>
                      <option value="update">Update existing</option>
                      <option value="create">Create new anyway</option>
                    </select>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800 text-sm">{previewRows.length} rows</h2>
                  <button onClick={() => setStep('map')} className="text-xs text-slate-400 hover:text-slate-600">← Back to mapping</button>
                </div>
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm min-w-[750px]">
                    <thead className="sticky top-0 bg-white border-b border-slate-100 z-10">
                      <tr className="text-xs text-slate-500 font-medium">
                        <th className="px-4 py-2.5 text-left w-10">#</th>
                        <th className="px-4 py-2.5 text-left">Name</th>
                        <th className="px-4 py-2.5 text-left">Code</th>
                        <th className="px-4 py-2.5 text-left">Category</th>
                        <th className="px-4 py-2.5 text-right">Cost</th>
                        <th className="px-4 py-2.5 text-right">Sell</th>
                        <th className="px-4 py-2.5 text-right">Margin</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {previewRows.map(r => (
                        <tr key={r.rowNum} className={`hover:bg-slate-50 ${r.status === 'empty' ? 'opacity-40' : ''}`}>
                          <td className="px-4 py-2.5 text-slate-400 text-xs">{r.rowNum}</td>
                          <td className="px-4 py-2.5 text-xs">
                            <div className="font-medium text-slate-700 truncate max-w-[180px]">{r.mapped?.itemName || '—'}</div>
                            {r.errors?.length > 0 && <div className="text-red-400 text-xs truncate max-w-[180px]">{r.errors[0]}</div>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{r.mapped?.itemCode || '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{r.mapped?.category || '—'}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtPrice(r.mapped?.costPrice)}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-medium text-slate-700 tabular-nums">{fmtPrice(r.mapped?.sellPrice)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                            {r.mapped?.marginPercent != null ? <span className="text-green-600">{r.mapped.marginPercent.toFixed(1)}%</span> : '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <RowStatusBadge status={r.status} action={r.rowAction}/>
                            {r.status === 'duplicate' && r.duplicate && (
                              <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[120px]">← {r.duplicate.itemName}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.status === 'duplicate' && (
                              <select value={r.rowAction} onChange={e => setRowAction(r.rowNum, e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400">
                                <option value="skip">Skip</option>
                                <option value="update">Update</option>
                                <option value="create">Create new</option>
                              </select>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="flex items-center gap-3">
                <button onClick={() => setStep('map')} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Back</button>
                <button
                  onClick={runImport}
                  disabled={importing || (counts.willImport + counts.willUpdate) === 0}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  {importing ? <><Loader2 size={15} className="animate-spin"/>Importing…</> : <>Import {counts.willImport + counts.willUpdate} Items <ArrowRight size={14}/></>}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && result && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center"><CheckCircle2 size={24} className="text-green-500"/></div>
                <div>
                  <h2 className="font-bold text-slate-900 text-lg">Import Complete</h2>
                  <p className="text-slate-500 text-sm">{result.fileName}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                {[
                  { label: 'Total Rows', value: result.totalRows,      color: 'text-slate-700', bg: 'bg-slate-50' },
                  { label: 'Imported',   value: result.importedCount,  color: 'text-green-600', bg: 'bg-green-50' },
                  { label: 'Updated',    value: result.updatedCount,   color: 'text-blue-600',  bg: 'bg-blue-50' },
                  { label: 'Duplicates', value: result.duplicateCount, color: 'text-yellow-600',bg: 'bg-yellow-50' },
                  { label: 'Errors',     value: result.errorCount,     color: 'text-red-500',   bg: 'bg-red-50' },
                  { label: 'Skipped',    value: result.skippedCount,   color: 'text-slate-400', bg: 'bg-slate-50' },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Cloud sync confirmation */}
              {result.supabaseErrors?.length > 0 ? (
                <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl mb-4 text-sm">
                  <CloudOff size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-700">Cloud save failed for some records</p>
                    <p className="text-red-500 text-xs mt-0.5">{result.supabaseErrors.join('; ')}</p>
                    <p className="text-red-400 text-xs mt-1">Items were saved locally. Use Advanced Diagnostics in Settings → Push to Cloud to retry.</p>
                  </div>
                </div>
              ) : result.supabaseInserted != null ? (
                <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl mb-4 text-sm">
                  <Cloud size={16} className="text-green-600 flex-shrink-0" />
                  <p className="text-green-700 font-medium">
                    {result.supabaseInserted} item{result.supabaseInserted !== 1 ? 's' : ''} saved to cloud — all devices will sync automatically.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button onClick={() => { setActiveTab('library'); resetWizard(); reload(); }} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg flex items-center gap-2"><Library size={14}/>View Library</button>
                {result.errorCount > 0 && <button onClick={() => downloadErrorReport(previewRows, result.fileName)} className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm rounded-lg flex items-center gap-2"><Download size={14}/>Error Report</button>}
                <button onClick={resetWizard} className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm rounded-lg flex items-center gap-2"><Upload size={14}/>Import Another</button>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-slate-800 text-sm">Import History</h2></div>
          {batches.length === 0 ? (
            <div className="p-12 text-center text-slate-400"><History size={32} className="mx-auto mb-3 opacity-40"/><p className="text-sm">No imports yet.</p></div>
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
                        <div className="flex items-center gap-2"><FileText size={14} className="text-slate-400 flex-shrink-0"/><span className="font-medium text-slate-700 truncate max-w-[200px]">{b.fileName}</span></div>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">{b.completedAt ? format(parseISO(b.completedAt), 'd MMM yyyy h:mm a') : '—'}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{b.totalRows}</td>
                      <td className="px-5 py-3 text-right text-green-600 font-medium">{b.importedCount}</td>
                      <td className="px-5 py-3 text-right text-blue-600">{b.updatedCount}</td>
                      <td className="px-5 py-3 text-right text-yellow-600">{b.duplicateCount}</td>
                      <td className="px-5 py-3 text-right text-red-500">{b.errorCount}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.status === 'Completed' ? 'bg-green-50 text-green-600' : b.status?.includes('errors') ? 'bg-yellow-50 text-yellow-600' : 'bg-slate-100 text-slate-500'}`}>{b.status}</span>
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

// ─── Item form component ───────────────────────────────────────────────────────

function ItemForm({ item, onChange, onSave, onCancel }) {
  const set = (field, val) => onChange(prev => ({ ...prev, [field]: val }));

  // Auto-calculate sell price from cost + margin when both present
  const costNum   = parseFloat(item.costPrice)    || 0;
  const labNum    = parseFloat(item.labourCost)   || 0;
  const margNum   = parseFloat(item.marginPercent)|| 0;
  const totalCost = costNum + labNum;
  const calcSell  = margNum > 0 && margNum < 100 ? totalCost / (1 - margNum / 100) : null;
  const displaySell = item.sellPrice !== '' ? item.sellPrice : (calcSell != null ? calcSell.toFixed(2) : '');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Item Name <span className="text-red-400">*</span></label>
          <input value={item.itemName} onChange={e => set('itemName', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. Roller Blind Supply & Install"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Item Code / SKU</label>
          <input value={item.itemCode} onChange={e => set('itemCode', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono" placeholder="e.g. RB-40-BLOCK"/>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <textarea rows={2} value={item.description} onChange={e => set('description', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" placeholder="Item description for quotes"/>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
          <input value={item.category} onChange={e => set('category', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. Blinds"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Supplier</label>
          <input value={item.supplier} onChange={e => set('supplier', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. Acmeda"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit Type</label>
          <input value={item.unitType} onChange={e => set('unitType', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. each"/>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cost Price ($)</label>
          <input type="number" min="0" step="0.01" value={item.costPrice} onChange={e => set('costPrice', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="0.00"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Labour Cost ($)</label>
          <input type="number" min="0" step="0.01" value={item.labourCost} onChange={e => set('labourCost', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="0.00"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Margin %</label>
          <input type="number" min="0" max="99" step="0.1" value={item.marginPercent} onChange={e => set('marginPercent', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="40"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Sell Price ($)
            {calcSell != null && !item.sellPrice && <span className="text-amber-500 ml-1 text-xs">auto</span>}
          </label>
          <input type="number" min="0" step="0.01" value={item.sellPrice} onChange={e => set('sellPrice', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder={calcSell != null ? calcSell.toFixed(2) : '0.00'}/>
        </div>
      </div>

      {/* Price per m² — for custom-sized products (blinds, sheers, etc.) */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-violet-700 mb-1">Price per m² ($) — size-based pricing</label>
            <input
              type="number" min="0" step="0.01"
              value={item.pricePerSqm || ''}
              onChange={e => set('pricePerSqm', e.target.value)}
              className="w-full sm:w-48 text-sm border border-violet-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
              placeholder="e.g. 280.00"
            />
          </div>
          <div className="text-xs text-violet-600 max-w-xs leading-relaxed pt-1">
            For custom-sized products. In quotes, the sell price auto-calculates:<br/>
            <span className="font-mono text-violet-800">W × D × $/m² = price</span><br/>
            e.g. 1800mm × 2100mm × $280 = <span className="font-semibold">$1,058</span>
          </div>
        </div>
        {item.pricePerSqm && (
          <p className="text-[11px] text-violet-500 mt-1.5">
            Example: 1800 × 2100mm = <strong>${(1.8 * 2.1 * parseFloat(item.pricePerSqm)).toFixed(2)}</strong> · 900 × 1500mm = <strong>${(0.9 * 1.5 * parseFloat(item.pricePerSqm)).toFixed(2)}</strong>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <input value={item.notes} onChange={e => set('notes', e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Internal notes"/>
        </div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={item.gstApplicable} onChange={e => set('gstApplicable', e.target.checked)} className="w-4 h-4 accent-amber-500"/>
            <span className="text-sm text-slate-700">GST Applicable (10%)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={item.isActive} onChange={e => set('isActive', e.target.checked)} className="w-4 h-4 accent-amber-500"/>
            <span className="text-sm text-slate-700">Active</span>
          </label>
        </div>
      </div>
      <div className="flex gap-3 pt-2 border-t border-slate-100">
        <button onClick={() => onSave(item)} disabled={!item.itemName} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">Save Item</button>
        <button onClick={onCancel} className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm rounded-lg">Cancel</button>
      </div>
    </div>
  );
}
