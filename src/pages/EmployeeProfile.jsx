import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Edit3, Save, X, Mail, Phone, Briefcase,
  UserCog, AlertTriangle, CheckCircle2, MapPin,
  ToggleLeft, ToggleRight, User, Shield,
} from 'lucide-react';
import BackButton from '../components/BackButton';
import {
  getEmployeeByIdFromSupabase, updateEmployeeProfile,
  suspendUser, reactivateUser,
} from '../store/profiles';

// ── Label maps ────────────────────────────────────────────────────────────────
const ACCOUNT_TYPE_LABELS = {
  account_manager: 'Account Manager',
  standard_user:   'Standard User',
};
const ACCOUNT_TYPE_COLORS = {
  account_manager: 'bg-amber-100 text-amber-700',
  standard_user:   'bg-slate-100 text-slate-600',
};
const EMPLOYEE_ROLE_LABELS = {
  salesperson:     'Salesperson',
  installer:       'Installer',
  account_manager: 'Account Manager',
};
const EMPLOYEE_ROLE_COLORS = {
  salesperson:     'bg-teal-100 text-teal-700',
  installer:       'bg-blue-100 text-blue-700',
  account_manager: 'bg-amber-100 text-amber-700',
};

// ── Sub-components ────────────────────────────────────────────────────────────
function Avatar({ name }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  return (
    <div className="w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-2xl flex-shrink-0">
      {initials}
    </div>
  );
}

function InfoRow({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      {Icon && <Icon size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm text-slate-700 mt-0.5">{value || '—'}</p>
      </div>
    </div>
  );
}

function EditInput({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
    </div>
  );
}

function EditSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EmployeeProfile() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [emp,     setEmp]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const [error,   setError]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getEmployeeByIdFromSupabase(id);
    setEmp(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-center text-slate-400 text-sm animate-pulse">Loading…</div>;

  if (!emp) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Employee not found.</p>
        <BackButton fallback="/employees" className="mt-3" />
      </div>
    );
  }

  const isActive = emp.status === 'active';

  const startEdit = () => {
    setForm({ ...emp, employeeRole: emp.employeeRole || '', accountType: emp.accountType || 'standard_user' });
    setEditing(true);
    setError('');
  };

  const cancelEdit = () => { setEditing(false); setForm(null); setError(''); };

  const setF = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  const saveEdit = async () => {
    if (!form.displayName?.trim()) { setError('Full name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await updateEmployeeProfile(emp.id, {
        displayName:           form.displayName.trim(),
        accountType:           form.accountType,
        employeeRole:          form.employeeRole || null,
        phone:                 form.phone,
        positionTitle:         form.positionTitle,
        address:               form.address,
        emergencyContactName:  form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        status:                form.status,
      });
      await load();
      setEditing(false);
      setForm(null);
      showToast('Profile saved.');
    } catch (err) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    try {
      if (isActive) await suspendUser(emp.id);
      else           await reactivateUser(emp.id);
      await load();
      showToast(`${emp.displayName} ${isActive ? 'suspended' : 'reactivated'}.`);
    } catch {
      showToast('Failed to update status.');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-24">

      {/* Back */}
      <BackButton fallback="/employees" />

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start gap-4">
          <Avatar name={emp.displayName} />

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{emp.displayName || emp.email}</h1>
              {/* Account type badge */}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACCOUNT_TYPE_COLORS[emp.accountType] || 'bg-slate-100 text-slate-600'}`}>
                {ACCOUNT_TYPE_LABELS[emp.accountType] || emp.accountType || '—'}
              </span>
              {/* Employee role badge */}
              {emp.employeeRole && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${EMPLOYEE_ROLE_COLORS[emp.employeeRole] || 'bg-slate-100 text-slate-600'}`}>
                  {EMPLOYEE_ROLE_LABELS[emp.employeeRole] || emp.employeeRole}
                </span>
              )}
              {/* Status badge */}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {isActive ? 'Active' : 'Suspended'}
              </span>
            </div>
            {emp.positionTitle && <p className="text-sm text-slate-500">{emp.positionTitle}</p>}
            <p className="text-xs text-slate-400 mt-0.5">{emp.email}</p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={handleToggleActive}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                isActive
                  ? 'border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                  : 'border-green-200 text-green-600 hover:bg-green-50'
              }`}>
              {isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {isActive ? 'Suspend' : 'Reactivate'}
            </button>
            {!editing && (
              <button onClick={startEdit}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                <Edit3 size={14} /> Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Detail cards */}
      <div className="grid sm:grid-cols-2 gap-5">

        {/* Role & Position */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <Shield size={14} className="text-amber-500" /> Role & Position
            </h2>
          </div>
          {editing ? (
            <div className="px-5 py-4 space-y-3">
              <EditInput label="Full Name" value={form.displayName} onChange={setF('displayName')} />
              <EditInput label="Position Title" value={form.positionTitle} onChange={setF('positionTitle')} />
              <EditSelect label="Account Type" value={form.accountType} onChange={setF('accountType')}
                options={[
                  ['standard_user',   'Standard User'],
                  ['account_manager', 'Account Manager'],
                ]} />
              <EditSelect label="Employee Role" value={form.employeeRole || ''} onChange={setF('employeeRole')}
                options={[
                  ['',                '— Not assigned —'],
                  ['salesperson',     'Salesperson'],
                  ['installer',       'Installer'],
                  ['account_manager', 'Account Manager'],
                ]} />
              <EditSelect label="Status" value={form.status} onChange={setF('status')}
                options={[
                  ['active',    'Active'],
                  ['suspended', 'Suspended'],
                ]} />
            </div>
          ) : (
            <div className="px-5 py-2">
              <InfoRow label="Full Name"      value={emp.displayName}                                              icon={User} />
              <InfoRow label="Position Title" value={emp.positionTitle}                                           icon={Briefcase} />
              <InfoRow label="Account Type"   value={ACCOUNT_TYPE_LABELS[emp.accountType]   || emp.accountType}  icon={UserCog} />
              <InfoRow label="Employee Role"  value={EMPLOYEE_ROLE_LABELS[emp.employeeRole] || '— Not assigned'} icon={Shield} />
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <User size={14} className="text-amber-500" /> Contact
            </h2>
          </div>
          {editing ? (
            <div className="px-5 py-4 space-y-3">
              <EditInput label="Phone"   value={form.phone}   onChange={setF('phone')}   type="tel" />
              <EditInput label="Address" value={form.address} onChange={setF('address')} />
            </div>
          ) : (
            <div className="px-5 py-2">
              <InfoRow label="Email"   value={emp.email}   icon={Mail} />
              <InfoRow label="Phone"   value={emp.phone}   icon={Phone} />
              <InfoRow label="Address" value={emp.address} icon={MapPin} />
            </div>
          )}
        </div>

        {/* Emergency Contact */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm sm:col-span-2">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" /> Emergency Contact
            </h2>
          </div>
          {editing ? (
            <div className="px-5 py-4 grid sm:grid-cols-2 gap-3">
              <EditInput label="Name"  value={form.emergencyContactName}  onChange={setF('emergencyContactName')} />
              <EditInput label="Phone" value={form.emergencyContactPhone} onChange={setF('emergencyContactPhone')} type="tel" />
            </div>
          ) : (
            <div className="px-5 py-2 grid sm:grid-cols-2">
              <InfoRow label="Name"  value={emp.emergencyContactName} />
              <InfoRow label="Phone" value={emp.emergencyContactPhone} icon={Phone} />
            </div>
          )}
        </div>

        {/* Edit action bar */}
        {editing && (
          <div className="sm:col-span-2 space-y-2">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2 text-red-700 text-sm">
                <AlertTriangle size={14} className="flex-shrink-0" /> {error}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={cancelEdit}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
                <Save size={15} /> {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2">
          <CheckCircle2 size={15} className="text-green-400" /> {toast}
        </div>
      )}
    </div>
  );
}
