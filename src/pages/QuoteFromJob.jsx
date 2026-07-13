import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  FileText, CheckSquare, Square,
  AlertCircle, ClipboardList,
} from 'lucide-react';
import {
  getJob, getCustomer, getMeasureSheetsByJob,
  createQuote, saveQuote, addActivity, getQuotesByJob,
} from '../store/data';
import { syncNow } from '../store/db';
import { useProfile } from '../contexts/UserProfileContext';
import Card from '../components/Card';

// Convert a measure-sheet line item → snapshot quote line item
function msLineToQuoteLine(msLi, idx) {
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

  return {
    id: uuidv4(),
    sourceMeasureSheetItemId: msLi.id,        // snapshot link back to source
    type: 'Required',
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
    unitCostPrice: '',
    labourCost: '',
    marginPercent: 40,
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

function ItemRow({ item, checked, onToggle, idx }) {
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
  const { jobId } = useParams();
  const navigate  = useNavigate();
  const { profile, displayName } = useProfile() || {};

  const job      = useMemo(() => getJob(jobId), [jobId]);
  const customer = useMemo(() => getCustomer(job?.customerId), [job]);
  const sheets   = useMemo(() => getMeasureSheetsByJob(jobId), [jobId]);

  const [selectedSheetId, setSelectedSheetId] = useState(() => sheets[0]?.id || null);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [creating, setCreating]     = useState(false);
  const [error, setError]           = useState('');

  const selectedSheet = useMemo(
    () => sheets.find(s => s.id === selectedSheetId) || null,
    [sheets, selectedSheetId]
  );

  const lineItems = useMemo(
    () => (selectedSheet?.lineItems || []).filter(li => li.location || li.productNameSnapshot),
    [selectedSheet]
  );

  // Auto-select all when sheet changes
  useEffect(() => {
    setCheckedIds(new Set(lineItems.map(li => li.id)));
  }, [selectedSheetId, lineItems.length]);

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

  const handleCreate = async () => {
    if (creating) return;
    if (lineItems.length > 0 && checkedIds.size === 0) {
      setError('Select at least one item to include in the quote.');
      return;
    }

    setCreating(true);
    setError('');
    try {
      const selectedLines = lineItems
        .filter(li => checkedIds.has(li.id))
        .map((li, i) => msLineToQuoteLine(li, i));

      const quote = createQuote({
        customerId:      job.customerId,
        jobId:           job.id,
        measureSheetId:  selectedSheet?.id || null,
        title:           `${customer?.name || 'Quote'} — ${job.jobType || job.title || 'Quote'}`,
        salesperson:     displayName || '',
        siteAddress:     customer?.address || '',
        lineItems:       selectedLines,
        status:          'Draft',
      });

      // Await Supabase confirmation, then go straight to the edit page.
      await syncNow([{ table: 'quotes', record: quote }]);

      addActivity({ jobId: job.id, type: 'quote_sent', message: `Quote ${quote.quoteNumber} created`, user: displayName || 'System' });

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
              {job.jobNumber} · {job.jobType || 'Window Treatment'} · {job.status}
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
            <SheetPicker sheets={sheets} selectedId={selectedSheetId} onSelect={id => { setSelectedSheetId(id); setCheckedIds(new Set()); }} />
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
                  onToggle={() => toggleItem(li.id)}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Sticky action bar */}
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 z-20 lg:pl-72">
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1 mb-2 justify-center">
            <AlertCircle size={12} /> {error}
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
      </div>
    </div>
  );
}
