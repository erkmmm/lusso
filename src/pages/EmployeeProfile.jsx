import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO, differenceInDays, isPast } from 'date-fns';
import {
  ArrowLeft, Edit3, Save, X, Mail, Phone, Building2, Briefcase,
  Calendar, UserCog, AlertTriangle, CheckCircle2, Clock, Plus,
  Trash2, ToggleLeft, ToggleRight, ChevronRight, Flag, User,
  ClipboardList, CheckSquare,
} from 'lucide-react';
import {
  getEmployee, saveEmployee, toggleEmployeeActive,
  getTasks, saveTask, deleteTask, completeTask,
  getJob, getCustomer, getCustomers, getJobs,
  EMPLOYEE_ROLES, EMPLOYMENT_TYPES, EMPLOYEE_DEPARTMENTS,
  EMPLOYEE_ROLE_COLORS, TASK_STATUSES, TASK_PRIORITIES,
  TASK_STATUS_COLORS, TASK_PRIORITY_COLORS,
} from '../store/data';
import { v4 as uuidv4 } from 'uuid';

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = {
  'Admin':        'bg-red-500',
  'Manager':      'bg-purple-500',
  'Office Staff': 'bg-blue-500',
  'Salesperson':  'bg-green-500',
  'Measurer':     'bg-amber-500',
  'Installer':    'bg-teal-500',
};

function Avatar({ name, role, size = 'lg' }) {
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  const bg = AVATAR_COLORS[role] || 'bg-slate-400';
  const sz = size === 'lg' ? 'w-16 h-16 text-2xl' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} ${bg} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function fmt(dateStr) {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'd MMM yyyy'); } catch { return dateStr; }
}

// ── Task Modal ────────────────────────────────────────────────────────────────
function TaskModal({ task, employeeId, onSave, onCancel }) {
  const isNew = !task?.id;
  const customers = getCustomers();
  const jobs      = getJobs();

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    customerId: task?.customerId || '',
    jobId: task?.jobId || '',
    assignedEmployeeId: task?.assignedEmployeeId || employeeId,
    dueDate: task?.dueDate || '',
    priority: task?.priority || 'Medium',
    status: task?.status || 'To Do',
    notes: task?.notes || '',
  });
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.title.trim()) { setErr('Title is required.'); return; }
    const now = new Date().toISOString();
    onSave({
      id: task?.id || uuidv4(),
      ...form,
      title: form.title.trim(),
      completedAt: (form.status === 'Completed' && !task?.completedAt) ? now : (task?.completedAt || null),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="font-bold text-slate-900 text-base">{isNew ? 'New Task' : 'Edit Task'}</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title <span className="text-red-400">*</span></label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Task title…" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              placeholder="Optional details…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Due Date</label>
            <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Related Customer</label>
              <select value={form.customerId} onChange={e => set('customerId', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">None</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Related Job</label>
              <select value={form.jobId} onChange={e => set('jobId', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">None</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.jobNumber}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              placeholder="Internal notes…" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {isNew ? 'Add Task' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task Row ──────────────────────────────────────────────────────────────────
function TaskRow({ task, onEdit, onComplete, onDelete, navigate }) {
  const isDone     = task.status === 'Completed' || task.status === 'Cancelled';
  const isOverdue  = task.dueDate && !isDone && isPast(parseISO(task.dueDate));
  const customer   = task.customerId ? getCustomer(task.customerId) : null;
  const job        = task.jobId      ? getJob(task.jobId)           : null;

  return (
    <div className={`flex items-start gap-3 p-4 border-b border-slate-50 last:border-0 ${isDone ? 'opacity-50' : ''}`}>
      {/* Complete toggle */}
      <button onClick={() => !isDone && onComplete(task.id)}
        className={`mt-0.5 flex-shrink-0 transition-colors ${isDone ? 'text-green-500' : 'text-slate-300 hover:text-green-500'}`}>
        {isDone ? <CheckSquare size={16} /> : <CheckSquare size={16} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className={`text-sm font-medium ${isDone ? 'line-through text-slate-400' : 'text-slate-800'}`}>
            {task.title}
          </span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${TASK_PRIORITY_COLORS[task.priority] || ''}`}>
            {task.priority}
          </span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${TASK_STATUS_COLORS[task.status] || ''}`}>
            {task.status}
          </span>
        </div>

        {task.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-slate-400">
          {task.dueDate && (
            <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
              <Clock size={11} />
              {isOverdue ? 'Overdue · ' : 'Due '}{fmt(task.dueDate)}
            </span>
          )}
          {customer && (
            <button onClick={() => navigate(`/customers/${customer.id}`)}
              className="flex items-center gap-1 hover:text-amber-600 transition-colors">
              <User size={11} />{customer.name}
            </button>
          )}
          {job && (
            <button onClick={() => navigate(`/jobs/${job.id}`)}
              className="flex items-center gap-1 hover:text-amber-600 transition-colors">
              <Briefcase size={11} />{job.jobNumber}
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => onEdit(task)}
          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
          <Edit3 size={13} />
        </button>
        <button onClick={() => onDelete(task.id)}
          className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EmployeeProfile() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [emp,     setEmp]     = useState(() => getEmployee(id));
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState(null);
  const [tab,     setTab]     = useState('details'); // 'details' | 'tasks'
  const [tasks,   setTasks]   = useState(() => getTasks().filter(t => t.assignedEmployeeId === id));
  const [taskModal, setTaskModal] = useState(null); // null | 'new' | task object
  const [toast,   setToast]   = useState(null);
  const [taskFilter, setTaskFilter] = useState('open'); // 'open' | 'all' | 'done'

  if (!emp) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Employee not found.</p>
        <button onClick={() => navigate('/employees')} className="mt-3 text-amber-600 hover:underline text-sm">
          ← Back to Employees
        </button>
      </div>
    );
  }

  const refreshTasks = () => setTasks(getTasks().filter(t => t.assignedEmployeeId === id));
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const startEdit = () => {
    setForm({ ...emp });
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setForm(null); };

  const saveEdit = () => {
    if (!form.firstName?.trim() || !form.lastName?.trim() || !form.email?.trim()) return;
    const updated = {
      ...form,
      firstName: form.firstName.trim(),
      lastName:  form.lastName.trim(),
      fullName:  `${form.firstName.trim()} ${form.lastName.trim()}`,
      email:     form.email.trim(),
    };
    saveEmployee(updated);
    setEmp(updated);
    setEditing(false);
    setForm(null);
    showToast('Employee profile saved.');
  };

  const handleToggleActive = () => {
    toggleEmployeeActive(id);
    const updated = { ...emp, isActive: !emp.isActive };
    setEmp(updated);
    showToast(`${emp.fullName} marked ${emp.isActive ? 'inactive' : 'active'}.`);
  };

  const handleSaveTask = (task) => {
    saveTask(task);
    refreshTasks();
    setTaskModal(null);
    showToast(taskModal === 'new' ? 'Task added.' : 'Task saved.');
  };

  const handleCompleteTask = (taskId) => {
    completeTask(taskId);
    refreshTasks();
    showToast('Task marked complete.');
  };

  const handleDeleteTask = (taskId) => {
    deleteTask(taskId);
    refreshTasks();
    showToast('Task deleted.');
  };

  const visibleTasks = useMemo(() => {
    const done = ['Completed', 'Cancelled'];
    return tasks.filter(t => {
      if (taskFilter === 'open') return !done.includes(t.status);
      if (taskFilter === 'done') return done.includes(t.status);
      return true;
    }).sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }, [tasks, taskFilter]);

  const openTasks   = tasks.filter(t => !['Completed','Cancelled'].includes(t.status)).length;
  const overdueTasks = tasks.filter(t => t.dueDate && !['Completed','Cancelled'].includes(t.status) && isPast(parseISO(t.dueDate))).length;

  // ── Edit field helpers ─────────────────────────────────────────────────────
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const EditInput = ({ label, k, type = 'text' }) => (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input type={type} value={form[k] || ''} onChange={e => setF(k, e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
    </div>
  );

  const EditSelect = ({ label, k, options }) => (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select value={form[k] || ''} onChange={e => setF(k, e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const InfoRow = ({ label, value, icon: Icon }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      {Icon && <Icon size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm text-slate-700 mt-0.5">{value || '—'}</p>
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-24">
      {/* Back */}
      <button onClick={() => navigate('/employees')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ArrowLeft size={15} /> Employees
      </button>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start gap-4">
          <Avatar name={emp.fullName} role={emp.role} size="lg" />

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{emp.fullName}</h1>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${EMPLOYEE_ROLE_COLORS[emp.role] || 'bg-slate-100 text-slate-600'}`}>
                {emp.role}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${emp.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {emp.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {emp.jobTitle && <p className="text-sm text-slate-500">{emp.jobTitle}</p>}
            {emp.department && <p className="text-xs text-slate-400 mt-0.5">{emp.department} · {emp.employmentType}</p>}

            {/* Task summary badges */}
            {(openTasks > 0 || overdueTasks > 0) && (
              <div className="flex gap-2 mt-2">
                {openTasks > 0 && (
                  <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                    {openTasks} open task{openTasks !== 1 ? 's' : ''}
                  </span>
                )}
                {overdueTasks > 0 && (
                  <span className="text-xs font-medium bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                    {overdueTasks} overdue
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={handleToggleActive}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                emp.isActive
                  ? 'border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                  : 'border-green-200 text-green-600 hover:bg-green-50'
              }`}>
              {emp.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {emp.isActive ? 'Deactivate' : 'Activate'}
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

      {/* Tabs */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 self-start w-fit">
        {[['details','Details'], ['tasks',`Tasks${openTasks > 0 ? ` (${openTasks})` : ''}`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === key ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Details tab ──────────────────────────────────────────────────────── */}
      {tab === 'details' && (
        <div className="grid sm:grid-cols-2 gap-5">

          {/* Employment details */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Briefcase size={14} className="text-amber-500" /> Employment
              </h2>
            </div>
            {editing ? (
              <div className="px-5 py-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <EditInput label="First Name" k="firstName" />
                  <EditInput label="Last Name"  k="lastName" />
                </div>
                <EditInput label="Job Title" k="jobTitle" />
                <EditSelect label="Role" k="role" options={EMPLOYEE_ROLES} />
                <EditSelect label="Department" k="department" options={EMPLOYEE_DEPARTMENTS} />
                <EditSelect label="Employment Type" k="employmentType" options={EMPLOYMENT_TYPES} />
                <div className="grid grid-cols-2 gap-3">
                  <EditInput label="Start Date" k="startDate" type="date" />
                  <EditInput label="End Date"   k="endDate"   type="date" />
                </div>
              </div>
            ) : (
              <div className="px-5 py-2">
                <InfoRow label="Job Title"       value={emp.jobTitle}       icon={Briefcase} />
                <InfoRow label="Role"            value={emp.role}            icon={UserCog} />
                <InfoRow label="Department"      value={emp.department}      icon={Building2} />
                <InfoRow label="Employment Type" value={emp.employmentType} />
                <InfoRow label="Start Date"      value={fmt(emp.startDate)} icon={Calendar} />
                {emp.endDate && <InfoRow label="End Date" value={fmt(emp.endDate)} />}
              </div>
            )}
          </div>

          {/* Contact details */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <User size={14} className="text-amber-500" /> Contact
              </h2>
            </div>
            {editing ? (
              <div className="px-5 py-4 space-y-3">
                <EditInput label="Email" k="email" type="email" />
                <EditInput label="Phone" k="phone" />
              </div>
            ) : (
              <div className="px-5 py-2">
                <InfoRow label="Email" value={emp.email} icon={Mail} />
                <InfoRow label="Phone" value={emp.phone} icon={Phone} />
              </div>
            )}

            <div className="px-5 py-4 border-t border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2 mb-3">
                <AlertTriangle size={14} className="text-amber-500" /> Emergency Contact
              </h2>
              {editing ? (
                <div className="space-y-3">
                  <EditInput label="Name"  k="emergencyContactName" />
                  <EditInput label="Phone" k="emergencyContactPhone" />
                </div>
              ) : (
                <>
                  <InfoRow label="Name"  value={emp.emergencyContactName} />
                  <InfoRow label="Phone" value={emp.emergencyContactPhone} />
                </>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm sm:col-span-2">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Notes</h2>
            </div>
            {editing ? (
              <div className="px-5 py-4">
                <textarea rows={4} value={form.notes || ''} onChange={e => setF('notes', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  placeholder="Internal notes about this employee…" />
              </div>
            ) : (
              <div className="px-5 py-4">
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{emp.notes || <span className="text-slate-400 italic">No notes.</span>}</p>
              </div>
            )}
          </div>

          {/* Edit action bar */}
          {editing && (
            <div className="sm:col-span-2 flex gap-3">
              <button onClick={cancelEdit}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
                <Save size={15} /> Save Changes
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tasks tab ────────────────────────────────────────────────────────── */}
      {tab === 'tasks' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <ClipboardList size={14} className="text-amber-500" /> Tasks
              {openTasks > 0 && (
                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{openTasks}</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {/* Task filter */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                {[['open','Open'],['all','All'],['done','Done']].map(([val, label]) => (
                  <button key={val} onClick={() => setTaskFilter(val)}
                    className={`px-2.5 py-1.5 font-medium transition-colors ${taskFilter === val ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={() => setTaskModal('new')}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                <Plus size={13} /> Add Task
              </button>
            </div>
          </div>

          {visibleTasks.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                {taskFilter === 'open' ? 'No open tasks.' : taskFilter === 'done' ? 'No completed tasks.' : 'No tasks yet.'}
              </p>
              {taskFilter === 'open' && (
                <button onClick={() => setTaskModal('new')}
                  className="mt-3 text-xs text-amber-600 hover:underline">Add a task</button>
              )}
            </div>
          ) : (
            <div>
              {visibleTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  navigate={navigate}
                  onEdit={t => setTaskModal(t)}
                  onComplete={handleCompleteTask}
                  onDelete={handleDeleteTask}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task modal */}
      {taskModal && (
        <TaskModal
          task={taskModal === 'new' ? null : taskModal}
          employeeId={id}
          onSave={handleSaveTask}
          onCancel={() => setTaskModal(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2">
          <CheckCircle2 size={15} className="text-green-400" /> {toast}
        </div>
      )}
    </div>
  );
}
