import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Edit3, Save, X, User, MapPin, Phone, Mail,
  Calendar, ClipboardList, FileText,
  ChevronRight, Clock, CheckCircle2, TrendingUp, Briefcase,
  AlertTriangle, StickyNote, ChevronDown, HardHat, Plus, Upload,
  CalendarPlus, Trash2, Wrench, MessageSquare, Ruler, Mic, MoreHorizontal,
} from 'lucide-react';
import CommsTab from '../components/CommsTab';
import ConsultRecordings from '../components/ConsultRecordings';
import { useActiveSalespeople } from '../hooks/useActiveSalespeople';
import {
  getJob, getCustomer, getMeasureSheetsByJob, getActivityByJob,
  updateJobStatus, saveJob, JOB_STATUSES, STATUS_COLORS, getQuotesByJob,
  deleteQuote, deleteJob,
} from '../store/data';
import StatusBadge from '../components/StatusBadge';
import UrgencyBadge from '../components/UrgencyBadge';
import { toast } from '../components/ToastContainer';
import ReviewAskModal from '../components/ReviewAskModal';
import { useProfile } from '../contexts/UserProfileContext';
import { getReviewRequestByJob } from '../store/data';
import Card from '../components/Card';
import InstallationSection from '../components/InstallationSection';
import CalendarEventModal from '../components/CalendarEventModal';
import JobAIChat from '../components/JobAIChat';

const fmt = (n) => `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const ACTIVITY_ICONS = {
  status_change:           { icon: TrendingUp,    bg: 'bg-blue-100',   color: 'text-blue-600' },
  measure_created:         { icon: ClipboardList, bg: 'bg-amber-100',  color: 'text-amber-600' },
  job_created:             { icon: Briefcase,     bg: 'bg-purple-100', color: 'text-purple-600' },
  quote_sent:              { icon: FileText,      bg: 'bg-orange-100', color: 'text-orange-600' },
  po_sent:                 { icon: FileText,      bg: 'bg-amber-100',  color: 'text-amber-600' },
  job_completed:           { icon: CheckCircle2, bg: 'bg-green-100',   color: 'text-green-600' },
  install_request_created: { icon: HardHat,      bg: 'bg-slate-100',   color: 'text-slate-500' },
  install_request_sent:    { icon: HardHat,      bg: 'bg-blue-100',    color: 'text-blue-600' },
  install_accepted:        { icon: CheckCircle2, bg: 'bg-green-100',   color: 'text-green-600' },
  install_declined:        { icon: X,            bg: 'bg-red-100',     color: 'text-red-500' },
};

const TABS = [
  { id: 'overview',  label: 'Overview',        icon: Briefcase },
  { id: 'quotes',    label: 'Quotes',           icon: FileText },
  { id: 'measures',  label: 'Measures',         icon: ClipboardList },
  { id: 'consults',  label: 'Consults',         icon: Mic },
  { id: 'install',   label: 'Install & Notes',  icon: Wrench },
  { id: 'comms',     label: 'Comms',            icon: MessageSquare },
];

export default function JobProfile() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { salespeople } = useActiveSalespeople();

  const job          = getJob(id);
  const customer     = getCustomer(job?.customerId);
  const measureSheets = getMeasureSheetsByJob(id);
  const activity     = getActivityByJob(id);
  const quotes       = getQuotesByJob(id).filter(q => !q.deletedAt);

  const [activeTab,   setActiveTab]   = useState('overview');
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingNotes,  setEditingNotes]  = useState(false);
  const [notesValue,    setNotesValue]    = useState(job?.internalNotes || '');
  const [editingJob,    setEditingJob]    = useState(false);
  const [jobEdits,      setJobEdits]      = useState({});
  const [showCalendar,  setShowCalendar]  = useState(false);
  const [confirmDeleteQuoteId, setConfirmDeleteQuoteId] = useState(null);
  const [reviewPrompt, setReviewPrompt]   = useState(false);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(false);
  const [moreOpen, setMoreOpen]           = useState(false);
  const { displayName = '' } = useProfile() || {};

  useDataRefresh();

  if (!job) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Job not found.</p>
      </div>
    );
  }

  const handleStatusChange = (s) => {
    updateJobStatus(id, s, 'Admin');
    setEditingStatus(false);
    // Peak-happiness moment: offer to ask for a Google review when the job
    // completes — only if this customer hasn't been asked for this job.
    if (s === 'Completed' && (customer?.mobile || customer?.phone) && !getReviewRequestByJob(id)) {
      setReviewPrompt(true);
    }
  };
  const handleSaveNotes    = () => { saveJob({ ...job, internalNotes: notesValue }); setEditingNotes(false); toast('Notes saved.'); };
  const handleSaveJobEdits = () => { saveJob({ ...job, ...jobEdits }); setEditingJob(false); setJobEdits({}); toast('Job updated.'); };

  const statusIndex  = JOB_STATUSES.indexOf(job.status);
  const totalQuoted  = quotes.reduce((sum, q) => sum + Number(q.grandTotal || 0), 0);
  const acceptedQuote = quotes.find(q => q.status === 'Accepted');

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">

      {/* ── Compact header ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="p-5">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            {/* Avatar + name */}
            <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700 font-bold text-lg">
              {customer?.name?.charAt(0) || 'J'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-lg font-bold text-slate-900 leading-tight">{customer?.name}</h1>
                <span className="text-slate-400 text-sm font-mono">{job.jobNumber}</span>
                <StatusBadge status={job.status} />
                <UrgencyBadge urgency={job.urgency || 'Normal'} />
              </div>
              {/* Key info strip */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                {job.assignedStaff && <span className="flex items-center gap-1"><User size={11} />{job.assignedStaff}</span>}
                {job.measureDate   && <span className="flex items-center gap-1"><ClipboardList size={11} />Measure {format(parseISO(job.measureDate), 'd MMM')}</span>}
                {job.installDate   && <span className="flex items-center gap-1"><Calendar size={11} />Install {format(parseISO(job.installDate), 'd MMM')}</span>}
                {totalQuoted > 0   && <span className="flex items-center gap-1 font-medium text-slate-700">{fmt(totalQuoted)} quoted</span>}
                {acceptedQuote     && <span className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle2 size={11} />Accepted</span>}
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              {/* Primary create actions */}
              <button onClick={() => navigate(`/quotes/new-from-job/${id}`)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white transition-colors">
                <Plus size={14} /> New Quote
              </button>
              <button onClick={() => navigate(`/measure-sheets/new?customerId=${job.customerId}&jobId=${id}`)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition-colors">
                <ClipboardList size={14} /> <span className="hidden sm:inline">New Measure</span>
              </button>
              {/* Status control */}
              <button onClick={() => setEditingStatus(!editingStatus)}
                className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${editingStatus ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <ChevronDown size={14} /> <span className="hidden sm:inline">Status</span>
              </button>
              {/* Overflow menu — occasional + destructive actions */}
              <div className="relative">
                <button onClick={() => setMoreOpen(o => !o)} aria-label="More actions" aria-expanded={moreOpen}
                  className={`flex items-center px-2.5 py-2 rounded-lg border transition-colors ${moreOpen ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <MoreHorizontal size={16} />
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-52 bg-white rounded-xl border border-slate-200 shadow-xl py-1">
                      <button onClick={() => { navigate(`/jobs/${id}/takeoff`); setMoreOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                        <Ruler size={15} className="text-slate-400" /> Plan Takeoff
                      </button>
                      <button onClick={() => { setShowCalendar(true); setMoreOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                        <CalendarPlus size={15} className="text-slate-400" /> Add to calendar
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      <button onClick={() => { setConfirmDeleteJob(true); setMoreOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                        <Trash2 size={15} /> Delete job
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Status picker */}
          {editingStatus && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Select new status</p>
              <div className="flex flex-wrap gap-2">
                {JOB_STATUSES.map(s => (
                  <button key={s} onClick={() => handleStatusChange(s)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      s === job.status ? 'ring-2 ring-amber-400 border-amber-400' : 'border-slate-200 hover:border-slate-300'
                    } ${STATUS_COLORS[s]}`}>
                    {s}
                  </button>
                ))}
              </div>
              <button onClick={() => setEditingStatus(false)} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          )}

          {/* Progress bar */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-0">
              {JOB_STATUSES.filter(s => s !== 'Cancelled').map((s, i, arr) => {
                const idx  = JOB_STATUSES.indexOf(s);
                const done = statusIndex >= idx;
                const curr = job.status === s;
                return (
                  <div key={s} className="flex items-center flex-1 min-w-0" title={s}>
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 border-2 transition-colors ${
                      curr ? 'bg-amber-500 border-amber-500 ring-2 ring-amber-200' :
                      done ? 'bg-amber-400 border-amber-400' : 'bg-white border-slate-300'
                    }`} />
                    {i < arr.length - 1 && <div className={`h-0.5 flex-1 ${done && statusIndex > idx ? 'bg-amber-400' : 'bg-slate-200'}`} />}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-amber-600 font-medium mt-1.5">{job.status}</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-slate-100 overflow-x-auto">
          {TABS.map(({ id: tid, label, icon: Icon }) => {
            const count =
              tid === 'quotes'   ? quotes.length :
              tid === 'measures' ? measureSheets.length : null;
            return (
              <button key={tid} onClick={() => setActiveTab(tid)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-1 justify-center ${
                  activeTab === tid
                    ? 'border-amber-500 text-amber-600 bg-amber-50/40'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                }`}>
                <Icon size={14} />
                {label}
                {count !== null && count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    activeTab === tid ? 'bg-amber-200 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Tab: Overview ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            {/* Job Details */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Briefcase size={15} /> Project Details</h2>
                <button onClick={() => setEditingJob(!editingJob)} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                  {editingJob ? <><X size={12} /> Cancel</> : <><Edit3 size={12} /> Edit</>}
                </button>
              </div>
              <div className="p-5">
                {editingJob ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Job Type">
                        <input value={jobEdits.jobType ?? job.jobType ?? ''} onChange={e => setJobEdits(p => ({...p, jobType: e.target.value}))} className="input-base" />
                      </Field>
                      <Field label="Assigned Staff">
                        <select value={jobEdits.assignedStaff ?? job.assignedStaff ?? ''} onChange={e => setJobEdits(p => ({...p, assignedStaff: e.target.value}))} className="input-base">
                          <option value="">— Unassigned —</option>
                          {salespeople.map(p => <option key={p.id} value={p.fullName || p.displayName}>{p.fullName || p.displayName}</option>)}
                        </select>
                      </Field>
                      <Field label="Measure Date">
                        <input type="date" value={jobEdits.measureDate ?? job.measureDate ?? ''} onChange={e => setJobEdits(p => ({...p, measureDate: e.target.value}))} className="input-base" />
                      </Field>
                      <Field label="Quote Due">
                        <input type="date" value={jobEdits.quoteDueDate ?? job.quoteDueDate ?? ''} onChange={e => setJobEdits(p => ({...p, quoteDueDate: e.target.value}))} className="input-base" />
                      </Field>
                      <Field label="Install Date">
                        <input type="date" value={jobEdits.installDate ?? job.installDate ?? ''} onChange={e => setJobEdits(p => ({...p, installDate: e.target.value}))} className="input-base" />
                      </Field>
                    </div>
                    <button onClick={handleSaveJobEdits}
                      className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                      <Save size={13} /> Save
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <DetailRow icon={<Briefcase size={13} />} label="Project Type"  value={job.jobType} />
                    <DetailRow icon={<User size={13} />}      label="Assigned Staff" value={job.assignedStaff} />
                    <DetailRow icon={<Calendar size={13} />}  label="Measure Date"  value={job.measureDate  ? format(parseISO(job.measureDate),  'd MMM yyyy') : '—'} />
                    <DetailRow icon={<Calendar size={13} />}  label="Quote Due"     value={job.quoteDueDate ? format(parseISO(job.quoteDueDate), 'd MMM yyyy') : '—'} />
                    <DetailRow icon={<Calendar size={13} />}  label="Install Date"  value={job.installDate  ? format(parseISO(job.installDate),  'd MMM yyyy') : '—'} />
                    <DetailRow icon={<AlertTriangle size={13} />} label="Urgency"   value={<UrgencyBadge urgency={job.urgency || 'Normal'} />} />
                  </div>
                )}
              </div>
            </Card>

            {/* Site Info */}
            {(job.accessInstructions || job.parkingNotes || job.siteConditionNotes) && (
              <Card>
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><MapPin size={15} /> Site Information</h2>
                </div>
                <div className="p-5 space-y-3 text-sm">
                  {job.accessInstructions && <DetailRow label="Access Instructions" value={job.accessInstructions} fullWidth />}
                  {job.parkingNotes       && <DetailRow label="Parking Notes"       value={job.parkingNotes} fullWidth />}
                  {job.siteConditionNotes && <DetailRow label="Site Conditions"     value={job.siteConditionNotes} fullWidth />}
                </div>
              </Card>
            )}

            {/* AI Chat */}
            <JobAIChat jobId={id} />
          </div>

          {/* Right sidebar */}
          <div className="space-y-5">
            {/* Customer */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><User size={15} /> Customer</h2>
                <button onClick={() => navigate(`/customers/${customer?.id}`)} className="text-xs text-amber-600 hover:underline">View →</button>
              </div>
              <div className="p-5 space-y-2.5 text-sm">
                <p className="font-semibold text-slate-800">{customer?.name}</p>
                {customer?.phone && <p className="flex items-center gap-2 text-slate-500"><Phone size={12} />{customer.phone}</p>}
                {customer?.email && <p className="flex items-center gap-2 text-slate-500"><Mail size={12} />{customer.email}</p>}
                {customer?.address && <p className="flex items-start gap-2 text-slate-500"><MapPin size={12} className="mt-0.5 flex-shrink-0" />{customer.address}</p>}
                {customer?.preferredContact && (
                  <p className="text-xs text-slate-400 pt-1">Preferred: <span className="text-slate-600">{customer.preferredContact}</span></p>
                )}
              </div>
            </Card>

            {/* Timeline */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Clock size={15} /> Timeline</h2>
              </div>
              <div className="p-4 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">Created</span><span className="text-slate-700 font-medium">{format(parseISO(job.createdAt), 'd MMM yyyy')}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Updated</span><span className="text-slate-700 font-medium">{format(parseISO(job.updatedAt), 'd MMM yyyy')}</span></div>
                {job.measureDate && <div className="flex justify-between"><span className="text-slate-400">Measure</span><span className="text-slate-700 font-medium">{format(parseISO(job.measureDate), 'd MMM yyyy')}</span></div>}
                {job.installDate && <div className="flex justify-between"><span className="text-slate-400">Install</span><span className="text-slate-700 font-medium">{format(parseISO(job.installDate), 'd MMM yyyy')}</span></div>}
              </div>
            </Card>

            {/* Activity log */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Clock size={15} /> Activity</h2>
              </div>
              <div className="p-4 max-h-64 overflow-y-auto">
                {activity.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-2">No activity yet.</p>
                ) : (
                  <div className="space-y-3">
                    {activity.slice(0, 10).map(act => {
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
      )}

      {/* ── Tab: Quotes ───────────────────────────────────────────────── */}
      {activeTab === 'quotes' && (
        <div className="space-y-4">
          {/* Summary bar */}
          {quotes.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total quoted',  value: fmt(totalQuoted),                           color: 'text-slate-800' },
                { label: 'Accepted',      value: fmt(quotes.filter(q=>q.status==='Accepted').reduce((s,q)=>s+Number(q.grandTotal||0),0)), color: 'text-green-700' },
                { label: 'Quotes',        value: quotes.length,                              color: 'text-slate-800' },
                { label: 'Draft',         value: quotes.filter(q=>q.status==='Draft').length, color: 'text-slate-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <FileText size={15} /> Quotes
              </h2>
              <button onClick={() => navigate(`/quotes/new-from-job/${id}`)}
                className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-white px-3 py-1.5 rounded-lg transition-colors">
                <Plus size={12} /> New Quote
              </button>
            </div>
            {quotes.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <FileText size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-medium text-slate-600">No quotes yet</p>
                <p className="text-xs text-slate-400 mt-1">Create the first quote for this project.</p>
                <button onClick={() => navigate(`/quotes/new-from-job/${id}`)}
                  className="mt-4 text-xs text-amber-600 hover:underline font-medium">
                  Create first quote →
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {quotes.map(q => (
                  <div key={q.id} className="flex items-center gap-2 px-5 py-4 hover:bg-slate-50 transition-colors">
                    <button onClick={() => navigate(`/quotes/${q.id}`)} className="flex-1 text-left flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-8 rounded-full flex-shrink-0 ${
                        q.status === 'Accepted' ? 'bg-green-400' :
                        q.status === 'Sent'     ? 'bg-blue-400' :
                        q.status === 'Declined' ? 'bg-red-400' :
                        q.status === 'Draft'    ? 'bg-slate-300' : 'bg-amber-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-slate-800">{q.quoteNumber}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            q.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                            q.status === 'Sent'     ? 'bg-blue-100 text-blue-700' :
                            q.status === 'Draft'    ? 'bg-slate-100 text-slate-600' :
                            q.status === 'Declined' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>{q.status}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{q.title}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {q.grandTotal > 0 && <p className="font-semibold text-slate-800 text-sm">{fmt(q.grandTotal)}</p>}
                        {q.sentAt && <p className="text-xs text-slate-400">Sent {format(parseISO(q.sentAt), 'd MMM')}</p>}
                      </div>
                      <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                    </button>
                    {/* Delete */}
                    {confirmDeleteQuoteId === q.id ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-red-600 font-medium">Delete?</span>
                        <button onClick={() => { deleteQuote(q.id, 'Admin'); setConfirmDeleteQuoteId(null); toast('Quote deleted.'); }}
                          className="text-xs bg-red-500 hover:bg-red-400 text-white font-medium px-2 py-1 rounded-lg">Yes</button>
                        <button onClick={() => setConfirmDeleteQuoteId(null)}
                          className="text-xs border border-slate-200 text-slate-500 hover:bg-slate-100 px-2 py-1 rounded-lg">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteQuoteId(q.id)}
                        className="flex-shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Tab: Measures ─────────────────────────────────────────────── */}
      {activeTab === 'measures' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <ClipboardList size={15} /> Measure Sheets
            </h2>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => navigate(`/measure-sheets/import?customerId=${job.customerId}&jobId=${id}`)}
                className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors">
                <Upload size={12} /> Import
              </button>
              <button onClick={() => navigate(`/measure-sheets/new?customerId=${job.customerId}&jobId=${id}`)}
                className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-white px-3 py-1.5 rounded-lg transition-colors">
                <Plus size={12} /> New Sheet
              </button>
            </div>
          </div>

          {measureSheets.length === 0 ? (
            <div className="p-12 text-center">
              <ClipboardList size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No measure sheets yet</p>
              <p className="text-xs text-slate-400 mt-1">Create a new sheet or import from Excel.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {measureSheets.map((ms) => (
                <div key={ms.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ms.importedFromExcel ? 'bg-blue-50' : 'bg-amber-50'}`}>
                        {ms.importedFromExcel ? <Upload size={14} className="text-blue-500" /> : <ClipboardList size={14} className="text-amber-500" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-800">{ms.importedFromExcel ? 'Imported' : 'Measure Sheet'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ms.status === 'Submitted' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{ms.status}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {ms.lineItems?.length || 0} item{(ms.lineItems?.length || 0) !== 1 ? 's' : ''}
                          {ms.measureDate ? ` · ${ms.measureDate}` : ''}
                          {ms.measurer    ? ` · ${ms.measurer}`    : ''}
                          {(ms.updatedAt || ms.createdAt) ? ` · Last edited ${format(parseISO(ms.updatedAt || ms.createdAt), 'd MMM yyyy, h:mm a')}` : ''}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => navigate(`/measure-sheets/${ms.id}`)}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:underline flex-shrink-0">
                      View <ChevronRight size={12} />
                    </button>
                  </div>
                  {/* Inline table preview */}
                  {ms.lineItems?.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            {['#','Location','Product','W','D','Qty','Fabric','Control'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {ms.lineItems.slice(0, 6).map((item, i) => (
                            <tr key={item.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-400">{i+1}</td>
                              <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{item.location || '—'}</td>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{item.productNameSnapshot || '—'}</td>
                              <td className="px-3 py-2 text-slate-600 font-mono text-right">{item.widthMm || '—'}</td>
                              <td className="px-3 py-2 text-slate-600 font-mono text-right">{item.dropMm || '—'}</td>
                              <td className="px-3 py-2 text-slate-600 text-center">{item.quantity || 1}</td>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{item.fabricColour || '—'}</td>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{item.control || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {ms.lineItems.length > 6 && (
                        <p className="text-center text-xs text-slate-400 py-2 border-t border-slate-50">
                          +{ms.lineItems.length - 6} more — <button onClick={() => navigate(`/measure-sheets/${ms.id}`)} className="text-amber-600 hover:underline">view full sheet</button>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Tab: Install & Notes ──────────────────────────────────────── */}
      {activeTab === 'install' && (
        <div className="space-y-5">
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
                    rows={5}
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                    placeholder="Add internal notes…"
                  />
                  <button onClick={handleSaveNotes}
                    className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                    <Save size={13} /> Save Notes
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                  {job.internalNotes || <span className="text-slate-400 italic">No internal notes yet.</span>}
                </p>
              )}
            </div>
          </Card>

        </div>
      )}

      {/* ── Tab: Comms ─────────────────────────────────────────────────── */}
      {activeTab === 'comms' && (
        <CommsTab
          jobId={id}
          customerId={job?.customerId}
          customerName={customer?.name}
          customerPhone={customer?.phone}
          customerEmail={customer?.email}
        />
      )}

      {/* ── Tab: Consults ─────────────────────────────────────────────── */}
      {activeTab === 'consults' && <ConsultRecordings jobId={id} />}

      {/* Calendar modal */}
      {showCalendar && (
        <CalendarEventModal
          initialCustomerId={job.customerId}
          initialJobId={id}
          onSave={() => setShowCalendar(false)}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {/* Google review ask — offered when the job is marked Completed */}
      {reviewPrompt && customer && (
        <ReviewAskModal
          customer={customer}
          jobId={id}
          senderFirstName={displayName.split(' ')[0]}
          onClose={() => setReviewPrompt(false)}
        />
      )}

      {/* Delete-job confirmation */}
      {confirmDeleteJob && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmDeleteJob(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Delete this project?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {customer?.name ? `${customer.name}'s project ` : 'This project '}({job.jobNumber})
                  {measureSheets.length > 0
                    ? ` and its ${measureSheets.length} measure sheet${measureSheets.length !== 1 ? 's' : ''} will be permanently removed.`
                    : ' will be permanently removed.'}
                  {quotes.length > 0 && (
                    <> Its {quotes.length} quote{quotes.length !== 1 ? 's' : ''} {quotes.length !== 1 ? 'are' : 'is'} kept (unlinked) and will still show on the customer.</>
                  )} This can't be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setConfirmDeleteJob(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={() => { deleteJob(id, displayName || 'Admin'); toast('Project deleted.'); navigate(job.customerId ? `/customers/${job.customerId}` : '/jobs'); }}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
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
