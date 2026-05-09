import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Filter, Plus, Briefcase, SlidersHorizontal, X,
  Trash2, CheckSquare, Square, AlertTriangle,
} from 'lucide-react';
import { getJobs, getJobsFiltered, getCustomers, JOB_STATUSES, getActiveEmployees, deleteJob, bulkDeleteJobs } from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import StatusBadge from '../components/StatusBadge';
import UrgencyBadge from '../components/UrgencyBadge';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import { format, parseISO } from 'date-fns';

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2">
      <CheckSquare size={15} className="text-green-400" /> {message}
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────
function DeleteModal({ count, onConfirm, onCancel }) {
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
              {isBulk ? `Delete ${count} jobs?` : 'Delete this job?'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {isBulk
                ? `Are you sure you want to delete ${count} jobs? This action cannot be undone.`
                : 'Are you sure you want to delete this job? This action cannot be undone.'}
            </p>
            <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-700">
                Deleting {isBulk ? 'these jobs' : 'this job'} may affect linked measure sheets, quotes, and installations.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {isBulk ? `Delete ${count} Jobs` : 'Delete Job'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Jobs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch]         = useState('');
  const [status, setStatus]         = useState(searchParams.get('status') || '');
  const [urgency, setUrgency]       = useState(searchParams.get('urgency') === 'urgent' ? 'High' : '');
  const [staff, setStaff]           = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast]           = useState(null);

  const { isAM = true, displayName = '' } = useProfile() || {};
  const jobs      = getJobsFiltered(isAM, displayName);
  const customers = getCustomers();
  const staffList = getActiveEmployees();

  const filtered = useMemo(() => {
    return jobs.filter(job => {
      const customer = customers.find(c => c.id === job.customerId);
      const term = search.toLowerCase();
      if (term) {
        const haystack = [
          customer?.name, customer?.phone, customer?.address,
          job.jobNumber, job.jobType, job.assignedStaff,
        ].join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (status && job.status !== status) return false;
      if (urgency) {
        if (urgency === 'High' && job.urgency !== 'High' && job.urgency !== 'Urgent') return false;
      }
      if (staff && job.assignedStaff !== staff) return false;
      return true;
    }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [jobs, customers, search, status, urgency, staff]);

  const clearFilters = () => { setStatus(''); setUrgency(''); setStaff(''); setSearch(''); };
  const hasFilters = status || urgency || staff || search;

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(j => selected.has(j.id));
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(filtered.map(j => j.id)));

  const targetIds = deleteTarget === 'bulk' ? [...selected] : deleteTarget ? [deleteTarget] : [];

  const handleConfirmDelete = () => {
    const count = targetIds.length;
    bulkDeleteJobs(targetIds);
    setSelected(new Set());
    setDeleteTarget(null);
    setSelectMode(false);
    setToast(count === 1 ? 'Job deleted.' : `${count} jobs deleted.`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} job{filtered.length !== 1 ? 's' : ''} found</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {jobs.length > 0 && (
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
            onClick={() => navigate('/measure-sheets/new')}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
          >
            <Plus size={16} /> New Measure Sheet
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, address, job type…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
            hasFilters ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal size={15} />
          Filters
          {hasFilters && <span className="bg-amber-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">!</span>}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">All statuses</option>
                {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Priority</label>
              <select value={urgency} onChange={e => setUrgency(e.target.value)}
                className="border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">All priorities</option>
                <option value="High">High / Urgent</option>
                <option value="Normal">Normal</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Assigned Staff</label>
              <select value={staff} onChange={e => setStaff(e.target.value)}
                className="border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">All staff</option>
                {staffList.map(s => <option key={s.id} value={s.fullName}>{s.fullName}</option>)}
              </select>
            </div>
            {hasFilters && (
              <div className="flex items-end">
                <button onClick={clearFilters} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg hover:bg-slate-100">
                  <X size={14} /> Clear filters
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Status pill filters */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {['All', ...JOB_STATUSES].map(s => (
          <button key={s} onClick={() => setStatus(s === 'All' ? '' : s)}
            className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              (s === 'All' && !status) || status === s
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg">
          <span className="text-sm font-medium flex-1">
            {selected.size} job{selected.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setDeleteTarget('bulk')}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Trash2 size={13} /> Delete Selected
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-slate-400 hover:text-white text-xs px-2 py-1.5 rounded-lg transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* Jobs list */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Briefcase}
            title="No jobs found"
            description="Try adjusting your search or filters."
            action={hasFilters && (
              <button onClick={clearFilters} className="text-sm text-amber-600 hover:underline">Clear filters</button>
            )}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select all row */}
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

          {filtered.map(job => {
            const customer  = customers.find(c => c.id === job.customerId);
            const isSelected = selected.has(job.id);
            return (
              <div key={job.id}
                className={`group bg-white rounded-xl border shadow-sm flex items-center hover:shadow-md transition-all ${
                  isSelected ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Checkbox — always reserves space */}
                <button
                  onClick={e => selectMode && toggleSelect(job.id, e)}
                  className="pl-4 py-4 flex-shrink-0"
                >
                  {selectMode
                    ? isSelected
                      ? <CheckSquare size={16} className="text-amber-500" />
                      : <Square size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                    : <span className="w-4 block" />}
                </button>

                {/* Main content */}
                <button
                  onClick={() => selectMode ? toggleSelect(job.id, { stopPropagation: () => {} }) : navigate(`/jobs/${job.id}`)}
                  className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3 py-4 pr-2 text-left min-w-0"
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-700 font-bold text-sm">{customer?.name?.charAt(0) || 'J'}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-semibold text-slate-900 text-sm">{customer?.name}</span>
                      <span className="text-slate-400 text-xs">{job.jobNumber}</span>
                      <StatusBadge status={job.status} size="sm" />
                      {(job.urgency === 'High' || job.urgency === 'Urgent') && <UrgencyBadge urgency={job.urgency} />}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                      <span>{job.jobType}</span>
                      {customer?.address && <span className="truncate max-w-[200px]">{customer.address}</span>}
                      {job.assignedStaff && <span>👤 {job.assignedStaff}</span>}
                      {job.measureDate && <span>📐 {format(parseISO(job.measureDate), 'd MMM yyyy')}</span>}
                      {job.installDate && <span>🔧 {format(parseISO(job.installDate), 'd MMM yyyy')}</span>}
                    </div>
                  </div>

                  {!selectMode && (
                    <div className="text-slate-300 group-hover:text-amber-500 transition-colors hidden sm:block">
                      <Filter size={16} className="rotate-180" />
                    </div>
                  )}
                </button>

                {/* Per-row delete */}
                {selectMode && (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(job.id); }}
                    className="pr-4 py-4 flex-shrink-0 text-slate-300 hover:text-red-500 transition-colors"
                    title="Delete job"
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
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
