import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users2, Plus, X, Shield, UserCheck, UserX, Clock,
  CheckCircle2, AlertTriangle, Edit2, Phone, Briefcase, Info,
} from 'lucide-react';
import {
  getProfiles, saveProfile,
  fetchProfilesFromSupabase, fetchEmployeesFromSupabase,
  createProfileInSupabase, updateEmployeeProfile,
  approveUser, suspendUser, reactivateUser,
} from '../store/profiles';
import { useProfile } from '../contexts/UserProfileContext';
import Card from '../components/Card';

// ── Label maps ────────────────────────────────────────────────────────────────
const ACCOUNT_TYPE_LABELS = {
  account_manager: 'Account Manager',
  standard_user:   'Standard User',
  pending_user:    'Pending',
};

const EMPLOYEE_ROLE_LABELS = {
  salesperson:     'Salesperson',
  installer:       'Installer',
  account_manager: 'Account Manager',
};

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, email, size = 'md' }) {
  const letter = (name || email || '?')[0].toUpperCase();
  const sz = size === 'lg' ? 'w-12 h-12 text-lg' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full bg-amber-500 flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {letter}
    </div>
  );
}

// ── Account type badge ────────────────────────────────────────────────────────
function AccountTypeBadge({ accountType }) {
  if (accountType === 'account_manager') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
      <Shield size={10} /> Account Manager
    </span>
  );
  if (accountType === 'standard_user') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
      <UserCheck size={10} /> Standard User
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-orange-50 text-orange-600 border border-orange-200 rounded-full px-2 py-0.5">
      <Clock size={10} /> Pending
    </span>
  );
}

// ── Employee role badge ───────────────────────────────────────────────────────
function EmployeeRoleBadge({ employeeRole }) {
  if (!employeeRole) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5">
      {EMPLOYEE_ROLE_LABELS[employeeRole] || employeeRole}
    </span>
  );
}

// ── Approve Modal ─────────────────────────────────────────────────────────────
function ApproveModal({ profile, onSave, onCancel }) {
  const [accountType,  setAccountType]  = useState('standard_user');
  const [employeeRole, setEmployeeRole] = useState('salesperson');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      // approve_user sets account_type, status=active, is_employee=true
      await approveUser(profile.id, accountType);
      // Set employee role separately if needed
      if (employeeRole) {
        await updateEmployeeProfile(profile.id, { employeeRole });
      }
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to approve.');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Approve & Activate</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-amber-800">{profile.displayName || profile.email}</p>
          <p className="text-xs text-amber-600">{profile.email}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Account Type</label>
            <select value={accountType} onChange={e => setAccountType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="standard_user">Standard User — own records only</option>
              <option value="account_manager">Account Manager — full access</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Controls login access level.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Employee Role</label>
            <select value={employeeRole} onChange={e => setEmployeeRole(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">— Not assigned yet —</option>
              <option value="salesperson">Salesperson</option>
              <option value="installer">Installer</option>
              <option value="account_manager">Account Manager</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Controls job function and assignment dropdowns.</p>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex gap-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onCancel}
              className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors flex items-center justify-center gap-1.5">
              <CheckCircle2 size={14} />
              {loading ? 'Approving…' : 'Approve & Add to Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Employee Modal ────────────────────────────────────────────────────────
function EditEmployeeModal({ employee, onSave, onCancel }) {
  const [form, setForm] = useState({
    displayName:   employee.displayName   || '',
    accountType:   employee.accountType   || 'standard_user',
    employeeRole:  employee.employeeRole  || '',
    phone:         employee.phone         || '',
    positionTitle: employee.positionTitle || '',
    status:        employee.status        || 'active',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await updateEmployeeProfile(employee.id, {
        displayName:   form.displayName,
        accountType:   form.accountType,
        employeeRole:  form.employeeRole || null,
        phone:         form.phone,
        positionTitle: form.positionTitle,
        status:        form.status,
      });
      saveProfile({ ...employee, ...form });
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to update.');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Edit Team Member</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Full Name</label>
              <input value={form.displayName} onChange={set('displayName')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Account Type</label>
              <select value={form.accountType} onChange={set('accountType')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="standard_user">Standard User</option>
                <option value="account_manager">Account Manager</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Employee Role</label>
              <select value={form.employeeRole} onChange={set('employeeRole')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">— Not assigned —</option>
                <option value="salesperson">Salesperson</option>
                <option value="installer">Installer</option>
                <option value="account_manager">Account Manager</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Access Status</label>
              <select value={form.status} onChange={set('status')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
              <input value={form.phone} onChange={set('phone')} placeholder="04xx xxx xxx"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Position Title</label>
              <input value={form.positionTitle} onChange={set('positionTitle')} placeholder="e.g. Senior Salesperson"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex gap-2">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel}
              className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors">
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Employee card ─────────────────────────────────────────────────────────────
function EmployeeCard({ emp, onEdit, onSuspend, onReactivate }) {
  const isSuspended    = emp.status === 'suspended';
  const needsOnboarding = emp.isEmployee && !emp.employeeProfileCompleted;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar name={emp.displayName} email={emp.email} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900 text-sm">{emp.displayName || emp.email}</span>
            {isSuspended && (
              <span className="text-xs bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 font-medium">Suspended</span>
            )}
            {needsOnboarding && !isSuspended && (
              <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5 font-medium">Onboarding pending</span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">{emp.email}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <AccountTypeBadge accountType={emp.accountType} />
            <EmployeeRoleBadge employeeRole={emp.employeeRole} />
            {emp.positionTitle && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Briefcase size={10} /> {emp.positionTitle}
              </span>
            )}
            {emp.phone && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Phone size={10} /> {emp.phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => onEdit(emp)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 transition-colors">
            <Edit2 size={12} /> Edit
          </button>
          {isSuspended ? (
            <button onClick={() => onReactivate(emp.id)}
              className="flex items-center gap-1.5 text-xs text-green-600 hover:text-green-800 border border-green-200 hover:border-green-300 rounded-lg px-2.5 py-1.5 transition-colors">
              <UserCheck size={12} /> Restore
            </button>
          ) : (
            <button onClick={() => onSuspend(emp.id)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg px-2.5 py-1.5 transition-colors">
              <UserX size={12} /> Suspend
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Add User Modal ────────────────────────────────────────────────────────────
function AddUserModal({ onSave, onCancel }) {
  const [form,   setForm]   = useState({ displayName: '', email: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.displayName.trim()) e.displayName = 'Name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    const { profile } = await createProfileInSupabase({
      email:       form.email.trim().toLowerCase(),
      displayName: form.displayName.trim(),
      accountType: 'pending_user', // all new users start as pending
    });
    setLoading(false);
    onSave(profile);
  };

  const field = (k) => ({ value: form[k], onChange: (e) => setForm(f => ({ ...f, [k]: e.target.value })) });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Team Member</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
          <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            New team members should use the <strong>Create account</strong> tab on the login page.
            Their profile appears here automatically — then approve and assign their role.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input type="text" {...field('displayName')} placeholder="Jane Smith"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.displayName ? 'border-red-400' : 'border-slate-200'}`} />
            {errors.displayName && <p className="text-xs text-red-500 mt-0.5">{errors.displayName}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email <span className="text-red-400">*</span></label>
            <input type="email" {...field('email')} placeholder="jane@lusso.com.au"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.email ? 'border-red-400' : 'border-slate-200'}`} />
            {errors.email && <p className="text-xs text-red-500 mt-0.5">{errors.email}</p>}
          </div>
          <p className="text-xs text-slate-400">
            New users are added as <strong>Pending</strong> and must be approved before they can access the app.
          </p>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel}
              className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors">
              {loading ? 'Adding…' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Users() {
  const navigate = useNavigate();
  const { profile: currentProfile, isAM } = useProfile() || {};

  const [tab,               setTab]               = useState('team');
  const [pendingList,       setPendingList]       = useState([]);
  const [teamList,          setTeamList]          = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [showAdd,           setShowAdd]           = useState(false);
  const [approvingProfile,  setApprovingProfile]  = useState(null);
  const [editingEmployee,   setEditingEmployee]   = useState(null);

  useEffect(() => {
    if (currentProfile && !isAM) navigate('/');
  }, [currentProfile, isAM, navigate]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const all  = await fetchProfilesFromSupabase();
    const team = await fetchEmployeesFromSupabase();
    // Pending = account_type is pending_user OR status is pending (transition-safe)
    setPendingList(all.filter(p =>
      p.accountType === 'pending_user' ||
      p.accountType === 'pending'      || // legacy
      p.role        === 'pending'      || // legacy
      p.role        === 'pending_user' || // legacy
      p.status      === 'pending'
    ));
    setTeamList(team);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAM) refresh(); }, [isAM, refresh]);

  useEffect(() => {
    if (pendingList.length > 0 && tab === 'team') setTab('pending');
  }, [pendingList.length]);

  const handleApproved   = async () => { setApprovingProfile(null); await refresh(); };
  const handleEditSaved  = async () => { setEditingEmployee(null);  await refresh(); };

  const handleSuspend    = async (id) => { await suspendUser(id);    await refresh(); };
  const handleReactivate = async (id) => { await reactivateUser(id); await refresh(); };

  const activeTeam    = teamList.filter(e => e.status === 'active');
  const suspendedTeam = teamList.filter(e => e.status === 'suspended');

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-24">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <Users2 size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Users & Team</h1>
            <p className="text-slate-500 text-sm mt-0.5">Manage access, roles, and employee profiles</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors">
          <Plus size={16} /> Add User
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('pending')}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
            tab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <Clock size={14} />
          Pending
          {pendingList.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
              {pendingList.length}
            </span>
          )}
        </button>
        <button onClick={() => setTab('team')}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
            tab === 'team' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <UserCheck size={14} />
          Team Members
          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
            {activeTeam.length}
          </span>
        </button>
      </div>

      {loading && <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>}

      {/* ── PENDING TAB ── */}
      {!loading && tab === 'pending' && (
        <div className="space-y-3">
          {pendingList.length === 0 ? (
            <Card className="p-10 text-center">
              <CheckCircle2 size={32} className="text-green-400 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No pending signups — you're all caught up.</p>
            </Card>
          ) : (
            pendingList.map(p => (
              <Card key={p.id} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <Clock size={18} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{p.displayName || p.email}</p>
                    <p className="text-xs text-slate-500">{p.email}</p>
                    <p className="text-xs text-amber-600 mt-0.5">Awaiting approval · no CRM access yet</p>
                  </div>
                  <button onClick={() => setApprovingProfile(p)}
                    className="flex items-center gap-1.5 text-xs bg-green-500 hover:bg-green-400 text-white font-medium rounded-lg px-3 py-1.5 transition-colors flex-shrink-0">
                    <CheckCircle2 size={12} /> Approve
                  </button>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── TEAM TAB ── */}
      {!loading && tab === 'team' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Active ({activeTeam.length})
            </h2>
            {activeTeam.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-slate-400 text-sm">No active team members yet. Approve a pending user to add them.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {activeTeam.map(emp => (
                  <EmployeeCard key={emp.id} emp={emp}
                    onEdit={setEditingEmployee}
                    onSuspend={handleSuspend}
                    onReactivate={handleReactivate}
                  />
                ))}
              </div>
            )}
          </div>

          {suspendedTeam.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Suspended ({suspendedTeam.length})
              </h2>
              <div className="space-y-2">
                {suspendedTeam.map(emp => (
                  <EmployeeCard key={emp.id} emp={emp}
                    onEdit={setEditingEmployee}
                    onSuspend={handleSuspend}
                    onReactivate={handleReactivate}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAdd          && <AddUserModal       onSave={() => { setShowAdd(false); refresh(); }} onCancel={() => setShowAdd(false)} />}
      {approvingProfile && <ApproveModal       profile={approvingProfile} onSave={handleApproved}  onCancel={() => setApprovingProfile(null)} />}
      {editingEmployee  && <EditEmployeeModal  employee={editingEmployee} onSave={handleEditSaved} onCancel={() => setEditingEmployee(null)} />}
    </div>
  );
}
