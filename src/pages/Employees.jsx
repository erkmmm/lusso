import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserCog, Plus, Search, X, Users, Mail, Phone,
  CheckSquare, Square, ToggleLeft, ToggleRight, ChevronRight,
} from 'lucide-react';
import {
  getEmployees, saveEmployee, toggleEmployeeActive,
  EMPLOYEE_ROLES, EMPLOYEE_DEPARTMENTS, EMPLOYMENT_TYPES,
  EMPLOYEE_ROLE_COLORS,
} from '../store/data';
import { v4 as uuidv4 } from 'uuid';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

// ── Role avatar colour ────────────────────────────────────────────────────────
const AVATAR_COLORS = {
  'Admin':        'bg-red-500',
  'Manager':      'bg-purple-500',
  'Office Staff': 'bg-blue-500',
  'Salesperson':  'bg-green-500',
  'Measurer':     'bg-amber-500',
  'Installer':    'bg-teal-500',
};

function Avatar({ name, role, size = 'md' }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  const bg = AVATAR_COLORS[role] || 'bg-slate-400';
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} ${bg} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ── Add Employee Modal ─────────────────────────────────────────────────────────
function AddEmployeeModal({ onSave, onCancel }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    jobTitle: '', role: 'Office Staff', department: 'Office',
    employmentType: 'Full-time', startDate: '', endDate: '',
    emergencyContactName: '', emergencyContactPhone: '', notes: '',
  });
  const [errors, setErrors] = useState({});

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim())  e.lastName  = 'Required';
    if (!form.email.trim())     e.email     = 'Required';
    if (!form.role)             e.role      = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const now = new Date().toISOString();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    onSave({
      id: uuidv4(),
      ...form,
      firstName: form.firstName.trim(),
      lastName:  form.lastName.trim(),
      fullName,
      email:  form.email.trim(),
      phone:  form.phone.trim(),
      isActive: true,
      createdAt: now, updatedAt: now,
    });
  };

  const Field = ({ label, k, type = 'text', required, children }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children || (
        <input
          type={type}
          value={form[k]}
          onChange={e => set(k, e.target.value)}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors[k] ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
        />
      )}
      {errors[k] && <p className="text-xs text-red-500 mt-0.5">{errors[k]}</p>}
    </div>
  );

  const Select = ({ label, k, options, required }) => (
    <Field label={label} k={k} required={required}>
      <select
        value={form[k]}
        onChange={e => set(k, e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white ${errors[k] ? 'border-red-400' : 'border-slate-200'}`}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-bold text-slate-900 text-base">Add Employee</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name" k="firstName" required />
            <Field label="Last Name"  k="lastName"  required />
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" k="email" type="email" required />
            <Field label="Phone" k="phone" />
          </div>

          {/* Role & title */}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Role" k="role" options={EMPLOYEE_ROLES} required />
            <Field label="Job Title" k="jobTitle" />
          </div>

          {/* Dept & type */}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Department"      k="department"     options={EMPLOYEE_DEPARTMENTS} />
            <Select label="Employment Type" k="employmentType" options={EMPLOYMENT_TYPES} />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Date" k="startDate" type="date" />
            <Field label="End Date"   k="endDate"   type="date" />
          </div>

          {/* Emergency contact */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Emergency Contact</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact Name"  k="emergencyContactName" />
              <Field label="Contact Phone" k="emergencyContactPhone" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              placeholder="Optional notes…"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            Add Employee
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Employees() {
  const navigate = useNavigate();
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'all' | 'active' | 'inactive'
  const [showAdd,    setShowAdd]    = useState(false);
  const [employees,  setEmployees]  = useState(getEmployees);
  const [toast,      setToast]      = useState(null);

  const refresh = () => setEmployees(getEmployees());

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return employees.filter(e => {
      if (statusFilter === 'active'   && !e.isActive) return false;
      if (statusFilter === 'inactive' &&  e.isActive) return false;
      if (roleFilter && e.role !== roleFilter) return false;
      if (deptFilter && e.department !== deptFilter) return false;
      if (term && !`${e.fullName} ${e.email} ${e.jobTitle} ${e.role} ${e.department}`.toLowerCase().includes(term)) return false;
      return true;
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [employees, search, roleFilter, deptFilter, statusFilter]);

  const handleAdd = (emp) => {
    saveEmployee(emp);
    refresh();
    setShowAdd(false);
    showToast(`${emp.fullName} added successfully.`);
  };

  const handleToggle = (id, name, isActive) => {
    toggleEmployeeActive(id);
    refresh();
    showToast(`${name} marked ${isActive ? 'inactive' : 'active'}.`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Employees</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
            {statusFilter === 'active' ? ' active' : statusFilter === 'inactive' ? ' inactive' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors self-start"
        >
          <Plus size={16} /> Add Employee
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Search */}
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

        {/* Role filter */}
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">All roles</option>
          {EMPLOYEE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* Dept filter */}
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">All departments</option>
          {EMPLOYEE_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Status toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white text-sm">
          {[['active','Active'],['all','All'],['inactive','Inactive']].map(([val, label]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              className={`px-3 py-2 font-medium transition-colors ${statusFilter === val ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Employee grid */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={UserCog}
            title="No employees found"
            description={search || roleFilter || deptFilter ? 'Try adjusting your filters.' : 'Add your first team member to get started.'}
            action={!search && !roleFilter && !deptFilter && (
              <button onClick={() => setShowAdd(true)}
                className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Add Employee
              </button>
            )}
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(emp => (
            <div
              key={emp.id}
              className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all group ${emp.isActive ? 'border-slate-200 hover:border-slate-300' : 'border-slate-100 opacity-70'}`}
            >
              {/* Card body — navigate on click */}
              <button
                onClick={() => navigate(`/employees/${emp.id}`)}
                className="w-full text-left p-4 flex items-start gap-3"
              >
                <Avatar name={emp.fullName} role={emp.role} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-800 truncate">{emp.fullName}</span>
                    {!emp.isActive && (
                      <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${EMPLOYEE_ROLE_COLORS[emp.role] || 'bg-slate-100 text-slate-600'}`}>
                      {emp.role}
                    </span>
                    {emp.department && (
                      <span className="text-xs text-slate-400">{emp.department}</span>
                    )}
                  </div>
                  {emp.jobTitle && (
                    <p className="text-xs text-slate-500 mt-1 truncate">{emp.jobTitle}</p>
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

              {/* Card footer */}
              <div className="px-4 pb-3 flex items-center justify-between border-t border-slate-50 pt-2.5">
                <span className="text-xs text-slate-400">
                  {emp.employmentType || 'Employee'}
                </span>
                <button
                  onClick={() => handleToggle(emp.id, emp.fullName, emp.isActive)}
                  className={`flex items-center gap-1 text-xs font-medium transition-colors ${emp.isActive ? 'text-green-600 hover:text-red-500' : 'text-slate-400 hover:text-green-600'}`}
                  title={emp.isActive ? 'Mark inactive' : 'Mark active'}
                >
                  {emp.isActive
                    ? <><ToggleRight size={16} /> Active</>
                    : <><ToggleLeft  size={16} /> Inactive</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add modal */}
      {showAdd && <AddEmployeeModal onSave={handleAdd} onCancel={() => setShowAdd(false)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
