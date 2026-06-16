import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, addWeeks, subWeeks,
  isSameMonth, isSameDay, isToday, parseISO, eachDayOfInterval,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, HardHat,
  CheckCircle2, Clock, X, AlertTriangle, Filter, Package,
  Trash2, ExternalLink, Plus, MapPin, User, Edit3,
} from 'lucide-react';
import {
  getInstallRequests, getInstallers, getJobs, getCustomers,
  getInstaller, getJob, getCustomer, INSTALL_REQUEST_STATUS_COLORS,
  getCalendarEvents, getCalendarEvent, saveCalendarEvent, deleteCalendarEvent,
  deleteJob,
} from '../store/data';
import CalendarEventModal, { EVENT_TYPES, EVENT_TYPE_MAP } from '../components/CalendarEventModal';
import { useProfile } from '../contexts/UserProfileContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
const pickupBadge = (req) => {
  const t = req.pickupType || '';
  if (t === 'Pickup from Lusso warehouse')     return { label: 'Lusso WH',     cls: 'bg-purple-100 text-purple-700' };
  if (t === 'Pickup from one supplier')         return { label: 'Supplier',      cls: 'bg-purple-100 text-purple-700' };
  if (t === 'Pickup from multiple suppliers')   return { label: `${req.pickupLocations?.length || ''}× Pickups`, cls: 'bg-purple-100 text-purple-700' };
  if (t === 'Products already onsite')          return { label: 'Onsite',        cls: 'bg-teal-100 text-teal-700' };
  if (t === 'Service-only job')                 return { label: 'Service Only',  cls: 'bg-slate-100 text-slate-600' };
  return null;
};

const STATUS_DOT = {
  Accepted:    'bg-green-500',
  Sent:        'bg-blue-500',
  Declined:    'bg-red-400',
  Draft:       'bg-slate-400',
  Completed:   'bg-teal-500',
  Rescheduled: 'bg-amber-500',
  Cancelled:   'bg-slate-300',
  Expired:     'bg-orange-400',
  scheduled:   'bg-blue-400',
  completed:   'bg-teal-500',
  cancelled:   'bg-slate-300',
  rescheduled: 'bg-amber-500',
};

const VIEW_MODES = ['Month', 'Week', 'List'];

// ── Main component ────────────────────────────────────────────────────────────
export default function InstallationCalendar() {
  useDataRefresh();
  const navigate = useNavigate();
  const { displayName } = useProfile() || {};

  const [current, setCurrent]   = useState(new Date());
  const [view, setView]         = useState('Month');
  const [filterInstaller, setFilterInstaller] = useState('');
  const [filterStatus,    setFilterStatus]    = useState('');
  const [filterType,      setFilterType]      = useState(''); // 'installs' | 'events' | ''

  // Modal / selection state
  const [selectedInstall,  setSelectedInstall]  = useState(null);
  const [selectedCalEvent, setSelectedCalEvent] = useState(null);
  const [showNewEventModal, setShowNewEventModal] = useState(false);
  const [newEventDate,      setNewEventDate]      = useState(null);
  const [editingEvent,      setEditingEvent]      = useState(null);
  const [showDeleteInstall, setShowDeleteInstall] = useState(false);
  const [showDeleteCal,     setShowDeleteCal]     = useState(false);

  // Refresh trigger
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener('lusso:data-changed', refresh);
    return () => window.removeEventListener('lusso:data-changed', refresh);
  }, []);

  const installRequests = useMemo(() => getInstallRequests(),  [tick]);
  const calendarEvents  = useMemo(() => getCalendarEvents(),   [tick]);
  const installers      = useMemo(() => getInstallers(),       [tick]);

  // ── Filter install requests ─────────────────────────────────────────────────
  const filteredInstalls = useMemo(() => installRequests.filter(r => {
    if (!r.proposedDate)                              return false;
    if (filterInstaller && r.installerId !== filterInstaller) return false;
    if (filterStatus    && r.status !== filterStatus) return false;
    return true;
  }), [installRequests, filterInstaller, filterStatus, tick]);

  // ── Get all events for a specific day ──────────────────────────────────────
  const getInstallsForDay = (day) =>
    filteredInstalls.filter(r => r.proposedDate && isSameDay(parseISO(r.proposedDate), day));

  const getCalEventsForDay = (day) =>
    calendarEvents.filter(e => e.startAt && isSameDay(parseISO(e.startAt), day));

  // ── Calendar grid days ─────────────────────────────────────────────────────
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(current), { weekStartsOn: 1 });
    const end   = endOfWeek(endOfMonth(current),     { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [current]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(current, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [current]);

  const nav = (dir) => {
    if (view === 'Month') setCurrent(dir > 0 ? addMonths(current, 1) : subMonths(current, 1));
    if (view === 'Week')  setCurrent(dir > 0 ? addWeeks(current, 1)  : subWeeks(current, 1));
    if (view === 'List')  setCurrent(dir > 0 ? addMonths(current, 1) : subMonths(current, 1));
  };

  const title = view === 'Month' ? format(current, 'MMMM yyyy')
    : view === 'Week' ? `${format(weekDays[0], 'd MMM')} – ${format(weekDays[6], 'd MMM yyyy')}`
    : format(current, 'MMMM yyyy');

  const handleDayClick = (day) => {
    setNewEventDate(day);
    setShowNewEventModal(true);
  };

  const handleDeleteInstall = () => {
    if (!selectedInstall) return;
    deleteJob(selectedInstall.jobId);
    setShowDeleteInstall(false);
    setSelectedInstall(null);
  };

  const handleDeleteCalEvent = () => {
    if (!selectedCalEvent) return;
    deleteCalendarEvent(selectedCalEvent.id, displayName);
    setShowDeleteCal(false);
    setSelectedCalEvent(null);
  };

  // ── Event pill — install request ────────────────────────────────────────────
  const InstallPill = ({ ev, compact = false }) => {
    const inst = getInstaller(ev.installerId);
    const badge = pickupBadge(ev);
    return (
      <button
        onClick={e => { e.stopPropagation(); setSelectedInstall(ev); }}
        className="w-full text-left"
      >
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs truncate hover:opacity-80 transition-opacity ${INSTALL_REQUEST_STATUS_COLORS[ev.status] || 'bg-slate-100 text-slate-600'}`}>
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[ev.status] || 'bg-slate-400'}`} />
          <span className="truncate">{compact ? (inst?.name?.split(' ')[0] || '?') : (inst?.name || 'Install')}</span>
          {badge && <Package size={9} className="flex-shrink-0 opacity-70" />}
        </div>
      </button>
    );
  };

  // ── Event pill — calendar event ─────────────────────────────────────────────
  const CalEventPill = ({ ev, compact = false }) => {
    const cfg = EVENT_TYPE_MAP[ev.eventType] || EVENT_TYPE_MAP.other;
    const label = ev.title || cfg.label;
    return (
      <button
        onClick={e => { e.stopPropagation(); setSelectedCalEvent(ev); }}
        className="w-full text-left"
      >
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs truncate hover:opacity-80 transition-opacity ${cfg.pill}`}>
          <span className="text-[10px] leading-none flex-shrink-0">{cfg.icon}</span>
          <span className="truncate">{compact ? label.split(' ')[0] : label}</span>
        </div>
      </button>
    );
  };

  const totalVisible = filteredInstalls.length + calendarEvents.length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {filteredInstalls.length} install{filteredInstalls.length !== 1 ? 's' : ''}
            {calendarEvents.length > 0 && ` · ${calendarEvents.length} event${calendarEvents.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => { setNewEventDate(new Date()); setShowNewEventModal(true); }}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <Plus size={16} /> New Entry
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Nav */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
          <button onClick={() => nav(-1)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="px-2 text-sm font-semibold text-slate-800 min-w-[160px] text-center">{title}</span>
          <button onClick={() => nav(1)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
        <button onClick={() => setCurrent(new Date())}
          className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
          Today
        </button>

        {/* View mode */}
        <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1 ml-auto">
          {VIEW_MODES.map(m => (
            <button key={m} onClick={() => setView(m)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${view === m ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {m}
            </button>
          ))}
        </div>

        {/* Installer filter */}
        <select value={filterInstaller} onChange={e => setFilterInstaller(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">All installers</option>
          {installers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="">All statuses</option>
          {['Draft','Sent','Accepted','Declined','Completed','Rescheduled','Cancelled'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STATUS_DOT).slice(0,5).map(([s, cls]) => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-slate-500">
            <div className={`w-2.5 h-2.5 rounded-full ${cls}`} />
            {s}
          </div>
        ))}
        <div className="w-px bg-slate-200 mx-1 h-4 self-center" />
        {EVENT_TYPES.slice(0,4).map(t => (
          <div key={t.value} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="text-sm leading-none">{t.icon}</span>
            {t.label}
          </div>
        ))}
      </div>

      {/* ── Month view ── */}
      {view === 'Month' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
              <div key={d} className="py-2.5 text-center text-xs font-semibold text-slate-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day, i) => {
              const installs  = getInstallsForDay(day);
              const calEvs    = getCalEventsForDay(day);
              const total     = installs.length + calEvs.length;
              const inMonth   = isSameMonth(day, current);
              const todayDay  = isToday(day);
              return (
                <div
                  key={i}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-[90px] p-1.5 border-b border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-slate-50/50 transition-colors ${!inMonth ? 'bg-slate-50/60' : ''}`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-full mb-1 ${
                    todayDay ? 'bg-amber-500 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300'
                  }`}>
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-0.5">
                    {installs.slice(0, 2).map(ev => <InstallPill key={ev.id} ev={ev} compact />)}
                    {calEvs.slice(0, Math.max(0, 3 - installs.length)).map(ev => <CalEventPill key={ev.id} ev={ev} compact />)}
                    {total > 3 && <div className="text-xs text-slate-400 pl-1">+{total - 3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Week view ── */}
      {view === 'Week' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 divide-x divide-slate-100">
            {weekDays.map(day => {
              const installs = getInstallsForDay(day);
              const calEvs   = getCalEventsForDay(day);
              const todayDay = isToday(day);
              return (
                <div key={day.toISOString()} className="min-h-[300px]">
                  <div
                    className={`py-3 text-center border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${todayDay ? 'bg-amber-50' : ''}`}
                    onClick={() => handleDayClick(day)}
                  >
                    <div className="text-xs text-slate-500">{format(day, 'EEE')}</div>
                    <div className={`text-lg font-bold mt-0.5 w-9 h-9 flex items-center justify-center rounded-full mx-auto ${
                      todayDay ? 'bg-amber-500 text-white' : 'text-slate-800'
                    }`}>
                      {format(day, 'd')}
                    </div>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {installs.map(ev => {
                      const inst = getInstaller(ev.installerId);
                      const job  = getJob(ev.jobId);
                      const cust = job ? getCustomer(job.customerId) : null;
                      const badge = pickupBadge(ev);
                      return (
                        <button key={ev.id} onClick={e => { e.stopPropagation(); setSelectedInstall(ev); }}
                          className={`w-full text-left rounded-lg p-2 border text-xs hover:opacity-90 transition-opacity ${INSTALL_REQUEST_STATUS_COLORS[ev.status] || 'bg-slate-100'}`}>
                          <div className="font-semibold truncate">{cust?.name || 'Install'}</div>
                          <div className="opacity-80 truncate">{inst?.name?.split(' ')[0]}</div>
                          {ev.arrivalTime && <div className="opacity-70 text-xs mt-0.5">🕐 {ev.arrivalTime}</div>}
                        </button>
                      );
                    })}
                    {calEvs.map(ev => {
                      const cfg  = EVENT_TYPE_MAP[ev.eventType] || EVENT_TYPE_MAP.other;
                      return (
                        <button key={ev.id} onClick={e => { e.stopPropagation(); setSelectedCalEvent(ev); }}
                          className={`w-full text-left rounded-lg p-2 text-xs hover:opacity-90 transition-opacity ${cfg.pill}`}>
                          <div className="font-semibold truncate">{cfg.icon} {ev.title}</div>
                          {ev.startAt && !ev.allDay && (
                            <div className="opacity-80 mt-0.5">🕐 {format(parseISO(ev.startAt), 'h:mm a')}</div>
                          )}
                          {ev.location && <div className="opacity-70 truncate mt-0.5">📍 {ev.location}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── List view ── */}
      {view === 'List' && (() => {
        const listInstalls = filteredInstalls
          .filter(r => r.proposedDate && (isSameMonth(parseISO(r.proposedDate), current) || parseISO(r.proposedDate) >= new Date()))
          .sort((a, b) => new Date(a.proposedDate) - new Date(b.proposedDate));

        const listCalEvs = calendarEvents
          .filter(e => e.startAt && (isSameMonth(parseISO(e.startAt), current) || parseISO(e.startAt) >= new Date()))
          .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

        if (listInstalls.length === 0 && listCalEvs.length === 0) {
          return (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <CalendarDays size={32} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No entries scheduled for this period.</p>
              <button
                onClick={() => { setNewEventDate(new Date()); setShowNewEventModal(true); }}
                className="mt-3 text-sm text-amber-600 hover:underline"
              >
                + Create new entry
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            {listInstalls.map(req => {
              const inst = getInstaller(req.installerId);
              const job  = getJob(req.jobId);
              const cust = job ? getCustomer(job.customerId) : null;
              const badge = pickupBadge(req);
              return (
                <button key={req.id} onClick={() => setSelectedInstall(req)}
                  className="w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 hover:shadow-md hover:border-slate-300 transition-all text-left group">
                  <div className="w-14 text-center flex-shrink-0">
                    <div className="text-xs text-slate-400 uppercase">{format(parseISO(req.proposedDate), 'EEE')}</div>
                    <div className="text-2xl font-bold text-slate-900 leading-tight">{format(parseISO(req.proposedDate), 'd')}</div>
                    <div className="text-xs text-slate-500">{format(parseISO(req.proposedDate), 'MMM')}</div>
                  </div>
                  <div className="w-px self-stretch bg-slate-100" />
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <HardHat size={14} className="text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-semibold text-slate-900 text-sm">{cust?.name || 'Install'}</span>
                      {job && <span className="text-slate-400 text-xs">{job.jobNumber}</span>}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${INSTALL_REQUEST_STATUS_COLORS[req.status] || 'bg-slate-100'}`}>{req.status}</span>
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                      {inst && <span className="flex items-center gap-1"><HardHat size={11} />{inst.name}</span>}
                      {req.arrivalTime && <span className="flex items-center gap-1"><Clock size={11} />{req.arrivalTime}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                </button>
              );
            })}
            {listCalEvs.map(ev => {
              const cfg  = EVENT_TYPE_MAP[ev.eventType] || EVENT_TYPE_MAP.other;
              const cust = ev.customerId ? getCustomer(ev.customerId) : null;
              const job  = ev.jobId ? getJob(ev.jobId) : null;
              return (
                <button key={ev.id} onClick={() => setSelectedCalEvent(ev)}
                  className="w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 hover:shadow-md hover:border-slate-300 transition-all text-left group">
                  <div className="w-14 text-center flex-shrink-0">
                    <div className="text-xs text-slate-400 uppercase">{format(parseISO(ev.startAt), 'EEE')}</div>
                    <div className="text-2xl font-bold text-slate-900 leading-tight">{format(parseISO(ev.startAt), 'd')}</div>
                    <div className="text-xs text-slate-500">{format(parseISO(ev.startAt), 'MMM')}</div>
                  </div>
                  <div className="w-px self-stretch bg-slate-100" />
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.pill}`}>
                    <span className="text-base leading-none">{cfg.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-semibold text-slate-900 text-sm">{ev.title || cfg.label}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.pill}`}>{cfg.label}</span>
                      <span className="text-xs text-slate-400 px-2 py-0.5 rounded-full bg-slate-100 capitalize">{ev.status}</span>
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                      {cust && <span className="flex items-center gap-1"><User size={11} />{cust.name}</span>}
                      {job  && <span className="flex items-center gap-1">{job.jobNumber}</span>}
                      {!ev.allDay && ev.startAt && <span className="flex items-center gap-1"><Clock size={11} />{format(parseISO(ev.startAt), 'h:mm a')}</span>}
                      {ev.location && <span className="flex items-center gap-1"><MapPin size={11} />{ev.location}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Unscheduled installs reminder */}
      <NeedsInstaller navigate={navigate} />

      {/* ── Install request detail modal ── */}
      {selectedInstall && !showDeleteInstall && (() => {
        const job  = getJob(selectedInstall.jobId);
        const cust = job ? getCustomer(job.customerId) : null;
        const inst = getInstaller(selectedInstall.installerId);
        const badge = pickupBadge(selectedInstall);
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelectedInstall(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🔧 Install</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-base truncate">{cust?.name || 'Customer'}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {job && <span className="text-xs text-slate-400">{job.jobNumber}</span>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${INSTALL_REQUEST_STATUS_COLORS[selectedInstall.status] || 'bg-slate-100 text-slate-600'}`}>
                      {selectedInstall.status}
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelectedInstall(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                  <X size={18} />
                </button>
              </div>
              <div className="text-sm text-slate-600 space-y-1.5">
                {selectedInstall.proposedDate && (
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} className="text-slate-400" />
                    <span>{format(parseISO(selectedInstall.proposedDate), 'EEEE, d MMMM yyyy')}</span>
                  </div>
                )}
                {inst && <div className="flex items-center gap-2"><HardHat size={14} className="text-slate-400" /><span>{inst.name}</span></div>}
                {selectedInstall.arrivalTime && (
                  <div className="flex items-center gap-2"><Clock size={14} className="text-slate-400" /><span>{selectedInstall.arrivalTime}</span></div>
                )}
                {selectedInstall.suburb && <div className="text-xs text-slate-500">{selectedInstall.suburb}</div>}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setSelectedInstall(null); navigate(`/jobs/${selectedInstall.jobId}`); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  <ExternalLink size={14} /> View Job
                </button>
                <button onClick={() => setShowDeleteInstall(true)}
                  className="flex items-center justify-center gap-1.5 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Calendar event detail modal ── */}
      {selectedCalEvent && !showDeleteCal && (() => {
        const cfg  = EVENT_TYPE_MAP[selectedCalEvent.eventType] || EVENT_TYPE_MAP.other;
        const cust = selectedCalEvent.customerId ? getCustomer(selectedCalEvent.customerId) : null;
        const job  = selectedCalEvent.jobId ? getJob(selectedCalEvent.jobId) : null;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelectedCalEvent(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.pill}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                  <h3 className="font-bold text-slate-900 text-base mt-1.5">{selectedCalEvent.title || cfg.label}</h3>
                  {(cust || job) && (
                    <p className="text-sm text-slate-500 mt-0.5">
                      {cust?.name}{job ? ` · ${job.jobNumber}` : ''}
                    </p>
                  )}
                </div>
                <button onClick={() => setSelectedCalEvent(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0"><X size={18} /></button>
              </div>
              <div className="text-sm text-slate-600 space-y-1.5">
                {selectedCalEvent.startAt && (
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} className="text-slate-400" />
                    <span>
                      {format(parseISO(selectedCalEvent.startAt), 'EEEE, d MMMM yyyy')}
                      {!selectedCalEvent.allDay && (
                        <span className="ml-1 text-slate-400">
                          {format(parseISO(selectedCalEvent.startAt), 'h:mm a')}
                          {selectedCalEvent.endAt && ` – ${format(parseISO(selectedCalEvent.endAt), 'h:mm a')}`}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {selectedCalEvent.location && (
                  <div className="flex items-center gap-2"><MapPin size={14} className="text-slate-400" /><span>{selectedCalEvent.location}</span></div>
                )}
                {selectedCalEvent.notes && (
                  <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600 mt-2">{selectedCalEvent.notes}</div>
                )}
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize`}>{selectedCalEvent.status}</span>
              </div>
              <div className="flex gap-2 pt-1">
                {job && (
                  <button onClick={() => { setSelectedCalEvent(null); navigate(`/jobs/${job.id}`); }}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                    <ExternalLink size={14} /> View Job
                  </button>
                )}
                <button onClick={() => { setEditingEvent(selectedCalEvent); setSelectedCalEvent(null); }}
                  className="flex items-center justify-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => setShowDeleteCal(true)}
                  className="flex items-center justify-center gap-1.5 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Delete install confirm ── */}
      {selectedInstall && showDeleteInstall && (() => {
        const job  = getJob(selectedInstall.jobId);
        const cust = job ? getCustomer(job.customerId) : null;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Delete this job?</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    You're about to permanently delete <strong>{cust?.name || 'this job'}</strong>{job?.jobNumber ? ` (${job.jobNumber})` : ''}.
                  </p>
                  <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-700">Deleting this job will also affect linked records and cannot be undone.</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteInstall(false)} className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
                <button onClick={handleDeleteInstall} className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl">Delete Job</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Delete calendar event confirm ── */}
      {selectedCalEvent && showDeleteCal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Delete this entry?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  "{selectedCalEvent.title || EVENT_TYPE_MAP[selectedCalEvent.eventType]?.label}" will be permanently removed.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteCal(false)} className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
              <button onClick={handleDeleteCalEvent} className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New / Edit calendar event modal ── */}
      {(showNewEventModal || editingEvent) && (
        <CalendarEventModal
          initialDate={newEventDate}
          eventToEdit={editingEvent}
          onSave={() => {}}
          onClose={() => { setShowNewEventModal(false); setNewEventDate(null); setEditingEvent(null); }}
        />
      )}
    </div>
  );
}

// ── Unscheduled jobs widget ───────────────────────────────────────────────────
function NeedsInstaller({ navigate }) {
  const jobs = getJobs().filter(j => ['Received','Approved','Ordered'].includes(j.status));
  const requests = getInstallRequests();
  const unscheduled = jobs.filter(j => !requests.some(r => r.jobId === j.id && r.status !== 'Declined' && r.status !== 'Cancelled'));
  if (unscheduled.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={15} className="text-amber-600" />
        <h3 className="font-semibold text-amber-800 text-sm">{unscheduled.length} job{unscheduled.length !== 1 ? 's' : ''} needing installation scheduling</h3>
      </div>
      <div className="space-y-1.5">
        {unscheduled.map(job => {
          const cust = getCustomer(job.customerId);
          return (
            <button key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
              className="w-full flex items-center gap-2 text-xs text-amber-800 hover:text-amber-900 bg-white rounded-lg px-3 py-2 border border-amber-100 hover:border-amber-300 transition-colors text-left">
              <span className="font-semibold">{job.jobNumber}</span>
              <span>{cust?.name}</span>
              <span className="text-amber-500 ml-auto">Schedule →</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
