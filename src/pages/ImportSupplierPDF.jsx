import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, Sparkles, ChevronDown, ChevronUp,
  CheckSquare, Square, Edit2, Check, X, AlertTriangle,
  ArrowLeft, ArrowRight, Package, RotateCcw,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { extractPdfText } from '../lib/pdfExtract';
import { supabase } from '../lib/supabase';
import { getPricedItems, savePricedItemBatch, runPricedItemImport, getProductTypes } from '../store/data';
import BackButton from '../components/BackButton';
import { toast } from '../components/ToastContainer';

// ── Constants ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const LUSSO_CATEGORIES = [
  'Roller Blind', 'Sheer Curtain', 'Block-out Curtain', 'Roman Blind',
  'Venetian Blind', 'Vertical Blind', 'Aluminium Blind', 'Timber Blind',
  'Pleated Blind', 'Cellular Blind',
  'Track System', 'Installation', 'Accessory', 'Other',
];

// ── Step indicator ────────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = ['Upload', 'Preview & Edit', 'Done'];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 text-sm font-medium ${
              active ? 'text-amber-600' : done ? 'text-teal-600' : 'text-slate-400'
            }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                active ? 'bg-amber-500 text-white' :
                done   ? 'bg-teal-500 text-white' :
                'bg-slate-200 text-slate-500'
              }`}>
                {done ? <Check size={13} /> : idx}
              </div>
              <span className="hidden sm:block">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-3 ${done ? 'bg-teal-400' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Editable cell ─────────────────────────────────────────────────────────────
function EditableCell({ value, onChange, type = 'text', options }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => { onChange(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) {
    return (
      <div
        onClick={() => { setDraft(value); setEditing(true); }}
        className="flex items-center gap-1 cursor-pointer group min-w-0"
      >
        <span className="truncate text-sm text-slate-700 group-hover:text-amber-600">
          {value ?? <span className="text-slate-400 italic">—</span>}
        </span>
        <Edit2 size={10} className="text-slate-300 group-hover:text-amber-400 flex-shrink-0" />
      </div>
    );
  }

  if (options) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        className="text-xs border border-amber-400 rounded px-1.5 py-1 bg-white w-full focus:outline-none"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type={type}
        value={draft ?? ''}
        onChange={e => setDraft(type === 'number' ? (e.target.value === '' ? null : parseFloat(e.target.value)) : e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
        onBlur={commit}
        className="text-xs border border-amber-400 rounded px-1.5 py-1 w-full focus:outline-none"
      />
    </div>
  );
}

// ── Description preview ───────────────────────────────────────────────────────
function DescCell({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => { onChange(draft); setEditing(false); };
  const short  = (value || '').split('\n')[0].slice(0, 60);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-500 truncate">{short}{value?.length > 60 ? '…' : ''}</span>
        <button onClick={() => setOpen(v => !v)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>
      {open && (
        <div className="mt-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2">
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={5}
                className="w-full text-xs border border-amber-400 rounded px-2 py-1.5 focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button onClick={commit} className="text-xs bg-amber-500 text-white px-2 py-1 rounded">Save</button>
                <button onClick={() => { setDraft(value); setEditing(false); }} className="text-xs text-slate-500 px-2 py-1 rounded border border-slate-200">Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{value || '—'}</p>
              <button onClick={() => { setDraft(value); setEditing(true); }}
                className="mt-1.5 text-xs text-amber-600 hover:underline flex items-center gap-1">
                <Edit2 size={10} /> Edit description
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ImportSupplierPDF() {
  const navigate = useNavigate();
  const fileRef  = useRef(null);

  // Step control
  const [step, setStep] = useState(1); // 1=upload, 2=preview, 3=done

  // Upload state
  const [file,         setFile]         = useState(null);
  const [supplierName, setSupplierName] = useState('');

  // If arrived here from the Priced Items drop zone, the File is stashed on window
  // (React Router state can't serialize File objects — they get silently dropped)
  useEffect(() => {
    const f = window.__lussoPendingPdf;
    if (f instanceof File) {
      window.__lussoPendingPdf = null; // consume once
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        setFile(f);
        const base = f.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim();
        setSupplierName(base.slice(0, 60));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [parsing,      setParsing]      = useState(false);
  const [parseError,   setParseError]   = useState('');

  // Preview state
  const [items,    setItems]    = useState([]);   // ParsedItem[]
  const [selected, setSelected] = useState(new Set()); // Set of item tmpIds
  const [dupeIds,  setDupeIds]  = useState(new Set()); // items that match existing by code/name

  // Import state
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Drag visual state
  const [dragOver, setDragOver] = useState(false);

  // ── File pick ───────────────────────────────────────────────────────────────
  const handleFileDrop = useCallback(async (f) => {
    setDragOver(false);
    if (!f) return;
    // Accept by extension OR mime type — some OSes drag PDFs with a generic MIME type
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setParseError('Please select a PDF file (the file must end in .pdf).');
      return;
    }
    setFile(f);
    setParseError('');
    // Auto-fill supplier name from filename if not set
    if (!supplierName) {
      const base = f.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim();
      setSupplierName(base.slice(0, 60));
    }
  }, [supplierName]);

  // ── Parse ────────────────────────────────────────────────────────────────────
  const handleParse = async () => {
    if (!file) { setParseError('Select a PDF first.'); return; }
    if (!supplierName.trim()) { setParseError('Enter a supplier name.'); return; }
    if (!supabase) { setParseError('No Supabase connection.'); return; }

    setParsing(true);
    setParseError('');

    try {
      // 1. Extract text from PDF
      let pdfText = '';
      try {
        pdfText = await extractPdfText(file);
      } catch (e) {
        throw new Error(`Could not read PDF: ${e.message}`);
      }
      if (!pdfText.trim()) throw new Error('No text found in this PDF. It may be a scanned image — try a text-based PDF.');

      // 2. Get auth session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in.');

      // 3. Call parse-supplier-pdf edge function
      const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-supplier-pdf`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: pdfText, supplierName: supplierName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      if (!data.items?.length) throw new Error('No products found in this PDF. Check the file contains a readable price list.');

      // 4. Assign tmp IDs and check for duplicates vs existing library
      const existing = getPricedItems();
      const existingCodes = new Map(existing.map(p => [p.itemCode?.toLowerCase(), p]));
      const existingNames = new Map(existing.map(p => [p.itemName?.toLowerCase(), p]));

      const dupes = new Set();
      const withIds = data.items.map(item => {
        const tmpId = uuidv4();
        const codeMatch = item.itemCode && existingCodes.get(item.itemCode.toLowerCase());
        const nameMatch = existingNames.get(item.itemName.toLowerCase());
        if (codeMatch || nameMatch) dupes.add(tmpId);
        return { ...item, tmpId, supplierName: supplierName.trim() };
      });

      setItems(withIds);
      setSelected(new Set(withIds.filter(i => !dupes.has(i.tmpId)).map(i => i.tmpId)));
      setDupeIds(dupes);
      setStep(2);

    } catch (err) {
      setParseError(err.message);
    } finally {
      setParsing(false);
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.tmpId)));
  };

  const toggleOne = (tmpId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(tmpId)) next.delete(tmpId); else next.add(tmpId);
      return next;
    });
  };

  // ── Item field edit ──────────────────────────────────────────────────────────
  const editItem = (tmpId, field, value) => {
    setItems(prev => prev.map(item =>
      item.tmpId === tmpId ? { ...item, [field]: value } : item
    ));
  };

  // ── Import ────────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    const toImport = items.filter(i => selected.has(i.tmpId));
    if (!toImport.length) { toast('No items selected.', 'error'); return; }

    setImporting(true);
    try {
      // Build a batch record
      const batch = savePricedItemBatch({
        id:           uuidv4(),
        fileName:     file.name,
        uploadedBy:   'Admin',
        source:       `Supplier PDF: ${supplierName}`,
        status:       'Previewed',
        totalRows:    toImport.length,
        importedCount: 0,
        updatedCount:  0,
        duplicateCount: 0,
        errorCount:    0,
        skippedCount:  0,
        createdAt:    new Date().toISOString(),
        completedAt:  null,
      });

      // Map to the format runPricedItemImport expects
      const existing = getPricedItems();
      const existingCodes = new Map(existing.map(p => [p.itemCode?.toLowerCase(), p]));

      const rows = toImport.map(item => {
        const codeMatch = item.itemCode && existingCodes.get(item.itemCode.toLowerCase());
        return {
          status:    'ok',
          isDuplicate: !!codeMatch,
          duplicate:  codeMatch || null,
          rowAction:  codeMatch ? 'update' : 'insert',
          mapped: {
            itemName:      item.itemName,
            itemCode:      item.itemCode || '',
            description:   item.description || '',
            category:      item.category || 'Other',
            supplier:      item.supplierName || supplierName,
            costPrice:     item.costPrice ?? null,
            sellPrice:     item.sellPrice ?? null,
            pricePerSqm:   item.pricePerSqm ?? null,
            marginPercent: item.marginPercent ?? null,
            labourCost:    null,
            markupPercent: null,
            gstApplicable: true,
            taxRate:       10,
            unitType:      item.unit || 'each',
            // matchKeywords stored in tags — Feature 3 (Quote Autopilot) reads this
            // for semantic matching of measure sheet items to priced items
            tags:          item.matchKeywords || '',
            notes:         '',
            source:        `Supplier PDF: ${supplierName}`,
          },
        };
      });

      const result = await runPricedItemImport(batch.id, rows);
      setImportResult(result);
      setStep(3);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 pb-20">
      <BackButton fallback="/priced-items" />

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
          <FileText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Import from Supplier PDF</h1>
          <p className="text-sm text-slate-500">AI reads the price list and populates your product library</p>
        </div>
      </div>

      <Steps current={step} />

      {/* ── STEP 1: Upload ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Drop zone — hidden input lives OUTSIDE the zone so its accept attr
               never interferes with drag-drop. The zone itself handles the drop. */}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => handleFileDrop(e.target.files?.[0])}
          />
          <div
            onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              handleFileDrop(e.dataTransfer.files[0]);
            }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all select-none ${
              dragOver
                ? 'border-amber-400 bg-amber-50 scale-[1.01]'
                : file
                  ? 'border-teal-400 bg-teal-50'
                  : 'border-slate-300 bg-white hover:border-amber-400 hover:bg-amber-50/30'
            }`}
          >
            {file ? (
              <div className="flex flex-col items-center gap-2 pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center">
                  <FileText size={22} className="text-teal-600" />
                </div>
                <p className="font-semibold text-teal-700">{file.name}</p>
                <p className="text-xs text-teal-600">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
              </div>
            ) : dragOver ? (
              <div className="flex flex-col items-center gap-2 pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <Upload size={22} className="text-amber-500" />
                </div>
                <p className="font-semibold text-amber-700">Drop it!</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                  <Upload size={22} className="text-slate-400" />
                </div>
                <p className="font-semibold text-slate-700">Drop supplier PDF here</p>
                <p className="text-xs text-slate-400">or click to browse · PDF files only</p>
              </div>
            )}
          </div>

          {/* Supplier name */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Supplier Name <span className="text-red-500">*</span>
              </label>
              <input
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                placeholder="e.g. Acmeda, Kresta, Louvolite"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <p className="text-xs text-slate-400 mt-1">
                All imported items will be tagged with this supplier name.
              </p>
            </div>
          </div>

          {/* What the AI does */}
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <Sparkles size={16} className="text-violet-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-violet-800 mb-1">What the AI will do</p>
                <ul className="text-xs text-violet-700 space-y-1">
                  <li>• Extract every product — name, code, description, category, cost price, sell price</li>
                  <li>• Normalise categories to your product types (Roller Blind, Sheer Curtain, etc.)</li>
                  <li>• Write rich descriptions optimised for Quote Autopilot matching</li>
                  <li>• Skip headers, totals, and non-product rows</li>
                  <li>• Flag items already in your library as duplicates</li>
                </ul>
              </div>
            </div>
          </div>

          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{parseError}</p>
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={parsing || !file}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
          >
            {parsing ? (
              <>
                <Sparkles size={16} className="animate-pulse" />
                Reading PDF and extracting products…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Parse with AI
                <ArrowRight size={15} />
              </>
            )}
          </button>

          {parsing && (
            <p className="text-center text-xs text-slate-400">
              This usually takes 5–15 seconds depending on the price list length.
            </p>
          )}
        </div>
      )}

      {/* ── STEP 2: Preview & Edit ──────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-semibold text-slate-800">
                {items.length} products found
              </span>
              <span className="text-slate-500">
                {selected.size} selected for import
              </span>
              {dupeIds.size > 0 && (
                <span className="text-amber-600 font-medium">
                  {dupeIds.size} already in library
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setStep(1); setItems([]); setSelected(new Set()); }}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RotateCcw size={12} /> Re-upload
              </button>
              <button
                onClick={handleImport}
                disabled={importing || selected.size === 0}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {importing ? 'Importing…' : `Import ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
                {!importing && <ArrowRight size={14} />}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[32px_1fr_80px_140px_80px_80px_70px_80px_60px] gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              <button onClick={toggleAll} className="flex items-center">
                {selected.size === items.length
                  ? <CheckSquare size={15} className="text-amber-500" />
                  : <Square size={15} className="text-slate-400" />
                }
              </button>
              <div>Product Name</div>
              <div>Code</div>
              <div>Category</div>
              <div>Cost $</div>
              <div>Sell $</div>
              <div>$/m²</div>
              <div>Margin%</div>
              <div>Unit</div>
            </div>

            {/* Table body */}
            <div className="divide-y divide-slate-100">
              {items.map(item => {
                const isSelected = selected.has(item.tmpId);
                const isDupe = dupeIds.has(item.tmpId);

                return (
                  <div
                    key={item.tmpId}
                    className={`px-4 py-3 ${isSelected ? 'bg-white' : 'bg-slate-50/60 opacity-60'} hover:bg-amber-50/20 transition-colors`}
                  >
                    {/* Main row */}
                    <div className="grid grid-cols-[32px_1fr_80px_140px_80px_80px_70px_80px_60px] gap-2 items-start">
                      {/* Checkbox */}
                      <button onClick={() => toggleOne(item.tmpId)} className="mt-0.5">
                        {isSelected
                          ? <CheckSquare size={15} className="text-amber-500" />
                          : <Square size={15} className="text-slate-300" />
                        }
                      </button>

                      {/* Name + description */}
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <EditableCell
                            value={item.itemName}
                            onChange={v => editItem(item.tmpId, 'itemName', v)}
                          />
                          {isDupe && (
                            <span className="flex-shrink-0 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                              duplicate
                            </span>
                          )}
                        </div>
                        <DescCell
                          value={item.description}
                          onChange={v => editItem(item.tmpId, 'description', v)}
                        />
                      </div>

                      {/* Code */}
                      <EditableCell
                        value={item.itemCode}
                        onChange={v => editItem(item.tmpId, 'itemCode', v)}
                      />

                      {/* Category */}
                      <EditableCell
                        value={item.category}
                        onChange={v => editItem(item.tmpId, 'category', v)}
                        options={LUSSO_CATEGORIES}
                      />

                      {/* Cost */}
                      <EditableCell
                        value={item.costPrice}
                        onChange={v => editItem(item.tmpId, 'costPrice', v)}
                        type="number"
                      />

                      {/* Sell */}
                      <EditableCell
                        value={item.sellPrice}
                        onChange={v => editItem(item.tmpId, 'sellPrice', v)}
                        type="number"
                      />

                      {/* $/m² */}
                      <EditableCell
                        value={item.pricePerSqm}
                        onChange={v => editItem(item.tmpId, 'pricePerSqm', v == null || v === '' ? null : Number(v))}
                        type="number"
                      />

                      {/* Margin */}
                      <div className="text-sm text-slate-500">
                        {item.marginPercent != null ? `${item.marginPercent.toFixed(1)}%` : '—'}
                      </div>

                      {/* Unit */}
                      <EditableCell
                        value={item.unit}
                        onChange={v => editItem(item.tmpId, 'unit', v)}
                        options={['each', 'per metre', 'per set', 'per pair', 'per sqm']}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setStep(1); setItems([]); setSelected(new Set()); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft size={14} /> Start over
            </button>
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
            >
              {importing ? 'Importing…' : `Import ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
              {!importing && <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Done ───────────────────────────────────────────────────── */}
      {step === 3 && importResult && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
            <Package size={28} className="text-teal-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Import complete</h2>
          <p className="text-slate-500 text-sm mb-6">
            Products from <span className="font-semibold text-slate-700">{supplierName}</span> are now in your library.
          </p>

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'New items added', value: importResult.importedCount, color: 'text-teal-600' },
              { label: 'Items updated', value: importResult.updatedCount, color: 'text-blue-600' },
              { label: 'Duplicates skipped', value: importResult.duplicateCount, color: 'text-amber-600' },
              { label: 'Errors', value: importResult.errorCount, color: 'text-red-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/priced-items')}
              className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              <Package size={15} /> View Library
            </button>
            <button
              onClick={() => { setStep(1); setFile(null); setItems([]); setSelected(new Set()); setImportResult(null); setParseError(''); }}
              className="flex items-center justify-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              <Upload size={15} /> Import another PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
