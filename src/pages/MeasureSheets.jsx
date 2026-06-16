import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Search, X, Trash2, CheckSquare, Square, AlertTriangle, Upload } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  getMeasureSheets, getMeasureSheetsFiltered, getCustomers, getJobs, getQuotes,
  deleteMeasureSheet, bulkDeleteMeasureSheets,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const STATUS_COLORS = {
  Draft:     'bg-slate-100 text-slate-600',
  Submitted: 'bg-green-100 text-green-700',
};

// ── Simple toast ─────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2 animate-fade-in">
      <CheckSquare size={15} className="text-green-400" /> {message}
    </div>
  );
}

// ── Delete confirmation modal ────────────────────────────────────────────────
function DeleteModal({ count, hasLinks, onConfirm, onCancel }) {
  const isBulk = count > 1;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              {isBulk ? `Delete ${count} measure sheets?` : 'Delete this measure sheet?'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {isBulk
                ? `Are you sure you want to delete ${count} measure sheets? This action cannot be undone.`
                : 'Are you sure you want to delete this measure sheet? This action cannot be undone.'}
            </p>
            {hasLinks && (
              <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-700">
                  {isBulk ? 'Some of these measure sheets are' : 'This measure sheet is'} linked to quotes, jobs, or installations. Deleting may affect historical records.
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {isBulk ? `Delete ${count} Measure Sheets` : 'Delete Measure Sheet'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MeasureSheets() {
  useDataRefresh();
  const navigate  = useNavigate();
  const [search, setSearch]         = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null); // 'bulk' | sheet id
  const [toast, setToast]           = useState(null);

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const { isAM = true, displayName = '' } = useProfile() || {};
  const sheets    = getMeasureSheetsFiltered(isAM, displayName);
  const customers = getCustomers();
  const jobs      = getJobs();
  const quotes    = getQuotes();

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return sheets.filter(s => {
      if (!term) return true;
      const customer = customers.find(c => c.id === s.customerId);
      const job = jobs.find(j => j.id === s.jobId);
      return [customer?.name, customer?.phone, s.measurer, job?.jobNumber]
        .join(' ').toLowerCase().includes(term);
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [sheets, customers, jobs, search]);

  // Check if a sheet is linked to quotes or jobs
  const isLinked = (sheetId) =>
    quotes.some(q => q.measureSheetId === sheetId) ||
    jobs.some(j => j.measureSheetId === sheetId);

  const targetIds = deleteTarget === 'bulk'
    ? [...selected]
    : deleteTarget ? [deleteTarget] : [];

  const hasLinks = targetIds.some(isLinked);

  // Select / deselect
  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(s => s.id)));
    }
  };

  const handleConfirmDelete = () => {
    const count = targetIds.length;
    bulkDeleteMeasureSheets(targetIds);
    setSelected(new Set());
    setDeleteTarget(null);
    setSelectMode(false);
    setToast(count === 1 ? 'Measure sheet deleted.' : `${count} measure sheets deleted.`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Measure Sheets</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} sheet{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {filtered.length > 0 && (
            selectMode ? (
              <button onClick={exitSelectMode}
                className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            ) : (
              <button onClick={() => setSelectMode(true)}
                className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                Select
              </button>
            )
          )}
          <button
            onClick={() => navigate('/measure-sheets/import')}
            className="flex items-center gap-2 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            <Upload size={15} /> Import Measure Sheet
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer, job, measurer…"
          className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg">
          <span className="text-sm font-medium flex-1">
            {selected.size} measure sheet{selected.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setDeleteTarget('bulk')}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Trash2 size={13} /> Delete Selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-slate-400 hover:text-white text-xs px-2 py-1.5 rounded-lg transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No measure sheets yet"
            description="Open a Job Workspace to create or import a measure sheet — it will link automatically."
            action={
              <button onClick={() => navigate('/jobs')}
                className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Go to Jobs
              </button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select all row — only in select mode */}
          {selectMode && filtered.length > 1 && (
            <div className="flex items-center gap-3 px-1 pb-1">
              <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800 transition-colors">
                {allSelected
                  ? <CheckSquare size={15} className="text-amber-500" />
                  : <Square size={15} className="text-slate-300" />}
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
          )}

          {filtered.map(sheet => {
            const customer = customers.find(c => c.id === sheet.customerId);
            const job = jobs.find(j => j.id === sheet.jobId);
            const isSelected = selected.has(sheet.id);
            return (
              <div
                key={sheet.id}
                className={`group bg-white rounded-xl border shadow-sm flex items-center gap-3 hover:shadow-md transition-all ${
                  isSelected ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Checkbox — always reserves space, only interactive in select mode */}
                <button
                  onClick={e => selectMode && toggleSelect(sheet.id, e)}
                  className="pl-4 py-4 flex-shrink-0"
                >
                  {selectMode
                    ? isSelected
                      ? <CheckSquare size={16} className="text-amber-500" />
                      : <Square size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                    : <span className="w-4 block" />}
                </button>

                {/* Main content — navigate on click */}
                <button
                  onClick={() => navigate(`/measure-sheets/${sheet.id}`)}
                  className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3 py-4 pr-4 text-left min-w-0"
                >
                  <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <ClipboardList size={16} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-slate-800">{customer?.name || 'Unknown Customer'}</span>
                      {job && <span className="text-xs text-slate-400">{job.jobNumber}</span>}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[sheet.status] || STATUS_COLORS.Draft}`}>
                        {sheet.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                      <span>{sheet.lineItems?.length || 0} item{sheet.lineItems?.length !== 1 ? 's' : ''}</span>
                      {sheet.measurer && <span>👤 {sheet.measurer}</span>}
                      {sheet.measureDate && <span>📅 {format(parseISO(sheet.measureDate), 'd MMM yyyy')}</span>}
                      {sheet.createdAt && <span>Created {format(parseISO(sheet.createdAt), 'd MMM yyyy')}</span>}
                    </div>
                  </div>
                  <span className="text-slate-300 group-hover:text-amber-500 transition-colors hidden sm:block">→</span>
                </button>

                {/* Per-row delete — only in select mode */}
                {selectMode && (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(sheet.id); }}
                    className="pr-4 py-4 flex-shrink-0 text-slate-300 hover:text-red-500 transition-colors"
                    title="Delete measure sheet"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation modal */}
      {deleteTarget && (
        <DeleteModal
          count={targetIds.length}
          hasLinks={hasLinks}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
