import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, Search, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getMeasureSheets, getCustomers, getJobs } from '../store/data';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const STATUS_COLORS = {
  Draft:     'bg-slate-100 text-slate-600',
  Submitted: 'bg-green-100 text-green-700',
};

export default function MeasureSheets() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const sheets    = getMeasureSheets();
  const customers = getCustomers();
  const jobs      = getJobs();

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

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Measure Sheets</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} sheet{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => navigate('/measure-sheets/new')}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors self-start"
        >
          <Plus size={16} />
          New Measure Sheet
        </button>
      </div>

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

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No measure sheets yet"
            description="Create a new measure sheet to get started."
            action={
              <button onClick={() => navigate('/measure-sheets/new')}
                className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                New Measure Sheet
              </button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(sheet => {
            const customer = customers.find(c => c.id === sheet.customerId);
            const job = jobs.find(j => j.id === sheet.jobId);
            return (
              <button
                key={sheet.id}
                onClick={() => navigate(`/measure-sheets/${sheet.id}`)}
                className="w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:shadow-md hover:border-slate-300 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center flex-shrink-0">
                  <ClipboardList size={18} className="text-amber-600" />
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
                    <span>{sheet.lineItems?.length || 0} line item{sheet.lineItems?.length !== 1 ? 's' : ''}</span>
                    {sheet.measurer && <span>👤 {sheet.measurer}</span>}
                    {sheet.measureDate && <span>📅 {format(parseISO(sheet.measureDate), 'd MMM yyyy')}</span>}
                    {sheet.createdAt && <span>Created {format(parseISO(sheet.createdAt), 'd MMM yyyy')}</span>}
                  </div>
                </div>
                <span className="text-slate-300 group-hover:text-amber-500 transition-colors hidden sm:block">→</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
