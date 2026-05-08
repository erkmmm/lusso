import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, addWeeks, subWeeks,
  isSameMonth, isSameDay, isToday, parseISO, eachDayOfInterval,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, HardHat,
  CheckCircle2, Clock, X, AlertTriangle, Filter, Package, Trash2, ExternalLink,
} from 'lucide-react';
import {
  getInstallRequests, getInstallers, getJobs, getCustomers,
  getInstaller, getJob, getCustomer, INSTALL_REQUEST_STATUS_COLORS,
  deleteJob,
} from '../store/data';

const pickupBadge = (req) => {
  const t = req.pickupType || '';
  if (t === 'Pickup from Lusso warehouse') return { label: 'Lusso WH', cls: 'bg-purple-100 text-purple-700' };
  if (t === 'Pickup from one supplier')    return { label: 'Supplier', cls: 'bg-purple-100 text-purple-700' };
  if (t === 'Pickup from multiple suppliers') return { label: `${req.pickupLocations?.length || ''}× Pickups`, cls: 'bg-purple-100 text-purple-700' };
  if (t === 'Products already onsite')     return { label: 'Onsite', cls: 'bg-teal-100 text-teal-700' };
  if (t === 'Service-only job')            return { label: 'Service Only', cls: 'bg-slate-100 text-slate-600' };
  return null;
};

const VIEW_MODES = ['Month', 'Week', 'List'];

const STATUS_DOT = {
  Accepted:    'bg-green-500',
  Sent:        'bg-blue-500',
  Declined:    'bg-red-400',
  Draft:       'bg-slate-400',
  Completed:   'bg-teal-500',
  Rescheduled: 'bg-amber-500',
  Cancelled:   'bg-slate-300',
  Expired:     'bg-orange-400',
};

export default function InstallationCalendar() {
  const navigate = useNavigate();
  const [current, setCurrent]   = useState(new Date());
  const [view, setView]         = useState('Month');
  const [filterInstaller, setFilterInstaller] = useState('');
  const [filterStatus, setFilterStatus]       = useState('');
  const [selectedEvent, setSelectedEvent]     = useState(null); // install request
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const requests   = getInstallRequests();
  const installers = getInstallers();

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (!r.proposedDate) return false;
      if (filterInstaller && r.installerId !== filterInstaller) return false;
      if (filterStatus    && r.status !== filterStatus) return false;
      return true;
    });
  }, [requests, filterInstaller, filterStatus]);

  const getEventsForDay = (day) =>
    filtered.filter(r => r.proposedDate && isSameDay(parseISO(r.proposedDate), day));

  // ── Month view ─────────────────────────────────────────────────────────────
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(current), { weekStartsOn: 1 });
    const end   = endOfWeek(endOfMonth(current),     { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [current]);

  // ── Week view ──────────────────────────────────────────────────────────────
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

  const handleDeleteJob = () => {
    if (!selectedEvent) return;
    deleteJob(selectedEvent.jobId);
    setShowDeleteConfirm(false);
    setSelectedEvent(null);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Installation Calendar</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} scheduled installation{filtered.length !== 1 ? 's' : ''}</p>
        </div>
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

        {/* Filters */}
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
        {Object.entries(STATUS_DOT).slice(0,5).map(([status, cls]) => (
          <div key={status} className="flex items-center gap-1.5 text-xs text-slate-600">
            <div className={`w-2.5 h-2.5 rounded-full ${cls}`} />
            {status}
          </div>
        ))}
      </div>

      {/* Month view */}
      {view === 'Month' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
              <div key={d} className="py-2.5 text-center text-xs font-semibold text-slate-500">{d}</div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7">
            {monthDays.map((day, i) => {
              const events = getEventsForDay(day);
              const inMonth = isSameMonth(day, current);
              const today   = isToday(day);
              return (
                <div
                  key={i}
                  className={`min-h-[90px] p-1.5 border-b border-r border-slate-100 last:border-r-0 ${!inMonth ? 'bg-slate-50/60' : ''}`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-full mb-1 ${
                    today ? 'bg-amber-500 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300'
                  }`}>
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-0.5">
                    {events.slice(0, 3).map(ev => {
                      const inst = getInstaller(ev.installerId);
                      const badge = pickupBadge(ev);
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className="w-full text-left"
                        >
                          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs truncate hover:opacity-80 transition-opacity ${INSTALL_REQUEST_STATUS_COLORS[ev.status] || 'bg-slate-100 text-slate-600'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[ev.status] || 'bg-slate-400'}`} />
                            <span className="truncate">{inst?.name?.split(' ')[0] || '?'}</span>
                            {badge && <Package size={9} className="flex-shrink-0 opacity-70" />}
                          </div>
                        </button>
                      );
                    })}
                    {events.length > 3 && (
                      <div className="text-xs text-slate-400 pl-1">+{events.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week view */}
      {view === 'Week' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 divide-x divide-slate-100">
            {weekDays.map(day => {
              const events  = getEventsForDay(day);
              const today   = isToday(day);
              return (
                <div key={day.toISOString()} className="min-h-[300px]">
                  {/* Day header */}
                  <div className={`py-3 text-center border-b border-slate-100 ${today ? 'bg-amber-50' : ''}`}>
                    <div className="text-xs text-slate-500">{format(day, 'EEE')}</div>
                    <div className={`text-lg font-bold mt-0.5 w-9 h-9 flex items-center justify-center rounded-full mx-auto ${
                      today ? 'bg-amber-500 text-white' : 'text-slate-800'
                    }`}>
                      {format(day, 'd')}
                    </div>
                  </div>
                  {/* Events */}
                  <div className="p-2 space-y-1.5">
                    {events.map(ev => {
                      const inst = getInstaller(ev.installerId);
                      const job  = getJob(ev.jobId);
                      const cust = job ? getCustomer(job.customerId) : null;
                      const badge = pickupBadge(ev);
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`w-full text-left rounded-lg p-2 border text-xs hover:opacity-90 transition-opacity ${INSTALL_REQUEST_STATUS_COLORS[ev.status] || 'bg-slate-100'}`}
                        >
                          <div className="font-semibold truncate">{cust?.name || 'Customer'}</div>
                          <div className="opacity-80 truncate">{inst?.name?.split(' ')[0]}</div>
                          {ev.arrivalTime && <div className="opacity-70 text-xs mt-0.5">🕐 {ev.arrivalTime}{ev.expectedDuration ? ` · ${ev.expectedDuration}` : ''}</div>}
                          {badge && (
                            <div className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full mt-1 ${badge.cls}`}>
                              <Package size={9} /> {badge.label}
                            </div>
                          )}
                        </button>
                      );
                    })}
                    {events.length === 0 && (
                      <div className="h-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <span className="text-xs text-slate-300">Free</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'List' && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <CalendarDays size={32} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No installations scheduled.</p>
            </div>
          ) : (
            [...filtered]
              .filter(r => {
                if (!r.proposedDate) return false;
                const d = parseISO(r.proposedDate);
                return isSameMonth(d, current) || d >= new Date();
              })
              .sort((a,b) => new Date(a.proposedDate) - new Date(b.proposedDate))
              .map(req => {
                const inst = getInstaller(req.installerId);
                const job  = getJob(req.jobId);
                const cust = job ? getCustomer(job.customerId) : null;
                const statusCls = INSTALL_REQUEST_STATUS_COLORS[req.status] || 'bg-slate-100 text-slate-600';
                const badge = pickupBadge(req);
                return (
                  <button
                    key={req.id}
                    onClick={() => setSelectedEvent(req)}
                    className="w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 hover:shadow-md hover:border-slate-300 transition-all text-left group"
                  >
                    {/* Date block */}
                    <div className="w-14 text-center flex-shrink-0">
                      <div className="text-xs text-slate-400 uppercase">{format(parseISO(req.proposedDate), 'EEE')}</div>
                      <div className="text-2xl font-bold text-slate-900 leading-tight">{format(parseISO(req.proposedDate), 'd')}</div>
                      <div className="text-xs text-slate-500">{format(parseISO(req.proposedDate), 'MMM')}</div>
                    </div>
                    <div className="w-px self-stretch bg-slate-100" />
                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className="font-semibold text-slate-900 text-sm">{cust?.name || 'Customer'}</span>
                        <span className="text-slate-400 text-xs">{job?.jobNumber}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>{req.status}</span>
                        {badge && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${badge.cls}`}>
                            <Package size={10} /> {badge.label}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                        <span className="flex items-center gap-1"><HardHat size={11} /> {inst?.name}</span>
                        {req.arrivalTime && <span className="flex items-center gap-1"><Clock size={11} /> {req.arrivalTime}{req.expectedDuration ? ` · ${req.expectedDuration}` : ''}</span>}
                        {req.suburb && <span>{req.suburb}</span>}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">{req.serviceRequired}</div>
                    </div>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                  </button>
                );
              })
          )}
        </div>
      )}

      {/* Unscheduled jobs needing installer */}
      <NeedsInstaller navigate={navigate} />

      {/* Event detail modal */}
      {selectedEvent && !showDeleteConfirm && (() => {
        const job  = getJob(selectedEvent.jobId);
        const cust = job ? getCustomer(job.customerId) : null;
        const inst = getInstaller(selectedEvent.installerId);
        const badge = pickupBadge(selectedEvent);
        const statusCls = INSTALL_REQUEST_STATUS_COLORS[selectedEvent.status] || 'bg-slate-100 text-slate-600';
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelectedEvent(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-900 text-base truncate">{cust?.name || 'Customer'}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {job && <span className="text-xs text-slate-400">{job.jobNumber}</span>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>{selectedEvent.status}</span>
                    {badge && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${badge.cls}`}>
                        <Package size={10} /> {badge.label}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setSelectedEvent(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                  <X size={18} />
                </button>
              </div>

              {/* Details */}
              <div className="text-sm text-slate-600 space-y-1.5">
                {selectedEvent.proposedDate && (
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} className="text-slate-400" />
                    <span>{format(parseISO(selectedEvent.proposedDate), 'EEEE, d MMMM yyyy')}</span>
                  </div>
                )}
                {inst && (
                  <div className="flex items-center gap-2">
                    <HardHat size={14} className="text-slate-400" />
                    <span>{inst.name}</span>
                  </div>
                )}
                {selectedEvent.arrivalTime && (
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-slate-400" />
                    <span>{selectedEvent.arrivalTime}{selectedEvent.expectedDuration ? ` · ${selectedEvent.expectedDuration}` : ''}</span>
                  </div>
                )}
                {selectedEvent.suburb && (
                  <div className="text-slate-500 text-xs pl-0.5">{selectedEvent.suburb}</div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setSelectedEvent(null); navigate(`/jobs/${selectedEvent.jobId}`); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                >
                  <ExternalLink size={14} /> View Job
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center justify-center gap-1.5 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete confirmation modal */}
      {selectedEvent && showDeleteConfirm && (() => {
        const job  = getJob(selectedEvent.jobId);
        const cust = job ? getCustomer(job.customerId) : null;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Delete this job?</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    You're about to permanently delete <strong>{cust?.name || 'this job'}</strong>{job?.jobNumber ? ` (${job.jobNumber})` : ''}. This action cannot be undone.
                  </p>
                  <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-700 leading-relaxed">
                      <strong>Disclaimer:</strong> Deleting this job will also affect all linked records — including measure sheets, quotes, and installation requests. This data cannot be recovered.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteJob}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                >
                  Delete Job
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

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
