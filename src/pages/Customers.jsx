import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Phone, Mail, MapPin, X, ChevronRight } from 'lucide-react';
import { getCustomers, getJobsByCustomer } from '../store/data';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';

export default function Customers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const customers = getCustomers();

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    if (!term) return customers;
    return customers.filter(c =>
      [c.name, c.phone, c.email, c.address].join(' ').toLowerCase().includes(term)
    );
  }, [customers, search]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
        <p className="text-slate-500 text-sm mt-0.5">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, email, address…"
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
          <EmptyState icon={Users} title="No customers found" description="Try a different search term." />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(customer => {
            const jobs = getJobsByCustomer(customer.id);
            const activeJobs = jobs.filter(j => j.status !== 'Completed' && j.status !== 'Cancelled');
            const latestJob = [...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
            return (
              <button
                key={customer.id}
                onClick={() => navigate(`/customers/${customer.id}`)}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-left hover:shadow-md hover:border-slate-300 transition-all group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-base">
                    {customer.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 text-sm truncate">{customer.name}</div>
                    <div className="text-xs text-slate-400">{jobs.length} job{jobs.length !== 1 ? 's' : ''} · {activeJobs.length} active</div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                </div>
                <div className="space-y-1.5 text-xs text-slate-500">
                  {customer.phone && <div className="flex items-center gap-1.5"><Phone size={11} />{customer.phone}</div>}
                  {customer.email && <div className="flex items-center gap-1.5 truncate"><Mail size={11} /><span className="truncate">{customer.email}</span></div>}
                  {customer.address && <div className="flex items-center gap-1.5"><MapPin size={11} /><span className="truncate">{customer.address}</span></div>}
                </div>
                {latestJob && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400">{latestJob.jobNumber}</span>
                    <StatusBadge status={latestJob.status} size="sm" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
