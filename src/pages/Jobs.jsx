import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, Plus, Briefcase, SlidersHorizontal, X } from 'lucide-react';
import { getJobs, getCustomers, JOB_STATUSES, getStaff } from '../store/data';
import StatusBadge from '../components/StatusBadge';
import UrgencyBadge from '../components/UrgencyBadge';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import { format, parseISO } from 'date-fns';

export default function Jobs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState(searchParams.get('status') || '');
  const [urgency, setUrgency] = useState(searchParams.get('urgency') === 'urgent' ? 'High' : '');
  const [staff, setStaff]     = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const jobs      = getJobs();
  const customers = getCustomers();
  const staffList = getStaff();

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

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} job{filtered.length !== 1 ? 's' : ''} found</p>
        </div>
        <button
          onClick={() => navigate('/measure-sheets/new')}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors self-start"
        >
          <Plus size={16} />
          New Measure Sheet
        </button>
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
                {staffList.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
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
          <button
            key={s}
            onClick={() => setStatus(s === 'All' ? '' : s)}
            className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              (s === 'All' && !status) || status === s
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

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
          {filtered.map(job => {
            const customer = customers.find(c => c.id === job.customerId);
            return (
              <button
                key={job.id}
                onClick={() => navigate(`/jobs/${job.id}`)}
                className="w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:shadow-md hover:border-slate-300 transition-all text-left group"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-amber-700 font-bold text-sm">{customer?.name?.charAt(0) || 'J'}</span>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className="font-semibold text-slate-900 text-sm">{customer?.name}</span>
                    <span className="text-slate-400 text-xs">{job.jobNumber}</span>
                    <StatusBadge status={job.status} size="sm" />
                    {(job.urgency === 'High' || job.urgency === 'Urgent') && (
                      <UrgencyBadge urgency={job.urgency} />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span>{job.jobType}</span>
                    {customer?.address && <span className="truncate max-w-[200px]">{customer.address}</span>}
                    {job.assignedStaff && <span>👤 {job.assignedStaff}</span>}
                    {job.measureDate && <span>📐 {format(parseISO(job.measureDate), 'd MMM yyyy')}</span>}
                    {job.installDate && <span>🔧 {format(parseISO(job.installDate), 'd MMM yyyy')}</span>}
                  </div>
                </div>

                {/* Arrow */}
                <div className="text-slate-300 group-hover:text-amber-500 transition-colors hidden sm:block">
                  <Filter size={16} className="rotate-180" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
