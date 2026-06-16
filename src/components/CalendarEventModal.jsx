/**
 * CalendarEventModal — Create or edit a calendar entry.
 *
 * Props:
 *   initialDate        Date | string | null  — pre-fills the date field
 *   initialCustomerId  string | null
 *   initialJobId       string | null
 *   eventToEdit        object | null         — pass to edit an existing event
 *   onSave(event)      callback after save
 *   onClose()          callback to dismiss
 */

import { useState, useMemo } from 'react';
import AddressAutocomplete from './AddressAutocomplete';
import { toast } from './ToastContainer';
import { format, parseISO, addWeeks } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { X } from 'lucide-react';
import {
  getCustomers, getJobs, getMeasureSheets, getJob, getCustomer,
  getActiveInstallers, getActiveEmployees,
  saveCalendarEvent,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';

// ── Event type config ─────────────────────────────────────────────────────────
export const EVENT_TYPES = [
  { value: 'install',       label: 'Install',       icon: '🔧', dot: 'bg-blue-500',    pill: 'bg-blue-100 text-blue-700',      border: 'border-blue-400'    },
  { value: 'consult',       label: 'Consult',       icon: '💬', dot: 'bg-purple-500',  pill: 'bg-purple-100 text-purple-700',  border: 'border-purple-400'  },
  { value: 'measure',       label: 'Measure',       icon: '📐', dot: 'bg-teal-500',    pill: 'bg-teal-100 text-teal-700',      border: 'border-teal-400'    },
  { value: 'check_measure', label: 'Check Measure', icon: '✅', dot: 'bg-indigo-500',  pill: 'bg-indigo-100 text-indigo-700',  border: 'border-indigo-400'  },
  { value: 'service',       label: 'Service',       icon: '⚙️', dot: 'bg-orange-500',  pill: 'bg-orange-100 text-orange-700',  border: 'border-orange-400'  },
  { value: 'other',         label: 'Other',         icon: '📅', dot: 'bg-slate-400',   pill: 'bg-slate-100 text-slate-600',    border: 'border-slate-300'   },
];

export const EVENT_TYPE_MAP = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t]));

// ── Status options ────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'scheduled',   label: 'Scheduled'   },
  { value: 'completed',   label: 'Completed'   },
  { value: 'cancelled',   label: 'Cancelled'   },
  { value: 'rescheduled', label: 'Rescheduled' },
];

// ── Toggle component (reuse Dashboard pattern) ────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${on ? 'bg-amber-500' : 'bg-slate-200'}`}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toDateStr(dateOrStr) {
  if (!dateOrStr) return format(new Date(), 'yyyy-MM-dd');
  if (dateOrStr instanceof Date) return format(dateOrStr, 'yyyy-MM-dd');
  if (typeof dateOrStr === 'string' && dateOrStr.length === 10) return dateOrStr;
  try { return format(parseISO(dateOrStr), 'yyyy-MM-dd'); } catch { return format(new Date(), 'yyyy-MM-dd'); }
}

function toTimeStr(isoStr, fallback = '09:00') {
  if (!isoStr) return fallback;
  try { return format(parseISO(isoStr), 'HH:mm'); } catch { return fallback; }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CalendarEventModal({
  initialDate       = null,
  initialCustomerId = null,
  initialJobId      = null,
  eventToEdit       = null,
  onSave,
  onClose,
}) {
  const { displayName } = useProfile() || {};
  const isEdit = Boolean(eventToEdit);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [type,       setType]       = useState(eventToEdit?.eventType    || 'install');
  const [title,      setTitle]      = useState(eventToEdit?.title        || '');
  const [custId,     setCustId]     = useState(eventToEdit?.customerId   || initialCustomerId || '');
  const [jobId,      setJobId]      = useState(eventToEdit?.jobId        || initialJobId      || '');
  const [msId,       setMsId]       = useState(eventToEdit?.measureSheetId || '');
  const [assignedTo, setAssignedTo] = useState(eventToEdit?.assignedTo  || '');
  const [date,       setDate]       = useState(
    eventToEdit?.startAt ? toDateStr(eventToEdit.startAt) : toDateStr(initialDate)
  );
  const [startTime,  setStartTime]  = useState(toTimeStr(eventToEdit?.startAt, '09:00'));
  const [endTime,    setEndTime]    = useState(toTimeStr(eventToEdit?.endAt,   '11:00'));
  const [allDay,     setAllDay]     = useState(eventToEdit?.allDay   ?? false);
  const [location,   setLocation]   = useState(eventToEdit?.location ?? '');
  const [notes,      setNotes]      = useState(eventToEdit?.notes    ?? '');
  const [status,     setStatus]     = useState(eventToEdit?.status   || 'scheduled');
  const [saving,     setSaving]     = useState(false);
  const [errors,     setErrors]     = useState({});

  // ── Data for selectors ──────────────────────────────────────────────────────
  const customers = useMemo(() => getCustomers(), []);

  const jobs = useMemo(() => {
    const all = getJobs();
    return custId ? all.filter(j => j.customerId === custId) : all;
  }, [custId]);

  const measureSheets = useMemo(() => {
    const all = getMeasureSheets();
    if (jobId)  return all.filter(m => m.jobId === jobId);
    if (custId) return all.filter(m => m.customerId === custId);
    return all;
  }, [custId, jobId]);

  // Assignee options — filtered by event type
  const assigneeOptions = useMemo(() => {
    const employees  = getActiveEmployees();
    const installers = getActiveInstallers();

    if (type === 'install' || type === 'service') {
      const installerList = installers.map(i => ({
        id: i.id, name: i.name, role: 'Installer', source: 'installer',
      }));
      const installerEmpList = employees
        .filter(e => e.role === 'Installer' && !installers.find(i => i.email && i.email === e.email))
        .map(e => ({ id: e.id, name: e.fullName, role: e.role, source: 'employee' }));
      return [...installerList, ...installerEmpList];
    }
    if (type === 'measure' || type === 'check_measure') {
      return employees
        .filter(e => ['Measurer', 'Salesperson', 'Manager', 'Admin'].includes(e.role))
        .map(e => ({ id: e.id, name: e.fullName, role: e.role, source: 'employee' }));
    }
    if (type === 'consult') {
      return employees
        .filter(e => ['Salesperson', 'Manager', 'Admin', 'Office Staff'].includes(e.role))
        .map(e => ({ id: e.id, name: e.fullName, role: e.role, source: 'employee' }));
    }
    return employees.map(e => ({ id: e.id, name: e.fullName, role: e.role, source: 'employee' }));
  }, [type]);

  // Linked records for smart defaults
  const selectedJob  = useMemo(() => jobId  ? getJob(jobId)       : null, [jobId]);
  const selectedCust = useMemo(() => custId ? getCustomer(custId) : null, [custId]);

  // Auto-generate title placeholder
  const autoTitle = () => {
    const typeLabel = EVENT_TYPE_MAP[type]?.label || type;
    const name = selectedCust?.name || '';
    return name ? `${typeLabel} — ${name}` : typeLabel;
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleCustomerChange = (val) => {
    setCustId(val);
    setJobId('');
    setMsId('');
  };

  const handleJobChange = (val) => {
    setJobId(val);
    setMsId('');
    // Auto-fill customer from job
    if (val && !custId) {
      const job = getJob(val);
      if (job?.customerId) setCustId(job.customerId);
    }
    // Auto-fill location from job address
    if (val && !location) {
      const job = getJob(val);
      if (job?.address) setLocation(job.address);
    }
  };

  const handleFillAddress = () => {
    const addr = selectedJob?.address || selectedCust?.address;
    if (addr) setLocation(addr);
  };

  const validate = () => {
    const e = {};
    if (!date) e.date = 'Date is required';
    if (!allDay && startTime && endTime && endTime < startTime) {
      e.endTime = 'End time must be after start time';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    setSaving(true);

    const startAt = allDay
      ? `${date}T00:00:00.000Z`
      : `${date}T${startTime || '00:00'}:00`;
    const endAt = allDay
      ? `${date}T23:59:59.000Z`
      : (endTime ? `${date}T${endTime}:00` : null);

    const event = {
      id:              eventToEdit?.id || uuidv4(),
      title:           title.trim() || autoTitle(),
      eventType:       type,
      customerId:      custId      || null,
      jobId:           jobId       || null,
      measureSheetId:  msId        || null,
      assignedTo:      assignedTo  || null,
      assignees:       assignedTo ? [assignedTo] : [],
      startAt,
      endAt,
      allDay,
      location:        location.trim(),
      notes:           notes.trim(),
      status,
      createdBy:       eventToEdit?.createdBy || displayName || 'System',
      isDeleted:       false,
    };

    saveCalendarEvent(event, displayName);
    onSave?.(event);
    setSaving(false);
    toast(eventToEdit ? 'Calendar entry updated.' : 'Calendar entry added.');
    onClose();
  };

  const typeConfig = EVENT_TYPE_MAP[type];
  const addressSuggestion = selectedJob?.address || selectedCust?.address;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-bold text-slate-900 text-base">
            {isEdit ? 'Edit' : 'New'} Calendar Entry
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 space-y-5">

          {/* Event type selector — 2 cols on mobile, 3 cols on sm+ */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Entry Type</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {EVENT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { setType(t.value); setAssignedTo(''); }}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border-2 text-xs font-medium transition-all ${
                    type === t.value
                      ? `${t.border} ${t.pill}`
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-sm leading-none">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Title <span className="text-slate-300 font-normal normal-case">(optional — auto-generated if blank)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={autoTitle()}
              className="input-base"
            />
          </div>

          {/* Customer + Job */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Customer</label>
              <select value={custId} onChange={e => handleCustomerChange(e.target.value)} className="input-base">
                <option value="">— No customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Job</label>
              <select value={jobId} onChange={e => handleJobChange(e.target.value)} className="input-base">
                <option value="">— No job —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.jobNumber}</option>)}
              </select>
            </div>
          </div>

          {/* Measure sheet — only for measure/check_measure */}
          {(type === 'measure' || type === 'check_measure') && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Measure Sheet</label>
              <select value={msId} onChange={e => setMsId(e.target.value)} className="input-base">
                <option value="">— None —</option>
                {measureSheets.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.id.slice(-6)} {m.measureDate ? `· ${m.measureDate}` : ''} {selectedCust?.name ? `· ${selectedCust.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Assignee */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              {type === 'install' || type === 'service'       ? 'Assigned Installer'   :
               type === 'measure' || type === 'check_measure' ? 'Assigned Measurer'    :
               type === 'consult'                             ? 'Assigned Salesperson' :
               'Assigned To'}
            </label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="input-base">
              <option value="">— Unassigned —</option>
              {assigneeOptions.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className={`input-base max-w-full ${errors.date ? 'border-red-400' : ''}`}
            />
            {/* Quick-select shortcuts */}
            <div className="flex gap-2 mt-1.5">
              {[
                { label: '2 weeks', weeks: 2 },
                { label: '4 weeks', weeks: 4 },
              ].map(({ label, weeks }) => {
                const target = format(addWeeks(new Date(), weeks), 'yyyy-MM-dd');
                const active  = date === target;
                return (
                  <button
                    key={weeks}
                    type="button"
                    onClick={() => setDate(target)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                      active
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-600'
                    }`}
                  >
                    {label} · {format(addWeeks(new Date(), weeks), 'd MMM')}
                  </button>
                );
              })}
            </div>
            {errors.date && <p className="text-xs text-red-500 mt-1">{errors.date}</p>}
          </div>

          {/* All day toggle — its own row so it never overlaps the date input */}
          <div className="flex items-center justify-between py-0.5">
            <span className="text-sm font-medium text-slate-700">All day</span>
            <Toggle on={allDay} onChange={setAllDay} />
          </div>

          {/* Start / end time */}
          {!allDay && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="input-base max-w-full"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className={`input-base max-w-full ${errors.endTime ? 'border-red-400' : ''}`}
                />
                {errors.endTime && <p className="text-xs text-red-500 mt-1">{errors.endTime}</p>}
              </div>
            </div>
          )}

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Location</label>
            <AddressAutocomplete
              value={location}
              onChange={setLocation}
              placeholder="Start typing an address…"
              inputClassName="py-2"
            />
            {addressSuggestion && !location && (
              <button
                type="button"
                onClick={handleFillAddress}
                className="text-xs text-amber-600 hover:underline mt-1"
              >
                Use {selectedJob?.address ? 'job' : 'customer'} address: {addressSuggestion}
              </button>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Any notes for this entry..."
              className="input-base resize-none"
            />
          </div>

          {/* Status — show on edits or when not scheduled */}
          {(isEdit || status !== 'scheduled') && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className="input-base">
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="flex gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !date}
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
