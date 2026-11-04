import {useProjectWorkspace} from '../contexts/ProjectWorkspaceContext';
import {useProjectNavigate} from '../contexts/ProjectWorkspaceContext';
import {useProjectParams} from '../contexts/ProjectWorkspaceContext';
import { expandOperationAlternatives, openingQuoteSnapshot } from '../lib/openingWorkflow';
import { useState, useMemo, useEffect, useCallback } from 'react';

import { v4 as uuidv4 } from 'uuid';
import {
  FileText, CheckSquare, Square,
  AlertCircle, ClipboardList, AlertTriangle, RefreshCw,
} from 'lucide-react';
import {
  getJob, getCustomer, getMeasureSheetsByJob, getMeasureSheet, saveMeasureSheet,
  createQuote, saveQuote, addActivity, getQuotesByJob,
  getCurtainRates, getPricedItems, getProductTypes, DEFAULT_MARGIN_PERCENT,
} from '../store/data';
import { syncNow } from '../store/db';
import { useProfile } from '../contexts/UserProfileContext';
import Card from '../components/Card';
import StickyActionBar from '../components/StickyActionBar';
import QuoteGaps from '../components/QuoteGaps';
import { autoCostCurtainLine } from '../lib/curtainCalc';
import { resolveMeasureEntry } from '../lib/measureMath';
import { sheetGaps, openGapKeys, gapTotals, gapId } from '../lib/sheetGaps';

// Convert a measure-sheet line item → snapshot quote line item
function msLineToQuoteLine(msLi, idx, rates, pricedItems) {
  const parts = [];
  if (msLi.fabricColour && msLi.fabricColour !== 'N/A') parts.push(msLi.fabricColour);
  const prod = msLi.productNameSnapshot || msLi.productType || '';
  if (prod) parts.push(prod.toLowerCase());
  const suffs = [];
  if (msLi.heading && msLi.heading !== 'N/A') suffs.push(`${msLi.heading} heading`);
  if (msLi.fixing && msLi.fixing !== 'N/A') suffs.push(`${msLi.fixing} fix`);
  let desc = parts.join(' ');
  if (suffs.length) desc = desc ? `${desc} with ${suffs.join(', ')}` : suffs.join(', ');
  if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  if (msLi.operationAlternative) desc = `${msLi.operationAlternative} — ${desc}`;

  // Curtains are costed from their measurements by the calculator that replaced
  // the Excel workbook; everything else comes across with cost blank to price by
  // hand. Shared with QuoteBuilder's import so the two can't drift.
  const costed = autoCostCurtainLine(
    { ...msLi, productNameSnapshot: msLi.productNameSnapshot || msLi.productType },
    rates, pricedItems,
  );
  const curtainCost = costed && !costed.blocked
    ? {
        unitCostPrice:          costed.unitCostPrice,
        labourCost:             costed.labourCost,
        curtainFabricPricePerM: costed.curtainFabricPricePerM,
        curtainFabricPriceSource: costed.fabricPriceSource,   // see resolveLineFabricPrice
      }
    // Materials couldn't be priced, but making and fitting don't depend on the
    // fabric's price — so they come across and only the material cost is left
    // to type.
    : {
        unitCostPrice: '',
        labourCost: costed?.labourPriced ? costed.labourCost : '',
        curtainFabricPricePerM: '',
      };

  return {
    id: uuidv4(),
    openingId: msLi.id,
    ...openingQuoteSnapshot(msLi),
    sourceMeasureSheetItemId: msLi.id,        // snapshot link back to source
    // What the line is on the quote, decided in the room rather than
    // reconstructed from memory later. A line with alternatives is a "choose
    // one" block; an extra they asked about is an optional; everything else is
    // part of the job.
    type: msLi.choiceGroupId ? 'Multiple Choice'
        : msLi.isOptional    ? 'Optional'
        :                      'Required',
    choiceGroupId: msLi.choiceGroupId || null,
    location: msLi.location || '',
    productTypeId: msLi.productTypeId || '',
    productNameSnapshot: msLi.productNameSnapshot || msLi.productType || '',
    description: desc,
    quantity: msLi.quantity || 1,
    widthMm: msLi.widthMm || '',
    dropMm: msLi.dropMm || '',
    fabricColour: msLi.fabricColour || '',
    control: msLi.control || '',
    returnSide: msLi.returnSide || '',
    motorSide: msLi.motorSide || '',
    fixing: msLi.fixing || '',
    heading: msLi.heading || '',
    hem: msLi.hem || '',
    trackBaseBarColour: msLi.trackBaseBarColour || '',
    baseBarType: msLi.baseBarType || '',
    chainColour: msLi.chainColour || '',
    trackType: msLi.trackType || '',
    attachedLining: !!msLi.attachedLining,
    curtainFittingEnabled: true,
    ...curtainCost,
    marginPercent: DEFAULT_MARGIN_PERCENT,
    manualSellPrice: '',
    taxable: true,
    customerNotes: '',
    internalNotes: msLi.notes || '',
    sortOrder: idx,
  };
}

function SheetPicker({ sheets, selectedId, onSelect }) {
  return (
    <div className="space-y-2">
      {sheets.map(s => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full text-left flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
            selectedId === s.id
              ? 'border-amber-400 bg-amber-50'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 transition-colors ${
            selectedId === s.id ? 'border-amber-500 bg-amber-500' : 'border-slate-300'
          }`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800">
              {s.customerName || 'Measure Sheet'} · {s.measureDate || 'No date'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {(s.lineItems || []).length} item{(s.lineItems || []).length !== 1 ? 's' : ''} · Status: {s.status}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function ItemRow({ item, checked, onToggle, idx, gapCount = 0 }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 transition-colors border-b border-slate-50 last:border-0 ${
        checked ? 'bg-amber-50/50' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex-shrink-0 mt-0.5 text-amber-500">
        {checked
          ? <CheckSquare size={18} className="text-amber-500" />
          : <Square size={18} className="text-slate-300" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 font-mono">#{idx + 1}</span>
          <span className="text-sm font-medium text-slate-800 truncate">
            {item.location || '—'}
          </span>
          {item.productNameSnapshot && (
            <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
              {item.productNameSnapshot}
            </span>
          )}
          {/* Said here as well as in the panel below: this is the list you are
              choosing from, so the line that is short an answer should say so
              where you tick it. */}
          {gapCount > 0 && (
            <span className="text-[11px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <AlertTriangle size={9} /> {gapCount} missing
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
          {item.widthMm && <span>W {item.widthMm}mm</span>}
          {item.dropMm  && <span>D {item.dropMm}mm</span>}
          {item.quantity > 1 && <span>Qty {item.quantity}</span>}
          {item.fabricColour && <span>{item.fabricColour}</span>}
          {item.control && <span>{item.control}</span>}
        </div>
        {item.notes && (
          <p className="text-xs text-slate-400 mt-0.5 truncate">{item.notes}</p>
        )}
      </div>
    </button>
  );
}

export default function QuoteFromJob() {
  const { jobId } = useProjectParams();
  const navigate  = useProjectNavigate();
  const { profile, displayName } = useProfile() || {};

  const workspace=useProjectWorkspace();
  const job=getJob(jobId);
  const customer=getCustomer(job?.customerId);
  const sheets=getMeasureSheetsByJob(jobId).filter(s=>!s.deletedAt);

  const [selectedSheetId, setSelectedSheetId] = useState(() => sheets.find(s=>s.id===workspace?.state?.sheet)?.id || sheets[0]?.id || null);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [creating, setCreating]     = useState(false);
  const [error, setError]           = useState('');
  // Answers typed into the missing-information panel, held here until the quote
  // is created and then written back to the sheet in one go. Keyed by line id
  // so unticking a line does not throw away what was typed on it.
  const [fills, setFills]           = useState({});
  // Dismissals this visit, as a diff over the ones already on the sheet —
  // added and taken back. A diff rather than a set because a dismissal from
  // last time is remembered on the line, and undoing one has to stick too.
  const [dismissEdits, setDismissEdits] = useState({ add: new Set(), remove: new Set() });
  const [sheetConflict, setSheetConflict] = useState(false);
  // A freshly re-read copy of the sheet, after a write-back or after taking a
  // newer copy somebody else saved.
  const [reread, setReread] = useState(null);

  // Read once: these are localStorage-backed and the gap check runs over every
  // selected line on every keystroke in the panel.
  const productTypes = useMemo(() => getProductTypes(), []);
  const curtainRates = useMemo(() => getCurtainRates(), []);
  const fabricLib    = useMemo(() => getPricedItems(), []);

  // Read from the store rather than from the list this page loaded with: the
  // measure sheet is routinely open in another tab, and the gap list should be
  // measured against what is actually stored.
  const selectedSheet = useMemo(
    () => (reread?.id === selectedSheetId ? reread : null)
       || (selectedSheetId ? getMeasureSheet(selectedSheetId) : null)
       || sheets.find(s => s.id === selectedSheetId)
       || null,
    [sheets, selectedSheetId, reread]
  );

  const lineItems = useMemo(
    () => (selectedSheet?.lineItems || []).filter(li => li.location || li.productNameSnapshot),
    [selectedSheet]
  );

  // Auto-select all when sheet changes
  useEffect(() => {
    setCheckedIds(new Set(lineItems.map(li => li.id)));
  }, [selectedSheetId, lineItems.length]);

  // What has been dismissed: what the sheet already remembers, plus this
  // visit's diff. Remembering them is the point — somebody has answered "not on
  // this line" once, and asking again on every quote off the same sheet is how
  // the panel would earn being ignored.
  const dismissed = useMemo(() => {
    const all = new Set();
    lineItems.forEach(li => (li.quoteGapsDismissed || []).forEach(k => all.add(gapId(li.id, k))));
    dismissEdits.add.forEach(id => all.add(id));
    dismissEdits.remove.forEach(id => all.delete(id));
    return all;
  }, [lineItems, dismissEdits]);

  // ── Missing information ───────────────────────────────────────────────────
  // The gap list is built from the line as it is STORED, not as it is being
  // edited, so a row cannot disappear from under the cursor that is filling
  // it. What changes as you type is whether a row counts as answered.
  const gapOpts = useMemo(
    () => ({ productTypes, rates: curtainRates, pricedItems: fabricLib, measureSheetId: selectedSheet?.id || null }),
    [productTypes, curtainRates, fabricLib, selectedSheet],
  );

  const checkedLines = useMemo(
    () => lineItems.filter(li => checkedIds.has(li.id)),
    [lineItems, checkedIds],
  );

  const gapLines = useMemo(() => sheetGaps(checkedLines, gapOpts), [checkedLines, gapOpts]);

  const patched = useCallback(
    (li) => (fills[li.id] ? { ...li, ...fills[li.id] } : li),
    [fills],
  );

  // Which rows have since been answered — recomputed against the edited line,
  // so filling a heading also clears the curtain calculator's complaint about
  // it rather than leaving a row that is no longer true.
  const resolvedIds = useMemo(() => {
    const out = new Set();
    gapLines.forEach(({ id, item, gaps }) => {
      if (!fills[id]) return;
      const stillOpen = openGapKeys(patched(item), gapOpts);
      gaps.forEach(g => { if (!stillOpen.has(g.key)) out.add(gapId(id, g.key)); });
    });
    return out;
  }, [gapLines, fills, patched, gapOpts]);

  const totals = useMemo(() => gapTotals(gapLines, dismissed, resolvedIds), [gapLines, dismissed, resolvedIds]);

  // Per line, for the chip on the tick list.
  const gapCountByLine = useMemo(() => {
    const out = {};
    gapLines.forEach(({ id, gaps }) => {
      out[id] = gaps.filter(g => !dismissed.has(gapId(id, g.key)) && !resolvedIds.has(gapId(id, g.key))).length;
    });
    return out;
  }, [gapLines, dismissed, resolvedIds]);

  const getValue = useCallback(
    (lineId, field) => {
      const filled = fills[lineId];
      if (filled && Object.prototype.hasOwnProperty.call(filled, field)) return filled[field];
      return lineItems.find(li => li.id === lineId)?.[field] ?? '';
    },
    [fills, lineItems],
  );

  const setFill = useCallback((lineId, field, value) => {
    setFills(prev => ({ ...prev, [lineId]: { ...(prev[lineId] || {}), [field]: value } }));
  }, []);

  // A width is typed as a sum as often as a number — "1200+50+50" — and the
  // sheet keeps both the answer and the working. Same rule here, or the two
  // places you can type a measurement would behave differently.
  const commitMeasure = useCallback((lineId, field, raw) => {
    const resolved = resolveMeasureEntry(raw);
    setFills(prev => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        [field]: resolved ? resolved.value : raw,
        [`${field}Expr`]: resolved ? resolved.expression : '',
      },
    }));
  }, []);

  const editDismissals = useCallback((ids, dismissing) => {
    setDismissEdits((prev) => {
      const add = new Set(prev.add);
      const remove = new Set(prev.remove);
      ids.forEach((id) => {
        if (dismissing) { add.add(id); remove.delete(id); }
        else { remove.add(id); add.delete(id); }
      });
      return { add, remove };
    });
  }, []);

  const dismissGap  = useCallback((id) => editDismissals([id], true),  [editDismissals]);
  const restoreGap  = useCallback((id) => editDismissals([id], false), [editDismissals]);
  const dismissLine = useCallback((lineId) => {
    const line = gapLines.find(l => l.id === lineId);
    editDismissals((line?.gaps || []).map(g => gapId(lineId, g.key)), true);
  }, [gapLines, editDismissals]);
  const dismissAll = useCallback(() => {
    const ids = [];
    gapLines.forEach(({ id, gaps }) => gaps.forEach(g => ids.push(gapId(id, g.key))));
    editDismissals(ids, true);
  }, [gapLines, editDismissals]);

  if (!job) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Project not found.</p>
      </div>
    );
  }

  const allChecked  = lineItems.length > 0 && checkedIds.size === lineItems.length;
  const noneChecked = checkedIds.size === 0;

  const toggleAll = () => {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(lineItems.map(li => li.id)));
  };

  const toggleItem = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /**
   * Put the answers back on the measure sheet before the quote is built.
   *
   * The sheet is the source of truth for a measurement, so a drop typed here
   * has to land there or the two disagree from the moment the quote exists —
   * and the next quote off the same sheet would ask for it again.
   *
   * Written FIRST, and the quote is abandoned if the write is refused. A
   * refusal means somebody else saved the sheet since this page loaded (it is
   * routinely open in another tab), and the alternative is a quote built from
   * numbers that were never recorded anywhere.
   *
   * @returns {boolean} false when the write was refused and nothing should proceed
   */
  const writeAnswersBack = () => {
    if (!selectedSheet) return true;
    const edited = Object.keys(fills).filter(id => Object.keys(fills[id] || {}).length);
    const byLine = {};          // line id → { add: Set, remove: Set } of gap keys
    const bucket = (id) => (byLine[id] ||= { add: new Set(), remove: new Set() });
    dismissEdits.add.forEach((id) => {
      const [lineId, key] = id.split('::');
      if (key) bucket(lineId).add.add(key);
    });
    dismissEdits.remove.forEach((id) => {
      const [lineId, key] = id.split('::');
      if (key) bucket(lineId).remove.add(key);
    });
    if (!edited.length && !Object.keys(byLine).length) return true;

    const nextLines = (selectedSheet.lineItems || []).map((li) => {
      const fill = fills[li.id];
      const diff = byLine[li.id];
      if (!fill && !diff) return li;
      const next = { ...li, ...(fill || {}) };
      if (diff) {
        const keys = new Set(li.quoteGapsDismissed || []);
        diff.add.forEach(k => keys.add(k));
        diff.remove.forEach(k => keys.delete(k));
        next.quoteGapsDismissed = [...keys];
      }
      return next;
    });

    const saved = saveMeasureSheet(
      { ...selectedSheet, lineItems: nextLines },
      { baseUpdatedAt: selectedSheet.updatedAt || null },
    );
    if (saved?.__conflict) { setSheetConflict(true); return false; }
    // The answers are on the sheet now, so they are no longer a pending diff.
    setReread(saved || getMeasureSheet(selectedSheet.id));
    setDismissEdits({ add: new Set(), remove: new Set() });
    setFills({});
    return true;
  };

  const takeNewerSheet = () => {
    setSheetConflict(false);
    setReread(getMeasureSheet(selectedSheetId));
    setError('');
  };

  const handleCreate = async () => {
    if (creating) return;
    if (lineItems.length > 0 && checkedIds.size === 0) {
      setError('Select at least one item to include in the quote.');
      return;
    }

    setCreating(true);
    setError('');
    try {
      if (!writeAnswersBack()) {
        setError('The measure sheet was saved somewhere else while this was open. Take the newer copy, then create the quote.');
        setCreating(false);
        return;
      }

      const selectedLines = lineItems
        .filter(li => checkedIds.has(li.id))
        .map(patched)
        .flatMap(expandOperationAlternatives)
        .map((li, i) => msLineToQuoteLine(li, i, curtainRates, fabricLib));

      const quote = createQuote({
        customerId:      job.customerId,
        jobId:           job.id,
        measureSheetId:  selectedSheet?.id || null,
        title:           `${customer?.name || 'Quote'} — ${job.title || 'Quote'}`,
        salesperson:     displayName || '',
        siteAddress:     job.siteAddress || customer?.address || '',
        lineItems:       selectedLines,
        status:          'Draft',
      });

      // Await Supabase confirmation, then go straight to the edit page.
      await syncNow([{ table: 'quotes', record: quote }]);

      addActivity({ jobId: job.id, type: 'quote_created', message: `Quote ${quote.quoteNumber} created`, user: displayName || 'System' });

      navigate(`/quotes/${quote.id}/edit`);
    } catch (err) {
      console.error('[QuoteFromJob]', err);
      setError(err.message || 'Failed to create quote. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5 pb-32">
      {/* Back */}

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">New Quote</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {customer?.name} · {job.jobNumber}
        </p>
      </div>

      {/* Job context */}
      <Card className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <FileText size={16} className="text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{customer?.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {job.jobNumber} · {job.status}
            </p>
            {customer?.address && (
              <p className="text-xs text-slate-400 mt-0.5">{customer.address}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Measure sheet selector */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <ClipboardList size={14} className="text-amber-500" /> Measure Sheet
          </h2>
        </div>
        <div className="p-4">
          {sheets.length === 0 ? (
            <div className="text-center py-6">
              <ClipboardList size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-500">No measure sheets found for this project.</p>
              <p className="text-xs text-slate-400 mt-1">Complete a measure sheet first, then return to create a quote.</p>
              <button
                onClick={() => navigate(`/measure-sheets/new`)}
                className="mt-3 text-xs text-amber-600 hover:underline"
              >
                Create measure sheet →
              </button>
            </div>
          ) : sheets.length === 1 ? (
            <div className="flex items-center gap-3 py-1">
              <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {sheets[0].customerName || 'Measure Sheet'} · {sheets[0].measureDate || 'No date'}
                </p>
                <p className="text-xs text-slate-500">
                  {(sheets[0].lineItems || []).length} items · Auto-selected
                </p>
              </div>
            </div>
          ) : (
            <SheetPicker
              sheets={sheets}
              selectedId={selectedSheetId}
              onSelect={(id) => {
                // A different sheet is a different set of questions: typed
                // answers and dismissals belong to the one they were given for.
                setSelectedSheetId(id);
                setCheckedIds(new Set());
                setFills({});
                setDismissEdits({ add: new Set(), remove: new Set() });
                setSheetConflict(false);
                setReread(null);
                setError('');
              }}
            />
          )}
        </div>
      </Card>

      {/* Line items */}
      {selectedSheet && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">
              Products / Services
              {lineItems.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {checkedIds.size} of {lineItems.length} selected
                </span>
              )}
            </h2>
            {lineItems.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
              >
                {allChecked ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {lineItems.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm font-medium text-slate-500">No products or services on this measure sheet.</p>
              <p className="text-xs text-slate-400 mt-1">Add items to the measure sheet before creating a quote.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {lineItems.map((li, i) => (
                <ItemRow
                  key={li.id}
                  item={li}
                  idx={i}
                  checked={checkedIds.has(li.id)}
                  gapCount={checkedIds.has(li.id) ? (gapCountByLine[li.id] || 0) : 0}
                  onToggle={() => toggleItem(li.id)}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* What the sheet is still short of, with somewhere to answer it */}
      {sheetConflict && (
        <Card className="px-5 py-4 border-amber-300 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">This measure sheet was saved somewhere else</p>
              <p className="text-xs text-amber-800 mt-0.5">
                Someone saved a newer copy while this page was open, so your answers
                were not written to it. Take the newer copy — anything you typed
                here stays on screen.
              </p>
              <button
                type="button"
                onClick={takeNewerSheet}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 border border-amber-300 bg-white hover:bg-amber-100 px-2.5 py-1.5 rounded-lg"
              >
                <RefreshCw size={12} /> Take the newer copy
              </button>
            </div>
          </div>
        </Card>
      )}

      {selectedSheet && <button type="button" onClick={()=>navigate(`/measure-sheets/${selectedSheet.id}/openings`)} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">Review grouped missing information & opening specifications</button>}
      <QuoteGaps
        lines={gapLines}
        totals={totals}
        resolvedIds={resolvedIds}
        dismissed={dismissed}
        getValue={getValue}
        onChange={setFill}
        onCommitMeasure={commitMeasure}
        onDismiss={dismissGap}
        onRestore={restoreGap}
        onDismissLine={dismissLine}
        onDismissAll={dismissAll}
        productTypes={productTypes}
      />

      {/* Sticky action bar */}
      <StickyActionBar>
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1 mb-2 justify-center">
            <AlertCircle size={12} /> {error}
          </p>
        )}
        {/* Said on the bar too, because the button is what people reach for
            without scrolling. It never blocks: a quote with holes in it is
            often exactly what is wanted on the day. */}
        {totals.total > 0 && (
          <p className="text-xs text-amber-700 flex items-center gap-1 mb-2 justify-center">
            <AlertTriangle size={12} />
            {totals.total} missing on {totals.lines} line{totals.lines !== 1 ? 's' : ''}
            {totals.price > 0 && <span className="text-slate-500">· {totals.price} stop{totals.price !== 1 ? '' : 's'} a line being priced</span>}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            onClick={() => navigate(`/jobs/${jobId}`)}
            className="border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedSheet || (lineItems.length > 0 && noneChecked)}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 sm:px-6 py-2.5 rounded-lg transition-colors whitespace-nowrap"
          >
            {creating
              ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Creating…</>
              : <><FileText size={15} /> Create Quote{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}</>
            }
          </button>
        </div>
      </StickyActionBar>
    </div>
  );
}
