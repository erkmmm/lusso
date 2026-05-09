import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users2, Plus, Info, X, Shield, UserCheck, UserX, Edit2 } from 'lucide-react';
import {
  getProfiles, createProfile, saveProfile, deactivateProfile, reactivateProfile,
} from '../store/profiles';
import { useProfile } from '../contexts/UserProfileContext';
import Card from '../components/Card';

// ── Avatar ─────────────────────────────────────────────────────────────────────
function UserAvatar({ displayName, email, size = 'md' }) {
  const letter = (displayName || email || '?')[0].toUpperCase();
  const sz = size === 'lg' ? 'w-12 h-12 text-lg' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full bg-amber-500 flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {letter}
    </div>
  );
}

// ── Role badge ─────────────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  if (role === 'account_manager') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
        <Shield size={10} />
        Account Manager
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
      <UserCheck size={10} />
      Salesperson
    </span>
  );
}

// ── Add User Modal ─────────────────────────────────────────────────────────────
function AddUserModal({ onSave, onCancel }) {
  const [form, setForm] = useState({ displayName: '', email: '', role: 'salesperson' });
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!form.displayName.trim()) e.displayName = 'Display name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email';
    return e;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const e2 = validate();
    if (Object.keys(e2).length > 0) { setErrors(e2); return; }
    const profile = createProfile({
      email: form.email.trim().toLowerCase(),
      displayName: form.displayName.trim(),
      role: form.role,
    });
    onSave(profile);
  };

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add User</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-1 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
          <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            New team members should use the <strong>Create account</strong> tab on the login page to sign up with their work email and a password. Come back here to assign their role once they've signed up.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Display Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              {...field('displayName')}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.displayName ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
              placeholder="Jane Smith"
            />
            {errors.displayName && <p className="text-xs text-red-500 mt-0.5">{errors.displayName}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              {...field('email')}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.email ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
              placeholder="jane@example.com"
            />
            {errors.email && <p className="text-xs text-red-500 mt-0.5">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
            <select
              {...field('role')}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="salesperson">Salesperson</option>
              <option value="account_manager">Account Manager</option>
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel}
              className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors">
              Add User
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Role Modal ────────────────────────────────────────────────────────────
function EditRoleModal({ profile, onSave, onCancel }) {
  const [role, setRole] = useState(profile.role);

  const handleSubmit = (e) => {
    e.preventDefault();
    const updated = saveProfile({ ...profile, role });
    onSave(updated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Edit Role</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-1 rounded transition-colors">
            <X size={18} />
          </button>
        </div>
        <div>
          <p className="text-sm text-slate-500 mb-3">
            Changing role for <strong className="text-slate-700">{profile.displayName}</strong>
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="salesperson">Salesperson</option>
              <option value="account_manager">Account Manager</option>
            </select>
            <div className="flex gap-3">
              <button type="button" onClick={onCancel}
                className="flex-1 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button type="submit"
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors">
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── User Card ──────────────────────────────────────────────────────────────────
function UserCard({ profile, onDeactivate, onReactivate, onEditRole }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <UserAvatar displayName={profile.displayName} email={profile.email} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900 text-sm">{profile.displayName}</span>
            {!profile.active && (
              <span className="text-xs bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 font-medium">
                Inactive
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{profile.email}</p>
          <div className="mt-1.5">
            <RoleBadge role={profile.role} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onEditRole(profile)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 transition-colors"
            title="Edit role"
          >
            <Edit2 size={12} />
            Role
          </button>
          {profile.active ? (
            <button
              onClick={() => onDeactivate(profile.id)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <UserX size={12} />
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => onReactivate(profile.id)}
              className="flex items-center gap-1.5 text-xs text-green-600 hover:text-green-800 border border-green-200 hover:border-green-300 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <UserCheck size={12} />
              Reactivate
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Users Page ─────────────────────────────────────────────────────────────────
export default function Users() {
  const navigate = useNavigate();
  const { profile, isAM } = useProfile() || {};
  const [profiles, setProfiles] = useState(() => getProfiles());
  const [showAdd, setShowAdd] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);

  useEffect(() => {
    if (profile && !isAM) navigate('/');
  }, [profile, isAM, navigate]);

  const refresh = () => setProfiles(getProfiles());

  const handleAdd = (newProfile) => {
    setShowAdd(false);
    refresh();
  };

  const handleEditRole = (p) => setEditingProfile(p);

  const handleRoleSaved = () => {
    setEditingProfile(null);
    refresh();
  };

  const handleDeactivate = (id) => {
    deactivateProfile(id);
    refresh();
  };

  const handleReactivate = (id) => {
    reactivateProfile(id);
    refresh();
  };

  const activeProfiles   = profiles.filter(p => p.active);
  const inactiveProfiles = profiles.filter(p => !p.active);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <Users2 size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Users</h1>
            <p className="text-slate-500 text-sm mt-0.5">Manage team access and roles</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
        >
          <Plus size={16} />
          Add User
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-700">
          New users should use <strong>Forgot Password</strong> on the login page to set their password.
          Once signed up, search for their name here and assign their role.
        </p>
      </div>

      {/* Active users */}
      <div>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Active Users ({activeProfiles.length})
        </h2>
        {activeProfiles.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-slate-400 text-sm">No active users yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {activeProfiles.map(p => (
              <UserCard
                key={p.id}
                profile={p}
                onDeactivate={handleDeactivate}
                onReactivate={handleReactivate}
                onEditRole={handleEditRole}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inactive users */}
      {inactiveProfiles.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Inactive Users ({inactiveProfiles.length})
          </h2>
          <div className="space-y-3">
            {inactiveProfiles.map(p => (
              <UserCard
                key={p.id}
                profile={p}
                onDeactivate={handleDeactivate}
                onReactivate={handleReactivate}
                onEditRole={handleEditRole}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAdd && <AddUserModal onSave={handleAdd} onCancel={() => setShowAdd(false)} />}
      {editingProfile && (
        <EditRoleModal
          profile={editingProfile}
          onSave={handleRoleSaved}
          onCancel={() => setEditingProfile(null)}
        />
      )}
    </div>
  );
}
