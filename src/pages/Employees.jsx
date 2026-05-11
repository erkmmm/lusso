import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserCog, Search, X, Mail, Phone,
  ToggleLeft, ToggleRight, ChevronRight,
} from 'lucide-react';
import { fetchEmployeesFromSupabase, suspendUser, reactivateUser } from '../store/profiles';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const ACCOUNT_TYPE_COLORS = {
  account_manager: 'bg-amber-100 text-amber-700',
  standard_user:   'bg-slate-100 text-slate-600',
  salesperson:     'bg-slate-100 text-slate-600',
};
const ACCOUNT_TYPE_LABELS = {
  account_manager: 'Account Manager',
  standard_user:   'Standard User',
  salesperson:     'Standard User',
};
const EMPLOYEE_ROLE_LABELS = {
  salesperson:     'Salesperson',
  account_manager: 'Account Manager',
};

function Avatar({ name, size = 'md' }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} bg-amber-500 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Employees() {
  const navigate = useNavigate();
  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [toast,        setToast]        = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchEmployeesFromSupabase();
    setEmployees(data);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return employees.filter(e => {
      if (statusFilter === 'active'   && e.status !== 'active')    return false;
      if (statusFilter === 'inactive' && e.status === 'active')    return false;
      if (roleFilter && e.role !== roleFilter)                      return false;
      if (term && !`${e.displayName} ${e.email} ${e.positionTitle} ${e.role}`.toLowerCase().includes(term)) return false;
      return true;
    }).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }, [employees, search, roleFilter, statusFilter]);

  const handleToggle = async (emp) => {
    const isActive = emp.status === 'active';
    if (isActive) await suspendUser(emp.id);
    else           await reactivateUser(emp.id);
    showToast(`${emp.displayName} marked ${isActive ? 'inactive' : 'active'}.`);
    await refresh();
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Employees</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} employee${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, role…"
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>

        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">All types</option>
          <option value="standard_user">Standard User</option>
          <option value="account_manager">Account Manager</option>
        </select>

        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white text-sm">
          {[['active','Active'],['all','All'],['inactive','Inactive']].map(([val, label]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              className={`px-3 py-2 font-medium transition-colors ${statusFilter === val ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={UserCog}
            title="No employees found"
            description={search || roleFilter ? 'Try adjusting your filters.' : 'Approved team members appear here automatically.'}
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(emp => {
            const isActive = emp.status === 'active';
            return (
              <div
                key={emp.id}
                className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all group ${isActive ? 'border-slate-200 hover:border-slate-300' : 'border-slate-100 opacity-70'}`}
              >
                <button
                  onClick={() => navigate(`/employees/${emp.id}`)}
                  className="w-full text-left p-4 flex items-start gap-3"
                >
                  <Avatar name={emp.displayName} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-800 truncate">{emp.displayName || emp.email}</span>
                      {!isActive && (
                        <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Suspended</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACCOUNT_TYPE_COLORS[emp.role] || 'bg-slate-100 text-slate-600'}`}>
                        {ACCOUNT_TYPE_LABELS[emp.role] || emp.role}
                      </span>
                      {emp.employeeRole && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                          {EMPLOYEE_ROLE_LABELS[emp.employeeRole] || emp.employeeRole}
                        </span>
                      )}
                    </div>
                    {emp.positionTitle && (
                      <p className="text-xs text-slate-500 mt-1 truncate">{emp.positionTitle}</p>
                    )}
                    <div className="mt-2 space-y-0.5">
                      {emp.email && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 truncate">
                          <Mail size={11} className="flex-shrink-0" />{emp.email}
                        </div>
                      )}
                      {emp.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Phone size={11} className="flex-shrink-0" />{emp.phone}
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-slate-300 group-hover:text-amber-500 transition-colors flex-shrink-0 mt-1" />
                </button>

                <div className="px-4 pb-3 flex items-center justify-end border-t border-slate-50 pt-2.5">
                  <button
                    onClick={() => handleToggle(emp)}
                    className={`flex items-center gap-1 text-xs font-medium transition-colors ${isActive ? 'text-green-600 hover:text-red-500' : 'text-slate-400 hover:text-green-600'}`}
                  >
                    {isActive ? <><ToggleRight size={16} /> Active</> : <><ToggleLeft size={16} /> Suspended</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
