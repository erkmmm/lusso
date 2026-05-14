import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Edit3, Save, X, User, MapPin, Phone, Mail,
  Calendar, ClipboardList, Package, Wrench, FileText,
  ChevronRight, Clock, CheckCircle2, TrendingUp, Briefcase,
  AlertTriangle, StickyNote, ChevronDown, HardHat, Plus, Upload,
  CalendarPlus,
} from 'lucide-react';
import BackButton from '../components/BackButton';
import {
  getJob, getCustomer, getMeasureSheetsByJob, getActivityByJob,
  updateJobStatus, saveJob, JOB_STATUSES, STATUS_COLORS, getQuotesByJob,
} from '../store/data';
import StatusBadge from '../components/StatusBadge';
import UrgencyBadge from '../components/UrgencyBadge';
import Card from '../components/Card';
import InstallationSection from '../components/InstallationSection';
import CalendarEventModal from '../components/CalendarEventModal';

const ACTIVITY_ICONS = {
  status_change:        { icon: TrendingUp,    bg: 'bg-blue-100',   color: 'text-blue-600' },
  measure_created:      { icon: ClipboardList, bg: 'bg-amber-100',  color: 'text-amber-600' },
  job_created:          { icon: Briefcase,     bg: 'bg-purple-100', color: 'text-purple-600' },
  quote_sent:           { icon: FileText,      bg: 'bg-orange-100', color: 'text-orange-600' },
  job_completed:        { icon: CheckCircle2,  bg: 'bg-green-100',  color: 'text-green-600' },
  install_request_created: { icon: HardHat,   bg: 'bg-slate-100',  color: 'text-slate-500' },
  install_request_sent: { icon: HardHat,      bg: 'bg-blue-100',   color: 'text-blue-600' },
  install_accepted:     { icon: CheckCircle2, bg: 'bg-green-100',  color: 'text-green-600' },
  install_declined:     { icon: X,            bg: 'bg-red-100',    color: 'text-red-500' },
};

export default function JobProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [job, setJob]               = useState(getJob(id));
  const [customer, setCustomer]     = useState(getCustomer(job?.customerId));
  const [measureSheets]             = useState(() => getMeasureSheetsByJob(id));
  const [activity, setActivity]     = useState(getActivityByJob(id));
  const [quotes, setQuotes]         = useState(() => getQuotesByJob(id));
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingNotes, setEditingNotes]   = useState(false);
  const [notesValue, setNotesValue]       = useState(job?.internalNotes || '');
  const [editingJob, setEditingJob]       = useState(false);
  const [jobEdits, setJobEdits]           = useState({});
  const [showCalendar, setShowCalendar]   = useState(false);

  if (!job) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Job not found.</p>
        <BackButton fallback="/jobs" className="mt-2" />
      </div>
    );
  }

  const refresh = () => {
    setJob(getJob(id));
    setActivity(getActivityByJob(id));
    setQuotes(getQuotesByJob(id));
  };

  const handleStatusChange = (newStatus) => {
    updateJobStatus(id, newStatus, 'Admin');
    refresh();
    setEditingStatus(false);
  };

  const handleSaveNotes = () => {
    saveJob({ ...job, internalNotes: notesValue });
    setJob(getJob(id));
    setEditingNotes(false);
  };

  const handleSaveJobEdits = () => {
    saveJob({ ...job, ...jobEdits });
    setJob(getJob(id));
    setEditingJob(false);
    setJobEdits({});
  };

  const statusIndex = JOB_STATUSES.indexOf(job.status);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <BackButton fallback={job?.customerId ? `/customers/${job.customerId}` : '/jobs'} />

      {/* Header card */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700 font-bold text-xl">
            {customer?.name?.charAt(0) || 'J'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{customer?.name}</h1>
              <span className="text-slate-400 text-sm">{job.jobNumber}</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <StatusBadge status={job.status} />
              <UrgencyBadge urgency={job.urgency || 'Normal'} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
              {customer?.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{customer.phone}</span>}
              {customer?.email && <span className="flex items-center gap-1.5"><Mail size={13} />{customer.email}</span>}
              {customer?.address && <span className="flex items-center gap-1.5"><MapPin size={13} />{customer.address}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <button
              onClick={() => navigate(`/quotes/new-from-job/${id}`)}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white transition-colors"
            >
              <Plus size={14} /> New Quote
            </button>
            <button
              onClick={() => setShowCalendar(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
              title="Add Calendar Entry"
            >
              <CalendarPlus size={14} /> <span className="hidden sm:inline">Calendar Entry</span>
            </button>
            <button
              onClick={() => setEditingStatus(!editingStatus)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <ChevronDown size={14} /> <span className="hidden sm:inline">Change Status</span>
            </button>
            <button
              onClick={() => navigate(`/customers/${customer?.id}`)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <User size={14} /> <span className="hidden sm:inline">Customer</span>
            </button>
          </div>
        </div>

        {/* Status picker */}
        {editingStatus && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Select new status</p>
            <div className="flex flex-wrap gap-2">
              {JOB_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    s === job.status
                      ? 'ring-2 ring-amber-400 border-amber-400'
                      : 'border-slate-200 hover:border-slate-300'
                  } ${STATUS_COLORS[s]}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button onClick={() => setEditingStatus(false)} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        )}
      </Card>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <p className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Job Progress</p>
        <div className="relative">
          <div className="flex items-center gap-0">
            {JOB_STATUSES.filter(s => s !== 'Cancelled').map((s, i, arr) => {
              const idx = JOB_STATUSES.indexOf(s);
              const done = statusIndex >= idx;
              const current = job.status === s;
              const isLast = i === arr.length - 1;
              return (
                <div key={s} className="flex items-center flex-1 min-w-0">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 border-2 transition-colors ${
                    current ? 'bg-amber-500 border-amber-500 ring-2 ring-amber-200' :
                    done ? 'bg-amber-400 border-amber-400' : 'bg-white border-slate-300'
                  }`} title={s} />
                  {!isLast && <div className={`h-0.5 flex-1 ${done && statusIndex > idx ? 'bg-amber-400' : 'bg-slate-200'}`} />}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-center">
            <span className="text-sm font-medium text-amber-600">{job.status}</span>
            <span className="text-slate-400 text-xs ml-2">
              (Step {Math.max(statusIndex + 1, 1)} of {JOB_STATUSES.length - 1})
            </span>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Job details */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Briefcase size={15} /> Job Details</h2>
              <button onClick={() => setEditingJob(!editingJob)} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                {editingJob ? <><X size={12} /> Cancel</> : <><Edit3 size={12} /> Edit</>}
              </button>
            </div>
            <div className="p-5">
              {editingJob ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Job Type">
                      <input value={jobEdits.jobType ?? job.jobType} onChange={e => setJobEdits(p => ({...p, jobType: e.target.value}))}
                        className="input-base" />
                    </Field>
                    <Field label="Assigned Staff">
                      <input value={jobEdits.assignedStaff ?? job.assignedStaff} onChange={e => setJobEdits(p => ({...p, assignedStaff: e.target.value}))}
                        className="input-base" />
                    </Field>
                    <Field label="Measure Date">
                      <input type="date" value={jobEdits.measureDate ?? job.measureDate ?? ''} onChange={e => setJobEdits(p => ({...p, measureDate: e.target.value}))}
                        className="input-base" />
                    </Field>
                    <Field label="Quote Due Date">
                      <input type="date" value={jobEdits.quoteDueDate ?? job.quoteDueDate ?? ''} onChange={e => setJobEdits(p => ({...p, quoteDueDate: e.target.value}))}
                        className="input-base" />
                    </Field>
                    <Field label="Install Date">
                      <input type="date" value={jobEdits.installDate ?? job.installDate ?? ''} onChange={e => setJobEdits(p => ({...p, installDate: e.target.value}))}
                        className="input-base" />
                    </Field>
                  </div>
                  <button onClick={handleSaveJobEdits}
                    className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                    <Save size={13} /> Save
                  </button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <DetailRow icon={<Briefcase size={13} />} label="Job Type" value={job.jobType} />
                  <DetailRow icon={<User size={13} />} label="Assigned Staff" value={job.assignedStaff} />
                  <DetailRow icon={<Calendar size={13} />} label="Measure Date" value={job.measureDate ? format(parseISO(job.measureDate), 'd MMM yyyy') : '—'} />
                  <DetailRow icon={<Calendar size={13} />} label="Quote Due" value={job.quoteDueDate ? format(parseISO(job.quoteDueDate), 'd MMM yyyy') : '—'} />
                  <DetailRow icon={<Calendar size={13} />} label="Install Date" value={job.installDate ? format(parseISO(job.installDate), 'd MMM yyyy') : '—'} />
                  <DetailRow icon={<AlertTriangle size={13} />} label="Urgency" value={<UrgencyBadge urgency={job.urgency || 'Normal'} />} />
                </div>
              )}
            </div>
          </Card>

          {/* Site info */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><MapPin size={15} /> Site Information</h2>
            </div>
            <div className="p-5 grid sm:grid-cols-2 gap-4 text-sm">
              <DetailRow label="Access Instructions" value={job.accessInstructions || '—'} fullWidth />
              <DetailRow label="Parking Notes" value={job.parkingNotes || '—'} fullWidth />
              <DetailRow label="Site Conditions" value={job.siteConditionNotes || '—'} fullWidth />
            </div>
          </Card>

          {/* ── Measure Sheets ──────────────────────────────────────────── */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <ClipboardList size={15} /> Measure Sheets
                {measureSheets.length > 0 && (
                  <span className="text-xs font-normal text-slate-400">({measureSheets.length})</span>
                )}
              </h2>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => navigate(`/measure-sheets/import?customerId=${job.customerId}&jobId=${id}`)}
                  className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Upload size={12} /> Import Measure Sheet
                </button>
                <button
                  onClick={() => navigate(`/measure-sheets/new?customerId=${job.customerId}&jobId=${id}`)}
                  className="flex items-center gap-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-400 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus size={12} /> New Measure Sheet
                </button>
              </div>
            </div>

            {measureSheets.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                  <ClipboardList size={18} className="text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600">No measure sheets yet</p>
                <p className="text-xs text-slate-400 mt-1">Use the buttons above to create a new sheet or import from Excel</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {measureSheets.map((ms) => (
                  <div key={ms.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ms.importedFromExcel ? 'bg-blue-50' : 'bg-amber-50'}`}>
                          {ms.importedFromExcel
                            ? <Upload size={14} className="text-blue-500" />
                            : <ClipboardList size={14} className="text-amber-500" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-800">
                              {ms.importedFromExcel ? 'Imported' : 'Measure Sheet'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ms.status === 'Submitted' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                              {ms.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {ms.lineItems?.length || 0} item{(ms.lineItems?.length || 0) !== 1 ? 's' : ''}
                            {ms.measureDate ? ` · ${ms.measureDate}` : ''}
                            {ms.measurer ? ` · ${ms.measurer}` : ''}
                            {ms.importedFromExcel && ms.originalFileName ? ` · ${ms.originalFileName}` : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/measure-sheets/${ms.id}`)}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:underline flex-shrink-0"
                      >
                        View <ChevronRight size={12} />
                      </button>
                    </div>

                    {/* Inline preview for first sheet only */}
                    {ms === measureSheets[0] && ms.lineItems?.length > 0 && (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                              {['#','Location','Product','W (mm)','D (mm)','Qty','Fabric','Control','Notes'].map(h => (
                                <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {ms.lineItems.slice(0, 5).map((item, i) => (
                              <tr key={item.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                                <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{item.location || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{item.productNameSnapshot || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap font-mono text-right">{item.widthMm || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap font-mono text-right">{item.dropMm || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 text-center">{item.quantity || 1}</td>
                                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{item.fabricColour || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{item.control || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-500 max-w-[120px] truncate">{item.notes || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {ms.lineItems.length > 5 && (
                          <p className="text-center text-xs text-slate-400 py-2 border-t border-slate-50">
                            +{ms.lineItems.length - 5} more items — <button onClick={() => navigate(`/measure-sheets/${ms.id}`)} className="text-amber-600 hover:underline">view full sheet</button>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Quotes section */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <FileText size={15} /> Quotes ({quotes.filter(q => !q.deletedAt).length})
              </h2>
              <button
                onClick={() => navigate(`/quotes/new-from-job/${id}`)}
                className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
              >
                <Plus size={13} /> New Quote
              </button>
            </div>
            {quotes.filter(q => !q.deletedAt).length === 0 ? (
              <div className="px-5 py-6 text-center">
                <p className="text-sm text-slate-400">No quotes yet.</p>
                <button
                  onClick={() => navigate(`/quotes/new-from-job/${id}`)}
                  className="mt-2 text-xs text-amber-600 hover:underline"
                >
                  Create first quote →
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {quotes.filter(q => !q.deletedAt).map(q => (
                  <button
                    key={q.id}
                    onClick={() => navigate(`/quotes/${q.id}`)}
                    className="w-full text-left flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{q.quoteNumber}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{q.title}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        q.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                        q.status === 'Sent'     ? 'bg-blue-100 text-blue-700' :
                        q.status === 'Draft'    ? 'bg-slate-100 text-slate-600' :
                        q.status === 'Declined' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{q.status}</span>
                      <ChevronRight size={14} className="text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Installation section */}
          <InstallationSection jobId={id} customer={customer} />

          {/* Internal notes */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><StickyNote size={15} /> Internal Notes</h2>
              <button onClick={() => setEditingNotes(!editingNotes)} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                {editingNotes ? <><X size={12} /> Cancel</> : <><Edit3 size={12} /> Edit</>}
              </button>
            </div>
            <div className="p-5">
              {editingNotes ? (
                <div className="space-y-3">
                  <textarea
                    value={notesValue}
                    onChange={e => setNotesValue(e.target.value)}
                    rows={4}
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                    placeholder="Add internal notes…"
                  />
                  <button onClick={handleSaveNotes}
                    className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                    <Save size={13} /> Save Notes
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{job.internalNotes || <span className="text-slate-400 italic">No internal notes yet.</span>}</p>
              )}
            </div>
          </Card>
        </div>

        {/* Calendar entry modal — pre-filled with this job */}
        {showCalendar && (
          <CalendarEventModal
            initialCustomerId={job.customerId}
            initialJobId={id}
            onSave={() => { setShowCalendar(false); }}
            onClose={() => setShowCalendar(false)}
          />
        )}

        {/* Right column */}
        <div className="space-y-5">
          {/* Customer summary */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><User size={15} /> Customer</h2>
              <button onClick={() => navigate(`/customers/${customer?.id}`)} className="text-xs text-amber-600 hover:underline">View →</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p className="font-semibold text-slate-800">{customer?.name}</p>
              {customer?.phone && <p className="flex items-center gap-2 text-slate-500"><Phone size={13} />{customer.phone}</p>}
              {customer?.email && <p className="flex items-center gap-2 text-slate-500"><Mail size={13} />{customer.email}</p>}
              {customer?.address && <p className="flex items-center gap-2 text-slate-500"><MapPin size={13} />{customer.address}</p>}
              {customer?.preferredContact && (
                <p className="text-xs text-slate-400">Preferred contact: <span className="text-slate-600">{customer.preferredContact}</span></p>
              )}
            </div>
          </Card>

          {/* Quick status */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Clock size={15} /> Timeline</h2>
            </div>
            <div className="p-4 space-y-2 text-xs text-slate-500">
              <div className="flex justify-between"><span>Created</span><span className="text-slate-700">{format(parseISO(job.createdAt), 'd MMM yyyy')}</span></div>
              <div className="flex justify-between"><span>Last updated</span><span className="text-slate-700">{format(parseISO(job.updatedAt), 'd MMM yyyy')}</span></div>
              {job.measureDate && <div className="flex justify-between"><span>Measured</span><span className="text-slate-700">{format(parseISO(job.measureDate), 'd MMM yyyy')}</span></div>}
              {job.installDate && <div className="flex justify-between"><span>Install</span><span className="text-slate-700">{format(parseISO(job.installDate), 'd MMM yyyy')}</span></div>}
            </div>
          </Card>

          {/* Activity log */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Clock size={15} /> Activity Log</h2>
            </div>
            <div className="p-4">
              {activity.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {activity.map(act => {
                    const { icon: Icon, bg, color } = ACTIVITY_ICONS[act.type] || ACTIVITY_ICONS.job_created;
                    return (
                      <div key={act.id} className="flex items-start gap-2.5">
                        <div className={`w-6 h-6 rounded-full ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                          <Icon size={11} className={color} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-slate-700">{act.message}</p>
                          <p className="text-xs text-slate-400">{act.user} · {format(parseISO(act.createdAt), 'd MMM h:mm a')}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, fullWidth }) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-slate-400 mb-0.5 flex items-center gap-1">{icon}{label}</dt>
      <dd className="text-slate-700">{value || '—'}</dd>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
