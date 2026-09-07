/**
 * Add or edit one product document.
 *
 * The form is the source of truth. Parsing the filename and the PDF's own text
 * only PRE-FILLS it — every value stays editable, and nothing is written that a
 * person didn't see. That is what keeps the library trustworthy across suppliers
 * whose documents look nothing alike: a PDF we can't read anything out of still
 * files perfectly well, it just arrives with an empty form instead of a full one.
 *
 * Where the filename and the document disagree, both are shown and the choice is
 * handed to the user (see the conflict chips). The Verosol sheet that prompted
 * this is exactly that case: named "…2020-05…v1.0.pdf", footer says
 * "Version 1.1 | Issued October 2017".
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, UploadCloud, FileText, Loader2, AlertTriangle, Info, Check, Ruler, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  getKnownSuppliers, saveProductDocument, saveProductDocumentText, getActiveProductTypes,
  getPricedItemsInScope, getSupplierCategories, MS_SPEC_FIELDS,
} from '../store/data';
import { hasLimits } from '../lib/productLimits';
import {
  DOC_TYPES, uploadProductDoc, parseDocFileName, parseDocText,
  guessSupplier, mergeDocSuggestions,
} from '../lib/productDocs';
import { extractPdfTextAndMeta } from '../lib/pdfExtract';
import PricedItemPicker from './PricedItemPicker';
import { toast } from './ToastContainer';

const MAX_BYTES = 25 * 1024 * 1024;
const field = 'w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400';
const label = 'block text-xs font-medium text-slate-500 mb-1';

// Mounted only while open, and keyed by the document being edited — so every
// open starts from clean state with no reset effect to get wrong.
export default function ProductDocUpload({ onClose, onSaved, editDoc = null, presetTarget = null }) {
  const isEdit = !!editDoc;
  const [file, setFile]         = useState(null);
  const [reading, setReading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [conflicts, setConf]    = useState([]);
  const [extracted, setExtract] = useState({ text: '', pageCount: 0, hasText: false });
  const [form, setForm]         = useState(() => editDoc ? { scope: 'item', category: '', ...editDoc } : {
    id: uuidv4(), title: '', docType: 'spec', supplier: '', category: '', productCode: '',
    version: '', issued: '', notes: '',
    // Supplier range is the default because that is how spec sheets are
    // actually published — per product family, not per fabric.
    scope: presetTarget?.scope ?? 'supplier',
    pricedItemId: presetTarget?.pricedItemId ?? null,
    productTypeId: presetTarget?.productTypeId ?? null,
    productLabel: presetTarget?.label ?? '',
  });
  const inputRef = useRef(null);
  const productTypes = useMemo(() => getActiveProductTypes(), []);

  const [limits, setLimits] = useState(() => ({
    widthMm:   { min: '', max: '', ...(editDoc?.limits?.widthMm || {}) },
    dropMm:    { min: '', max: '', ...(editDoc?.limits?.dropMm  || {}) },
    maxAreaM2: editDoc?.limits?.maxAreaM2 ?? '',
    checks:    editDoc?.limits?.checks || [],
  }));
  const [limitsOpen, setLimitsOpen] = useState(() => !!editDoc?.limits);
  // Blank means "the sheet doesn't state this", NOT zero — a 0 maximum would
  // reject every line ever measured. So empty fields are dropped entirely.
  const cleanLimits = (l) => {
    const n = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
    const bounds = (b) => {
      const o = {};
      if (n(b?.min) !== undefined && !Number.isNaN(n(b.min))) o.min = n(b.min);
      if (n(b?.max) !== undefined && !Number.isNaN(n(b.max))) o.max = n(b.max);
      return Object.keys(o).length ? o : undefined;
    };
    const out = {};
    const w = bounds(l.widthMm); if (w) out.widthMm = w;
    const d = bounds(l.dropMm);  if (d) out.dropMm  = d;
    const a = n(l.maxAreaM2);    if (a !== undefined && !Number.isNaN(a)) out.maxAreaM2 = a;
    const checks = (l.checks || []).map(c => {
      const key = c.severity === 'error' ? 'max' : 'over';
      const v = n(c.widthMm?.[key]);
      if (v === undefined || Number.isNaN(v)) return null; // a rule with no number does nothing
      return {
        severity: c.severity === 'error' ? 'error' : 'warning',
        when: c.when?.spec && String(c.when.is || '').trim()
          ? { spec: c.when.spec, is: String(c.when.is).trim() } : null,
        widthMm: { [key]: v },
        message: String(c.message || '').trim() || undefined,
      };
    }).filter(Boolean);
    if (checks.length) out.checks = checks;
    return out;
  };

  const setBound = (f, k, v) => setLimits(l => ({ ...l, [f]: { ...l[f], [k]: v } }));
  const setCheck = (i, patch) => setLimits(l => ({
    ...l, checks: l.checks.map((c, n) => (n === i ? { ...c, ...patch } : c)),
  }));
  const addCheck = () => setLimits(l => ({
    ...l, checks: [...l.checks, { severity: 'warning', when: null, widthMm: { over: '' }, message: '' }],
  }));
  const removeCheck = (i) => setLimits(l => ({ ...l, checks: l.checks.filter((_, n) => n !== i) }));

  // What a supplier-scoped document would cover, recomputed as they type.
  const supplierCategories = useMemo(() => getSupplierCategories(form.supplier), [form.supplier]);
  const inScope = useMemo(
    () => (form.scope === 'supplier'
      ? getPricedItemsInScope({ supplier: form.supplier, category: form.category })
      : []),
    [form.scope, form.supplier, form.category],
  );

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const takeFile = async (f) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.`);
      return;
    }
    setError(null);
    setFile(f);
    setReading(true);

    const meta = await extractPdfTextAndMeta(f);
    setExtract(meta);

    const fromName = parseDocFileName(f.name);
    const fromText = parseDocText(meta.text);
    const { values, conflicts: cs } = mergeDocSuggestions({ fromName, fromText });
    const supplier = guessSupplier(meta.text, f.name, getKnownSuppliers());

    // Only fill fields the user hasn't already typed into.
    setForm(prev => ({
      ...prev,
      title:       prev.title       || values.title       || f.name.replace(/\.[a-z0-9]+$/i, ''),
      docType:     values.docType   || prev.docType,
      productCode: prev.productCode || values.productCode || '',
      version:     prev.version     || values.version     || '',
      issued:      prev.issued      || values.issued      || '',
      supplier:    prev.supplier    || supplier           || '',
    }));
    setConf(cs);
    setReading(false);
  };

  const applyConflict = (fieldName, value) => {
    set(fieldName, value);
    setConf(cs => cs.filter(c => c.field !== fieldName));
  };

  const handleSave = async () => {
    if (!form.title.trim())    return setError('Give the document a title.');
    if (!isEdit && !file)      return setError('Choose a file to upload.');
    if (form.scope === 'item'     && !form.pricedItemId)  return setError('Pick the product this applies to.');
    if (form.scope === 'type'     && !form.productTypeId) return setError('Pick the product type this applies to.');
    if (form.scope === 'supplier' && !form.supplier.trim()) return setError('Enter the supplier this applies to.');
    setSaving(true);
    setError(null);
    try {
      let filePath = form.filePath;
      if (file) filePath = await uploadProductDoc(form.id, file);

      const record = {
        ...form,
        title: form.title.trim(),
        supplier: form.supplier.trim(),
        category: form.category || '',
        // Only the link column this scope uses survives, so a document can never
        // half-claim a second scope after someone switches tabs mid-edit.
        pricedItemId:  form.scope === 'item' ? form.pricedItemId  : null,
        productTypeId: form.scope === 'type' ? form.productTypeId : null,
        limits: hasLimits(cleanLimits(limits)) ? cleanLimits(limits) : null,
        filePath,
        fileName:  file ? file.name : form.fileName,
        fileSize:  file ? file.size : form.fileSize,
        pageCount: file ? extracted.pageCount : form.pageCount,
        hasText:   file ? extracted.hasText   : form.hasText,
        textChars: file ? extracted.text.length : form.textChars,
      };
      delete record.productLabel;
      saveProductDocument(record);
      // Best-effort: failing to index the text must not fail the upload.
      if (file && extracted.hasText) {
        saveProductDocumentText(form.id, extracted.text);
      }
      toast(isEdit ? 'Document updated' : 'Document added');
      onSaved?.(record);
      onClose();
    } catch (e) {
      console.error('[ProductDocUpload]', e);
      setError(e?.message || 'Upload failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] bg-slate-900/40 flex items-start sm:items-center justify-center p-0 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-xl min-h-full sm:min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-semibold text-slate-800">{isEdit ? 'Edit document' : 'Add a product document'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 flex-1">
          {/* File */}
          {!isEdit && (
            <div>
              <label className={label}>File</label>
              <button type="button" onClick={() => inputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); takeFile(e.dataTransfer.files?.[0]); }}
                className="w-full border-2 border-dashed border-slate-200 hover:border-amber-400 rounded-xl px-4 py-6 text-center transition-colors">
                {file ? (
                  <span className="flex items-center justify-center gap-2 text-sm text-slate-700">
                    <FileText size={16} className="text-amber-500" />
                    {file.name}
                    <span className="text-xs text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-1.5 text-sm text-slate-500">
                    <UploadCloud size={22} className="text-slate-300" />
                    Drop a PDF here, or tap to choose
                    <span className="text-xs text-slate-400">PDF, image or Office file · up to 25 MB</span>
                  </span>
                )}
              </button>
              <input ref={inputRef} type="file" className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                onChange={e => takeFile(e.target.files?.[0])} />
            </div>
          )}

          {reading && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 size={13} className="animate-spin" /> Reading the document…
            </p>
          )}

          {/* Honest reporting of what extraction could and couldn't do. */}
          {file && !reading && (
            extracted.hasText ? (
              <p className="flex items-start gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <Check size={13} className="flex-shrink-0 mt-0.5" />
                Read {extracted.pageCount} page{extracted.pageCount !== 1 ? 's' : ''} of text — this document will be
                searchable by its contents, and the fields below were pre-filled from it. Check them.
              </p>
            ) : (
              <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <Info size={13} className="flex-shrink-0 mt-0.5" />
                No text layer in this file — it's probably a scan. It will still be filed and viewable, but it
                can only be found by the details you type below, not by its contents.
              </p>
            )
          )}

          {/* Where the filename and the document itself disagree, ask. */}
          {conflicts.map(c => (
            <div key={c.field} className="flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
              <span className="text-amber-800">
                The filename and the document disagree on <strong>{c.field}</strong>:
              </span>
              <button type="button" onClick={() => applyConflict(c.field, c.fromDocument)}
                className="px-2 py-0.5 rounded-md border border-amber-300 bg-white hover:bg-amber-100 font-medium">
                {c.fromDocument} <span className="text-slate-400 font-normal">(in the document)</span>
              </button>
              <button type="button" onClick={() => applyConflict(c.field, c.fromFileName)}
                className="px-2 py-0.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50">
                {c.fromFileName} <span className="text-slate-400">(filename)</span>
              </button>
            </div>
          ))}

          {/* ── Scope ──────────────────────────────────────────────────────
              What this document applies to. Supplier + category is the default
              because that's how spec sheets actually work: one Verosol P201.0
              sheet covers all 28 of their pleated-blind fabrics. */}
          <div>
            <label className={label}>This document applies to *</label>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 mb-2.5">
              {[['supplier', 'Supplier range'], ['item', 'One product'], ['type', 'Product type']].map(([val, text]) => (
                <button key={val} type="button" onClick={() => set('scope', val)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                    form.scope === val ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {text}
                </button>
              ))}
            </div>

            {form.scope === 'supplier' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Supplier</label>
                  <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value, category: '' }))}
                    list="lusso-known-suppliers" placeholder="e.g. Verosol" className={field} />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Category</label>
                  <select value={form.category || ''} onChange={e => set('category', e.target.value)} className={field}>
                    <option value="">Everything they supply</option>
                    {supplierCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}

            {form.scope === 'item' && (
              form.productLabel ? (
                <div className="flex items-center justify-between gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-slate-800">{form.productLabel}</span>
                  <button type="button" onClick={() => setForm(f => ({ ...f, productLabel: '', pricedItemId: null }))}
                    className="text-xs text-slate-500 hover:text-slate-800">Change</button>
                </div>
              ) : (
                <PricedItemPicker
                  value={form.productLabel}
                  productTypes={[]}
                  placeholder="Search the price library…"
                  onSelect={(item) => setForm(f => ({
                    ...f,
                    pricedItemId: item?.id ?? null, productTypeId: null,
                    productLabel: item?.itemName ?? '',
                    supplier: f.supplier || item?.supplier || '',
                    category: f.category || item?.category || '',
                  }))}
                />
              )
            )}

            {form.scope === 'type' && (
              <select value={form.productTypeId || ''}
                onChange={e => setForm(f => ({ ...f, productTypeId: e.target.value || null, pricedItemId: null }))}
                className={field}>
                <option value="">Select a product type…</option>
                {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
              </select>
            )}

            {/* Show the reach. An attachment rule whose effect you can't see is
                one nobody will trust enough to use. */}
            <div className="mt-2 text-[11px] text-slate-500">
              {form.scope === 'supplier' ? (
                form.supplier ? (
                  inScope.length ? (
                    <span className="text-green-700">
                      Applies to <strong>{inScope.length}</strong> price-library product{inScope.length !== 1 ? 's' : ''}
                      {form.category ? '' : ' across every category'} — e.g.{' '}
                      {inScope.slice(0, 3).map(i => i.itemName).join(', ')}{inScope.length > 3 ? '…' : ''}
                    </span>
                  ) : (
                    <span className="text-amber-700">
                      No price-library products match {form.supplier}{form.category ? ` / ${form.category}` : ''} yet.
                      The document still files — it just won't surface against a product until one does.
                    </span>
                  )
                ) : 'Type a supplier to see what this will cover.'
              ) : form.scope === 'item'
                ? 'Use this only for a document that genuinely applies to one product and no other.'
                : 'For products that aren\u2019t in the price library. Coarser — every brand of this type will show it.'}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={label}>Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="e.g. Duo Pleated Blind — specification" className={field} />
            </div>
            <div>
              <label className={label}>Document type</label>
              <select value={form.docType} onChange={e => set('docType', e.target.value)} className={field}>
                {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            {/* When the scope IS the supplier, it's edited above — one field,
                one place, so the two can't drift apart. */}
            {form.scope !== 'supplier' && (
              <div>
                <label className={label}>Supplier</label>
                <input value={form.supplier} onChange={e => set('supplier', e.target.value)}
                  list="lusso-known-suppliers" placeholder="e.g. Verosol" className={field} />
              </div>
            )}
            <datalist id="lusso-known-suppliers">
              {getKnownSuppliers().map(s => <option key={s} value={s} />)}
            </datalist>
            <div>
              <label className={label}>Product code</label>
              <input value={form.productCode} onChange={e => set('productCode', e.target.value)}
                placeholder="e.g. P201.0" className={field} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Version</label>
                <input value={form.version} onChange={e => set('version', e.target.value)}
                  placeholder="1.1" className={field} />
              </div>
              <div>
                <label className={label}>Issued</label>
                <input value={form.issued} onChange={e => set('issued', e.target.value)}
                  placeholder="October 2017" className={field} />
              </div>
            </div>
          </div>

          {/* ── Limits ─────────────────────────────────────────────────────
              The numbers off the spec sheet, so a measured opening can be
              checked against them the moment it's typed rather than when the
              supplier rejects the order. Optional — a document with no limits
              is still a perfectly good document. */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setLimitsOpen(o => !o)}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50">
              <Ruler size={14} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Size limits</span>
              <span className="text-xs text-slate-400">
                {hasLimits(cleanLimits(limits)) ? 'set — warns on the measure sheet' : 'optional'}
              </span>
              <span className="ml-auto text-slate-400">
                {limitsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </span>
            </button>

            {limitsOpen && (
              <div className="border-t border-slate-100 p-3.5 space-y-3 bg-slate-50/40">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[['widthMm', 'min', 'Width min'], ['widthMm', 'max', 'Width max'],
                    ['dropMm', 'min', 'Drop min'],  ['dropMm', 'max', 'Drop max']].map(([f, k, text]) => (
                    <div key={`${f}${k}`}>
                      <label className="block text-[11px] text-slate-400 mb-1">{text}</label>
                      <input type="number" inputMode="numeric" min="0" value={limits[f][k] ?? ''}
                        onChange={e => setBound(f, k, e.target.value)}
                        placeholder="mm" className={`${field} no-spin text-right`} />
                    </div>
                  ))}
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Max area</label>
                    <input type="number" inputMode="decimal" min="0" step="0.1" value={limits.maxAreaM2 ?? ''}
                      onChange={e => setLimits(l => ({ ...l, maxAreaM2: e.target.value }))}
                      placeholder="m²" className={`${field} no-spin text-right`} />
                  </div>
                </div>

                {/* Extra rules: a conditional cap, or an advisory threshold. */}
                {limits.checks.map((c, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-2.5 bg-white space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={c.severity} onChange={e => setCheck(i, { severity: e.target.value })}
                        className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white">
                        <option value="error">Won&apos;t be made</option>
                        <option value="warning">Allowed — tell the customer</option>
                      </select>
                      <span className="text-xs text-slate-400">when</span>
                      <select value={c.when?.spec || ''}
                        onChange={e => setCheck(i, { when: e.target.value ? { spec: e.target.value, is: c.when?.is || '' } : null })}
                        className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white">
                        <option value="">any line</option>
                        {MS_SPEC_FIELDS.filter(f => f.key !== 'lining').map(f => (
                          <option key={f.key} value={f.itemField}>{f.label} is…</option>
                        ))}
                      </select>
                      {c.when?.spec && (
                        <input value={c.when.is || ''} placeholder="value"
                          onChange={e => setCheck(i, { when: { ...c.when, is: e.target.value } })}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 w-28" />
                      )}
                      <button type="button" onClick={() => removeCheck(i)}
                        className="ml-auto text-slate-300 hover:text-red-500 p-1"><Trash2 size={13} /></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">and width is over</span>
                      <input type="number" inputMode="numeric" min="0"
                        value={c.severity === 'error' ? (c.widthMm?.max ?? '') : (c.widthMm?.over ?? '')}
                        onChange={e => setCheck(i, { widthMm: c.severity === 'error'
                          ? { max: e.target.value } : { over: e.target.value } })}
                        placeholder="mm" className="text-xs border border-slate-200 rounded-md px-2 py-1 w-24 text-right no-spin" />
                      <input value={c.message || ''} onChange={e => setCheck(i, { message: e.target.value })}
                        placeholder="What to say — e.g. fabric is joined with a centre overlap"
                        className="flex-1 min-w-[200px] text-xs border border-slate-200 rounded-md px-2 py-1" />
                    </div>
                  </div>
                ))}

                <button type="button" onClick={addCheck}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700">
                  <Plus size={13} /> Add a rule
                </button>
                <p className="text-[11px] text-slate-400">
                  Leave anything blank that the sheet doesn&apos;t state. Blank means &ldquo;no limit given&rdquo;, never zero.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={label}>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                placeholder="Anything a salesperson should know before quoting off this…"
                className={field + ' resize-none'} />
            </div>
          </div>

          {error && (
            <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="text-sm text-slate-600 border border-slate-200 rounded-lg px-4 py-2 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || reading}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-semibold rounded-lg px-4 py-2">
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : (isEdit ? 'Save changes' : 'Add document')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
