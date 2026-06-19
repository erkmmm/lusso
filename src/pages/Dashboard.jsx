import { useDataRefresh } from '../hooks/useDataRefresh';
import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatDistanceToNow, parseISO, isWithinInterval, isSameDay,
  subDays, subMonths, startOfYear, endOfYear, startOfMonth,
  addDays, format, differenceInDays, startOfDay,
} from 'date-fns';
import {
  Briefcase, ClipboardList, CheckCircle2, Clock,
  AlertTriangle, TrendingUp, Users, ArrowRight, Plus,
  CalendarDays, Package, Wrench, Star, DollarSign,
  ChevronDown, BarChart2, TrendingDown, HardHat, Percent,
  SlidersHorizontal, Eye, EyeOff, MapPin, Wand2,
  FileText, X, Mail,
} from 'lucide-react';
import {
  getJobs, getJobsFiltered, getCustomers, getCustomersFiltered,
  getActivity, getQuotes, getQuotesFiltered, computeQuoteTotals,
  getInstallRequests, getInstaller, getCustomer, getJob,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';

// ─── Widget definitions ────────────────────────────────────────────────────────
const WIDGET_DEFS = [
  { key: 'needsAttention',    label: 'Needs Attention',        desc: 'Items waiting on action — stalled, quotes out, pending installs' },
  { key: 'todaySchedule',     label: "Today's Schedule",       desc: 'Installs booked for today & tomorrow' },
  { key: 'salesPerformance',  label: 'Sales Performance',      desc: 'Win rate, pipeline value & quotes accepted' },
  { key: 'monthlyTrend',      label: 'Monthly Revenue Trend',  desc: 'Accepted quote value for each month' },
  { key: 'stalledJobs',       label: 'Stalled Jobs',           desc: 'Jobs with no activity for 14+ days' },
  { key: 'yearlyPerformance', label: 'Yearly Performance',     desc: '5-year accepted quote history' },
  { key: 'jobPipeline',       label: 'Job Pipeline',           desc: 'Job counts by status stage' },
  { key: 'recentJobs',        label: 'Recent Jobs',            desc: 'Last 5 updated jobs' },
  { key: 'recentActivity',    label: 'Recent Activity',        desc: 'Latest changes and events' },
];

const DEFAULT_WIDGETS = Object.fromEntries(WIDGET_DEFS.map(w => [w.key, true]));
const PREFS_KEY = 'lusso_dashboard_prefs';
const LARP_KEY  = 'lusso_larp_mode';

function loadPrefs() {
  try { return { ...DEFAULT_WIDGETS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; }
  catch { return DEFAULT_WIDGETS; }
}
function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

function loadLarp() {
  try { return localStorage.getItem(LARP_KEY) === 'true'; }
  catch { return false; }
}
function saveLarp(v) { localStorage.setItem(LARP_KEY, v ? 'true' : 'false'); }

// ─── Pipeline config ───────────────────────────────────────────────────────────
const STAT_GROUPS = [
  { label: 'New Enquiry',         key: 'New Enquiry',          icon: Plus,          color: 'text-slate-500',  bg: 'bg-slate-50' },
  { label: 'Measure Booked',      key: 'Measure Booked',       icon: CalendarDays,  color: 'text-blue-500',   bg: 'bg-blue-50' },
  { label: 'Measured',            key: 'Measured',             icon: ClipboardList, color: 'text-cyan-500',   bg: 'bg-cyan-50' },
  { label: 'Quote Required',      key: 'Quote Required',       icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50' },
  { label: 'Quoted',              key: 'Quoted',               icon: TrendingUp,    color: 'text-orange-500', bg: 'bg-orange-50' },
  { label: 'Awaiting Approval',   key: 'Awaiting Approval',    icon: Clock,         color: 'text-amber-500',  bg: 'bg-amber-50' },
  { label: 'Approved',            key: 'Approved',             icon: Star,          color: 'text-lime-600',   bg: 'bg-lime-50' },
  { label: 'Ordered',             key: 'Ordered',              icon: Package,       color: 'text-purple-500', bg: 'bg-purple-50' },
  { label: 'Installation Booked', key: 'Installation Booked',  icon: CalendarDays,  color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { label: 'Installed',           key: 'Installed',            icon: Wrench,        color: 'text-teal-500',   bg: 'bg-teal-50' },
  { label: 'Completed',           key: 'Completed',            icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
];

// Covers every activity type the app emits (see addActivity calls across the
// codebase). Unmapped types fall back to ACTIVITY_FALLBACK rather than masquerading
// as a "job created" event.
const ACTIVITY_ICONS = {
  status_change:           { icon: TrendingUp,    color: 'text-blue-500',   bg: 'bg-blue-50' },
  job_created:             { icon: Briefcase,     color: 'text-purple-500', bg: 'bg-purple-50' },
  created:                 { icon: Plus,          color: 'text-purple-500', bg: 'bg-purple-50' },
  customer:                { icon: Users,         color: 'text-blue-500',   bg: 'bg-blue-50' },
  measure_created:         { icon: ClipboardList, color: 'text-amber-500',  bg: 'bg-amber-50' },
  quote_sent:              { icon: FileText,      color: 'text-orange-500', bg: 'bg-orange-50' },
  sent:                    { icon: FileText,      color: 'text-orange-500', bg: 'bg-orange-50' },
  po_sent:                 { icon: FileText,      color: 'text-amber-500',  bg: 'bg-amber-50' },
  viewed:                  { icon: Eye,           color: 'text-cyan-500',   bg: 'bg-cyan-50' },
  accepted:                { icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
  declined:                { icon: X,             color: 'text-red-500',    bg: 'bg-red-50' },
  job_completed:           { icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
  message:                 { icon: Mail,          color: 'text-slate-500',  bg: 'bg-slate-100' },
  install_request_created: { icon: HardHat,       color: 'text-slate-500',  bg: 'bg-slate-100' },
  install_request_sent:    { icon: HardHat,       color: 'text-blue-500',   bg: 'bg-blue-50' },
  install_accepted:        { icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
  install_declined:        { icon: X,             color: 'text-red-500',    bg: 'bg-red-50' },
};
const ACTIVITY_FALLBACK = { icon: Clock, color: 'text-slate-400', bg: 'bg-slate-100' };

const PIPELINE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Waiting'];

// ─── Date range helpers ────────────────────────────────────────────────────────
function getAusFY(year) {
  return {
    start: new Date(year - 1, 6, 1, 0, 0, 0),
    end:   new Date(year, 5, 30, 23, 59, 59),
  };
}
function getCurrentAusFY() {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  return getAusFY(year);
}
function getPreviousAusFY() {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  return getAusFY(year - 1);
}

const DATE_RANGE_OPTIONS = [
  { value: '30d',    label: 'Last 30 days' },
  { value: '90d',    label: 'Last 90 days' },
  { value: '6m',     label: 'Last 6 months' },
  { value: 'ytd',    label: 'Year to date' },
  { value: 'thisfy', label: 'This financial year' },
  { value: 'prevfy', label: 'Previous financial year' },
  { value: 'prevyr', label: 'Previous calendar year' },
];

function getDateRange(value) {
  const now = new Date();
  switch (value) {
    case '30d':    return { start: subDays(now, 30),   end: now };
    case '90d':    return { start: subDays(now, 90),   end: now };
    case '6m':     return { start: subMonths(now, 6),  end: now };
    case 'ytd':    return { start: startOfYear(now),   end: now };
    case 'thisfy': return getCurrentAusFY();
    case 'prevfy': return getPreviousAusFY();
    case 'prevyr': return {
      start: startOfYear(new Date(now.getFullYear() - 1, 0, 1)),
      end:   endOfYear(new Date(now.getFullYear() - 1, 0, 1)),
    };
    default: return { start: subDays(now, 30), end: now };
  }
}

function getPreviousPeriod(value) {
  const { start, end } = getDateRange(value);
  const duration = end - start;
  return { start: new Date(start - duration), end: new Date(start) };
}

function inRange(dateStr, range) {
  if (!dateStr) return false;
  try {
    return isWithinInterval(parseISO(dateStr), { start: range.start, end: range.end });
  } catch { return false; }
}

function quoteTotal(q) {
  const { total } = computeQuoteTotals(
    q.lineItems || [], q.depositType, q.depositValue,
    q.gstRate, q.includesGST, q.selectedLineItemIds || []
  );
  return total;
}

function pct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function fmt$(value) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
  }).format(value);
}

// Compact currency — keeps large numbers readable inside cards
function fmtCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    const v = value / 1_000_000_000;
    return `$${(abs >= 100_000_000_000 ? v.toFixed(0) : abs >= 10_000_000_000 ? v.toFixed(1) : v.toFixed(2))}B`;
  }
  if (abs >= 1_000_000) {
    const v = value / 1_000_000;
    return `$${(abs >= 100_000_000 ? v.toFixed(0) : abs >= 10_000_000 ? v.toFixed(1) : v.toFixed(2))}M`;
  }
  if (abs >= 100_000) {
    const v = value / 1_000;
    return `$${v.toFixed(0)}K`;
  }
  return fmt$(value);
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function DateRangeSelect({ value, onChange }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg pl-3 pr-7 py-1.5 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
      >
        {DATE_RANGE_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function DeltaBadge({ current, previous }) {
  const change = pct(current, previous);
  const isUp   = change >= 0;
  const Icon   = isUp ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${isUp ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}`}>
      <Icon size={10} />{Math.abs(change).toFixed(0)}%
    </span>
  );
}

// Smooth toggle switch
function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${on ? 'bg-amber-500' : 'bg-slate-200'}`}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function HeroStat({ label, value, icon: Icon, color, bg, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow text-left"
    >
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
        <Icon size={20} className={color} />
      </div>
      <div>
        <div className="text-3xl font-bold text-slate-900">{value}</div>
        <div className="text-sm text-slate-500 mt-0.5">{label}</div>
      </div>
    </button>
  );
}

// ─── Customise panel ──────────────────────────────────────────────────────────
function CustomisePanel({ prefs, onChange, onClose, isAM, larpMode, onLarpToggle }) {
  const allOn = WIDGET_DEFS.every(w => prefs[w.key]);

  return (
    <div
      onClick={e => e.stopPropagation()}   /* prevent clicks inside reaching backdrop */
      className="absolute right-0 top-full mt-2 z-50 w-72 bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="font-semibold text-slate-800 text-sm">Customise Dashboard</span>
        <button
          onClick={() => onChange(Object.fromEntries(WIDGET_DEFS.map(w => [w.key, !allOn])))}
          className="text-xs text-amber-600 hover:underline"
        >
          {allOn ? 'Hide all' : 'Show all'}
        </button>
      </div>
      <div className="divide-y divide-slate-50 max-h-[70vh] overflow-y-auto">
        {WIDGET_DEFS.map(w => (
          <div key={w.key} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{w.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{w.desc}</p>
            </div>
            <Toggle on={prefs[w.key]} onChange={val => onChange({ ...prefs, [w.key]: val })} />
          </div>
        ))}
      </div>

      {/* LARP Mode — Account Managers only */}
      {isAM && (
        <div className="border-t border-slate-200 flex items-center gap-3 px-4 py-3">
          <p className="text-sm font-medium text-slate-800 flex-1">LARP Mode</p>
          <Toggle on={larpMode} onChange={onLarpToggle} />
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
        <p className="text-xs text-slate-400">Preferences saved automatically.</p>
      </div>
    </div>
  );
}

// ─── Today's Schedule ────────────────────────────────────────────────────────
function TodaySchedule({ navigate }) {
  const today    = new Date();
  const tomorrow = addDays(today, 1);
  const requests = getInstallRequests();

  const getEvents = (day) =>
    requests
      .filter(r => r.proposedDate && isSameDay(parseISO(r.proposedDate), day))
      .sort((a, b) => (a.arrivalTime || '').localeCompare(b.arrivalTime || ''));

  const todayEvents    = getEvents(today);
  const tomorrowEvents = getEvents(tomorrow);
  const total          = todayEvents.length + tomorrowEvents.length;

  const EventRow = ({ req }) => {
    const inst = getInstaller(req.installerId);
    const job  = getJob(req.jobId);
    const cust = job ? getCustomer(job.customerId) : null;

    return (
      <button
        onClick={() => navigate(`/jobs/${req.jobId}`)}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left w-full"
      >
        <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
          <HardHat size={14} className="text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{cust?.name || 'Customer'}</p>
          <p className="text-xs text-slate-400 truncate">
            {inst?.name?.split(' ')[0]}
            {req.arrivalTime && ` · ${req.arrivalTime}`}
            {req.suburb && ` · ${req.suburb}`}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
          req.status === 'Accepted' ? 'bg-green-100 text-green-700' :
          req.status === 'Sent'     ? 'bg-blue-100 text-blue-700' :
          'bg-slate-100 text-slate-600'
        }`}>{req.status}</span>
      </button>
    );
  };

  const DaySection = ({ label, events, accent }) => (
    <div>
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-slate-100`}>
        <CalendarDays size={13} className={accent} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${accent}`}>{label}</span>
        <span className="ml-auto text-xs text-slate-400">{events.length} install{events.length !== 1 ? 's' : ''}</span>
      </div>
      {events.length > 0
        ? events.map(r => <EventRow key={r.id} req={r} />)
        : <p className="px-4 py-3 text-xs text-slate-400 italic">No installs scheduled</p>
      }
    </div>
  );

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <CalendarDays size={15} className="text-amber-500" /> Today's Schedule
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{format(today, 'EEE d MMM')}</span>
          <button onClick={() => navigate('/calendar')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
            Full calendar <ArrowRight size={12} />
          </button>
        </div>
      </div>
      <DaySection label="Today"    events={todayEvents}    accent="text-amber-500" />
      <DaySection label="Tomorrow" events={tomorrowEvents} accent="text-slate-400" />
    </Card>
  );
}

// ─── Monthly Revenue Trend ─────────────────────────────────────────────────────
function MonthlyTrend({ quotes, navigate, larpMul = 1 }) {
  const now    = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return {
      label: format(d, 'MMM'),
      year:  d.getFullYear(),
      month: d.getMonth(),
      start: new Date(d.getFullYear(), d.getMonth(), 1),
      end:   new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
    };
  });

  const data = months.map(m => {
    const accepted = quotes.filter(q =>
      q.status === 'Accepted' &&
      inRange(q.acceptedAt || q.updatedAt, { start: m.start, end: m.end })
    );
    return { ...m, value: accepted.reduce((s, q) => s + quoteTotal(q), 0), count: accepted.length };
  });

  const maxVal   = Math.max(...data.map(d => d.value), 1);
  const totalVal = data.reduce((s, d) => s + d.value, 0);
  const bestMon  = data.reduce((best, d) => d.value > best.value ? d : best, data[0]);

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <BarChart2 size={15} className="text-amber-500" /> Monthly Revenue Trend
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Last 12 months · {fmt$(totalVal * larpMul)} total</p>
        </div>
        {bestMon.value > 0 && (
          <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">
            Best: {bestMon.label} {bestMon.value !== totalVal && fmt$(bestMon.value * larpMul)}
          </span>
        )}
      </div>
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-end gap-1.5 h-28">
          {data.map((m, i) => {
            const barPct = maxVal > 0 ? (m.value / maxVal) * 100 : 0;
            const isCurrent = m.year === now.getFullYear() && m.month === now.getMonth();
            const isBest    = m.value === bestMon.value && m.value > 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                <div className="w-full flex items-end justify-center" style={{ height: '90px' }}>
                  <div
                    className={`w-full rounded-t-md transition-all duration-500 ${
                      isBest    ? 'bg-amber-500 hover:bg-amber-400' :
                      isCurrent ? 'bg-teal-400 hover:bg-teal-300' :
                                  'bg-slate-200 hover:bg-slate-300'
                    }`}
                    style={{ height: `${Math.max(barPct, barPct > 0 ? 5 : 0)}%` }}
                    title={`${m.label}: ${fmt$(m.value * larpMul)} (${m.count} quotes)`}
                  />
                </div>
                <span className={`text-[10px] truncate w-full text-center ${isCurrent ? 'text-teal-600 font-semibold' : 'text-slate-400'}`}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-50">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-amber-500" /><span className="text-xs text-slate-500">Best month</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-teal-400" /><span className="text-xs text-slate-500">Current month</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-slate-200" /><span className="text-xs text-slate-500">Other months</span></div>
        </div>
      </div>
    </Card>
  );
}

// ─── Stalled Jobs ─────────────────────────────────────────────────────────────
function StalledJobs({ jobs, customers, navigate }) {
  const STALL_DAYS  = 14;
  const TERMINAL    = ['Completed', 'Cancelled'];
  const now         = new Date();

  const stalled = jobs
    .filter(j => !TERMINAL.includes(j.status) && j.updatedAt)
    .map(j => ({ ...j, daysSince: differenceInDays(now, parseISO(j.updatedAt)) }))
    .filter(j => j.daysSince >= STALL_DAYS)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, 8);

  if (stalled.length === 0) {
    return (
      <Card>
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" /> Stalled Jobs
          </h2>
        </div>
        <div className="px-5 py-8 text-center">
          <CheckCircle2 size={28} className="text-green-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500 font-medium">All jobs are moving</p>
          <p className="text-xs text-slate-400 mt-0.5">No jobs have been inactive for {STALL_DAYS}+ days.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" /> Stalled Jobs
            <span className="text-xs font-medium bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{stalled.length}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">No activity for {STALL_DAYS}+ days</p>
        </div>
        <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
          View all <ArrowRight size={12} />
        </button>
      </div>
      <div className="divide-y divide-slate-50">
        {stalled.map(job => {
          const cust  = customers.find(c => c.id === job.customerId);
          const urgency = job.daysSince >= 30 ? 'high' : job.daysSince >= 21 ? 'med' : 'low';
          return (
            <button
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                urgency === 'high' ? 'bg-red-50' : urgency === 'med' ? 'bg-orange-50' : 'bg-yellow-50'
              }`}>
                <Clock size={14} className={
                  urgency === 'high' ? 'text-red-500' : urgency === 'med' ? 'text-orange-500' : 'text-yellow-600'
                } />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{cust?.name || 'Customer'}</p>
                <p className="text-xs text-slate-400">{job.jobNumber} · {job.status}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded-lg flex-shrink-0 ${
                urgency === 'high' ? 'bg-red-50 text-red-600' :
                urgency === 'med'  ? 'bg-orange-50 text-orange-600' :
                                     'bg-yellow-50 text-yellow-700'
              }`}>
                {job.daysSince}d
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Needs Attention ──────────────────────────────────────────────────────────
// Action-first summary band: rolls up the things waiting on someone. Only shows
// buckets with a non-zero count; when everything's clear it shows an all-caught-up
// state. `infl` keeps the figures consistent with LARP mode when it's on.
function NeedsAttention({ jobs, quotes, navigate, infl }) {
  const now      = new Date();
  const TERMINAL = ['Completed', 'Cancelled'];

  const stalled = jobs.filter(j =>
    !TERMINAL.includes(j.status) && j.updatedAt &&
    differenceInDays(now, parseISO(j.updatedAt)) >= 14
  ).length;
  const quotesOut     = quotes.filter(q => ['Sent', 'Viewed'].includes(q.status)).length;
  const pendingInstalls = getInstallRequests().filter(r => r.status === 'Sent').length;

  const items = [
    { key: 'stalled',  count: stalled,         label: 'Stalled jobs',     sub: 'No activity 14+ days', icon: AlertTriangle, color: 'text-red-500',   bg: 'bg-red-50',   onClick: () => navigate('/jobs') },
    { key: 'quotesOut', count: quotesOut,      label: 'Quotes out',       sub: 'Awaiting customer',    icon: Clock,         color: 'text-amber-600', bg: 'bg-amber-50', onClick: () => navigate('/quotes') },
    { key: 'install',  count: pendingInstalls, label: 'Install requests', sub: 'Awaiting installer',   icon: HardHat,       color: 'text-blue-600',  bg: 'bg-blue-50',  onClick: () => navigate('/calendar') },
  ].filter(i => i.count > 0);

  if (items.length === 0) {
    return (
      <Card className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={18} className="text-green-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">You're all caught up</p>
          <p className="text-xs text-slate-400">Nothing is waiting on action right now.</p>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold text-slate-800">Needs Attention</h2>
        <span className="text-xs font-medium bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
          {infl(items.reduce((s, i) => s + i.count, 0))}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {items.map(({ icon: Icon, ...i }) => (
          <button
            key={i.key}
            onClick={i.onClick}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow text-left"
          >
            <div className={`w-10 h-10 rounded-xl ${i.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={20} className={i.color} />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-bold text-slate-900 leading-none">{infl(i.count)}</div>
              <div className="text-sm font-medium text-slate-700 mt-1 truncate">{i.label}</div>
              <div className="text-xs text-slate-400 truncate">{i.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  useDataRefresh();
  const navigate  = useNavigate();
  const { isAM = true, displayName = '', isSP } = useProfile() || {};
  const jobs      = getJobsFiltered(isAM, displayName);
  const customers = getCustomersFiltered(isAM, displayName);
  const activity  = getActivity();
  const quotes    = getQuotesFiltered(isAM, displayName);

  const [globalRange, setGlobalRange] = useState('thisfy');
  const [prefs, setPrefs]             = useState(loadPrefs);
  const [larpMode, setLarpMode]       = useState(loadLarp);
  const [showCustomise, setShowCustomise] = useState(false);

  // Escape key closes the customise panel
  useEffect(() => {
    if (!showCustomise) return;
    const handler = (e) => { if (e.key === 'Escape') setShowCustomise(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showCustomise]);

  const updatePrefs = (next) => { setPrefs(next); savePrefs(next); };
  const updateLarp  = (v)    => { setLarpMode(v); saveLarp(v); };

  // Inflation helpers — only active for AMs with larpMode on; never touch real data
  const larpActive = larpMode && isAM;
  const lI = (n) => larpActive ? Math.round((n || 0) * 87)  : (n || 0);
  const lM = (v) => larpActive ? ((v || 0) * 237)           : (v || 0);
  const lW = (p) => (larpActive && p !== null) ? Math.min(100, p * 1.5) : p;
  const larpMul = larpActive ? 237 : 1;

  const visible = (key) => prefs[key] !== false;

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const counts = {};
    jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });
    const active = jobs.filter(j => !['Completed','Cancelled'].includes(j.status)).length;
    const urgent = jobs.filter(j => ['Urgent','High'].includes(j.urgency)).length;
    const awaitingApproval = counts['Awaiting Approval'] || 0;
    return { counts, active, urgent, awaitingApproval };
  }, [jobs]);

  // Installs booked over the next 7 days (excludes declined/cancelled requests)
  const installsThisWeek = (() => {
    const start = startOfDay(new Date());
    const end   = addDays(start, 7);
    return getInstallRequests().filter(r =>
      r.proposedDate &&
      !['Declined', 'Cancelled'].includes(r.status) &&
      inRange(r.proposedDate, { start, end })
    ).length;
  })();

  const recentJobs = useMemo(() =>
    [...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5),
    [jobs]
  );

  const recentActivity = useMemo(() =>
    [...activity].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    [activity]
  );

  // ── Quote analytics ────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const range = getDateRange(globalRange);
    const prev  = getPreviousPeriod(globalRange);

    // Pipeline
    const pipelineQuotes = quotes.filter(q => PIPELINE_STATUSES.includes(q.status));
    const pipelineValue  = pipelineQuotes.reduce((s, q) => s + quoteTotal(q), 0);
    const pipelineByStatus = PIPELINE_STATUSES.map(status => ({
      status,
      count: pipelineQuotes.filter(q => q.status === status).length,
      value: pipelineQuotes.filter(q => q.status === status).reduce((s, q) => s + quoteTotal(q), 0),
    }));

    // Accepted in range
    const accepted     = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));
    const acceptedPrev = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, prev));
    const acceptedValue     = accepted.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedValuePrev = acceptedPrev.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedAvg       = accepted.length > 0 ? acceptedValue / accepted.length : 0;

    // Win rate = Accepted / (Accepted + Declined) in range
    const declined     = quotes.filter(q => q.status === 'Declined' && inRange(q.updatedAt, range));
    const declinedPrev = quotes.filter(q => q.status === 'Declined' && inRange(q.updatedAt, prev));
    const decisions     = accepted.length + declined.length;
    const decisionsPrev = acceptedPrev.length + declinedPrev.length;
    const winRate     = decisions > 0     ? (accepted.length / decisions) * 100         : null;
    const winRatePrev = decisionsPrev > 0 ? (acceptedPrev.length / decisionsPrev) * 100 : null;

    // Yearly (last 5 Aus FYs)
    const currentYear = new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const yearlyRows  = [];
    for (let y = currentYear; y >= currentYear - 4; y--) {
      const fy      = getAusFY(y);
      const fyQ     = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, fy));
      const fyValue = fyQ.reduce((s, q) => s + quoteTotal(q), 0);
      yearlyRows.push({
        label: `FY${String(y - 1).slice(-2)}/${String(y).slice(-2)}`,
        year: y, count: fyQ.length, value: fyValue,
        avg: fyQ.length > 0 ? fyValue / fyQ.length : 0,
      });
    }
    const maxValue = Math.max(...yearlyRows.map(r => r.value), 1);

    return {
      pipelineValue, pipelineByStatus, pipelineCount: pipelineQuotes.length,
      acceptedCount: accepted.length, acceptedCountPrev: acceptedPrev.length,
      acceptedValue, acceptedValuePrev, acceptedAvg,
      winRate, winRatePrev, decisions, decisionsPrev,
      yearlyRows, maxValue,
    };
  }, [quotes, globalRange]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Customise backdrop ───────────────────────────────────────────────
           Fixed fullscreen layer that sits BEHIND the panel (z-40) but ABOVE
           the rest of the page. Clicking it closes the panel and consumes the
           click so nothing underneath activates. */}
      {showCustomise && (
        <div
          className="fixed inset-0 z-40"
          aria-hidden="true"
          onClick={() => setShowCustomise(false)}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {/* Single row at all sizes — Customise stays right-aligned, never stacks */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          {isSP ? (
            <p className="text-slate-500 text-sm mt-0.5">Welcome back, {displayName} — your personal pipeline.</p>
          ) : (
            <p className="text-slate-500 text-sm mt-0.5">Welcome back — here's your business at a glance.</p>
          )}
          {isAM && (
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 mt-1">
              Full team view
            </span>
          )}
        </div>
        {/* Customise button — icon-only on mobile, labelled on sm+ */}
        <div className="relative z-50 flex-shrink-0">
          <button
            onClick={() => setShowCustomise(v => !v)}
            className={`flex items-center gap-2 text-sm font-medium rounded-lg px-3 sm:px-4 py-2.5 border transition-colors ${
              showCustomise
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal size={15} />
            <span className="hidden sm:inline">Customise</span>
          </button>
          {showCustomise && (
            <CustomisePanel
              prefs={prefs}
              onChange={updatePrefs}
              onClose={() => setShowCustomise(false)}
              isAM={isAM}
              larpMode={larpMode}
              onLarpToggle={updateLarp}
            />
          )}
        </div>
      </div>

      {/* ── LARP Mode indicator ──────────────────────────────────────────────── */}
      {larpActive && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-semibold text-amber-700 tracking-wide uppercase">LARP</span>
          </div>
          <button
            onClick={() => updateLarp(false)}
            className="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors"
          >
            Disable
          </button>
        </div>
      )}

      {/* ── Hero stats (always visible) ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroStat label="Active Jobs"            value={lI(stats.active)}            icon={Briefcase}     color="text-amber-600" bg="bg-amber-50"  onClick={() => navigate('/jobs')} />
        <HeroStat label="Awaiting Approval"      value={lI(stats.awaitingApproval)}  icon={Clock}         color="text-blue-600"  bg="bg-blue-50"   onClick={() => navigate(`/jobs?status=${encodeURIComponent('Awaiting Approval')}`)} />
        <HeroStat label="Urgent / High Priority" value={lI(stats.urgent)}            icon={AlertTriangle} color="text-red-500"   bg="bg-red-50"    onClick={() => navigate('/jobs')} />
        <HeroStat label="Installs This Week"     value={lI(installsThisWeek)}        icon={HardHat}       color="text-teal-600"  bg="bg-teal-50"   onClick={() => navigate('/calendar')} />
      </div>

      {/* ── Needs Attention (action-first) ───────────────────────────────────── */}
      {visible('needsAttention') && <NeedsAttention jobs={jobs} quotes={quotes} navigate={navigate} infl={lI} />}

      {/* ── Today's Schedule ─────────────────────────────────────────────────── */}
      {visible('todaySchedule') && <TodaySchedule navigate={navigate} />}

      {/* ── Stalled Jobs ─────────────────────────────────────────────────────── */}
      {visible('stalledJobs') && <StalledJobs jobs={jobs} customers={customers} navigate={navigate} />}

      {/* ── Sales Performance ────────────────────────────────────────────────── */}
      {visible('salesPerformance') && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Sales Performance</h2>
            <DateRangeSelect value={globalRange} onChange={setGlobalRange} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Win Rate */}
            <Card className="p-5 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Percent size={17} className="text-purple-600" />
                </div>
                {analytics.winRate !== null && analytics.winRatePrev !== null && (
                  <DeltaBadge current={analytics.winRate} previous={analytics.winRatePrev} />
                )}
              </div>
              <div>
                <div className="text-3xl font-bold text-slate-900">
                  {analytics.winRate !== null ? `${lW(analytics.winRate).toFixed(0)}%` : '—'}
                </div>
                <div className="text-sm text-slate-500 mt-0.5">Win Rate</div>
              </div>
              <div className="text-xs text-slate-400">
                {analytics.decisions > 0
                  ? `${lI(analytics.decisions)} decision${lI(analytics.decisions) !== 1 ? 's' : ''} in period`
                  : 'No accepted/declined quotes yet'}
              </div>
            </Card>

            {/* Quotes Accepted */}
            <Card className="p-5 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                  <CheckCircle2 size={18} className="text-green-600" />
                </div>
                <DeltaBadge current={analytics.acceptedCount} previous={analytics.acceptedCountPrev} />
              </div>
              <div>
                <div className="text-3xl font-bold text-slate-900">{lI(analytics.acceptedCount)}</div>
                <div className="text-sm text-slate-500 mt-0.5">Quotes Accepted</div>
              </div>
              <div className="text-xs text-slate-400">vs {lI(analytics.acceptedCountPrev)} in previous period</div>
            </Card>

            {/* Pipeline Value */}
            <Card className="p-5 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <BarChart2 size={18} className="text-blue-600" />
                </div>
                <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex-shrink-0">
                  {lI(analytics.pipelineCount)} active
                </span>
              </div>
              <div className="min-w-0">
                <div
                  className="text-3xl font-bold text-slate-900 leading-tight truncate"
                  title={fmt$(lM(analytics.pipelineValue))}
                >
                  {fmtCompact(lM(analytics.pipelineValue))}
                </div>
                <div className="text-sm text-slate-500 mt-0.5">Pipeline Value</div>
                {/* Show full value as subtitle when compact kicks in */}
                {Math.abs(lM(analytics.pipelineValue)) >= 100_000 && (
                  <div className="text-xs text-slate-400 mt-0.5 tabular-nums">{fmt$(lM(analytics.pipelineValue))}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {analytics.pipelineByStatus.filter(s => s.count > 0).map(s => (
                  <span key={s.status} className="text-xs text-slate-400">
                    <span className="font-medium text-slate-600">{lI(s.count)}</span> {s.status}
                  </span>
                ))}
              </div>
            </Card>

            {/* Accepted Value */}
            <Card className="p-5 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={18} className="text-amber-600" />
                </div>
                <DeltaBadge current={analytics.acceptedValue} previous={analytics.acceptedValuePrev} />
              </div>
              <div className="min-w-0">
                <div
                  className="text-3xl font-bold text-slate-900 leading-tight truncate"
                  title={fmt$(lM(analytics.acceptedValue))}
                >
                  {fmtCompact(lM(analytics.acceptedValue))}
                </div>
                <div className="text-sm text-slate-500 mt-0.5">Accepted Quote Value</div>
                {Math.abs(lM(analytics.acceptedValue)) >= 100_000 && (
                  <div className="text-xs text-slate-400 mt-0.5 tabular-nums">{fmt$(lM(analytics.acceptedValue))}</div>
                )}
              </div>
              <div className="text-xs text-slate-400 min-w-0 truncate">
                Avg {fmtCompact(lM(analytics.acceptedAvg))} · vs {fmtCompact(lM(analytics.acceptedValuePrev))} prior
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Monthly Revenue Trend ─────────────────────────────────────────────── */}
      {visible('monthlyTrend') && <MonthlyTrend quotes={quotes} navigate={navigate} larpMul={larpMul} />}

      {/* ── Yearly Performance ───────────────────────────────────────────────── */}
      {visible('yearlyPerformance') && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">Yearly Performance</h2>
            <button onClick={() => navigate('/quotes')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
              View quotes <ArrowRight size={12} />
            </button>
          </div>
          <div className="px-5 pt-5 pb-2">
            <div className="flex items-end gap-2 h-24">
              {analytics.yearlyRows.map(row => {
                const barPct = analytics.maxValue > 0 ? (row.value / analytics.maxValue) * 100 : 0;
                return (
                  <div key={row.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full flex items-end" style={{ height: '80px' }}>
                      <div
                        className="w-full bg-amber-400 rounded-t-md transition-all duration-500 hover:bg-amber-500"
                        style={{ height: `${Math.max(barPct, barPct > 0 ? 4 : 0)}%` }}
                        title={`${row.label}: ${fmt$(lM(row.value))}`}
                      />
                    </div>
                    <span className="text-xs text-slate-400 truncate w-full text-center">{row.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="px-5 py-2.5 text-left font-medium text-slate-500 text-xs">Year</th>
                  <th className="px-5 py-2.5 text-right font-medium text-slate-500 text-xs">Accepted</th>
                  <th className="px-5 py-2.5 text-right font-medium text-slate-500 text-xs">Total Value</th>
                  <th className="px-5 py-2.5 text-right font-medium text-slate-500 text-xs">Average</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {analytics.yearlyRows.map(row => (
                  <tr key={row.year} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-700">{row.label}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{lI(row.count)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">{fmt$(lM(row.value))}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{row.count > 0 ? fmt$(lM(row.avg)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Job Pipeline ─────────────────────────────────────────────────────── */}
      {visible('jobPipeline') && (() => {
        const phases = [
          { label: 'Discovery', bar: 'bg-slate-400',  text: 'text-slate-500',  keys: ['New Enquiry', 'Measure Booked', 'Measured'] },
          { label: 'Quoting',   bar: 'bg-blue-400',   text: 'text-blue-600',   keys: ['Quote Required', 'Quoted', 'Awaiting Approval'] },
          { label: 'Active',    bar: 'bg-amber-500',  text: 'text-amber-600',  keys: ['Approved', 'Ordered', 'Installation Booked'] },
          { label: 'Done',      bar: 'bg-green-500',  text: 'text-green-600',  keys: ['Installed', 'Completed'] },
        ];
        const dc = larpActive
          ? Object.fromEntries(Object.entries(stats.counts).map(([k, v]) => [k, Math.round(v * 91)]))
          : stats.counts;
        const maxCount = Math.max(...STAT_GROUPS.map(s => dc[s.key] || 0), 1);
        const total = STAT_GROUPS.reduce((sum, s) => sum + (dc[s.key] || 0), 0);
        return (
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-slate-800 text-sm">Job Pipeline</h2>
                <span className="text-xs text-slate-400">{total} total</span>
              </div>
              <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                View all <ArrowRight size={12} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-5">
              {phases.map(phase => {
                const phaseTotal = phase.keys.reduce((sum, k) => sum + (dc[k] || 0), 0);
                return (
                  <div key={phase.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] font-bold tracking-widest uppercase ${phase.text}`}>{phase.label}</span>
                      <span className="text-xs text-slate-400">{phaseTotal} job{phaseTotal !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-1.5">
                      {phase.keys.map(key => {
                        const count = dc[key] || 0;
                        const barWidth = `${Math.max((count / maxCount) * 100, count > 0 ? 3 : 0)}%`;
                        return (
                          <button
                            key={key}
                            onClick={() => navigate(`/jobs?status=${encodeURIComponent(key)}`)}
                            className="w-full flex items-center gap-3 py-1 hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors text-left"
                          >
                            <span className="text-xs text-slate-600 w-36 flex-shrink-0 truncate">{key}</span>
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full ${phase.bar} rounded-full transition-all duration-500`} style={{ width: barWidth }} />
                            </div>
                            <span className={`text-sm font-bold w-6 text-right tabular-nums ${count > 0 ? 'text-slate-800' : 'text-slate-300'}`}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* ── Recent Jobs + Activity ────────────────────────────────────────────── */}
      {(visible('recentJobs') || visible('recentActivity')) && (
        <div className={`grid gap-6 ${visible('recentJobs') && visible('recentActivity') ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>

          {visible('recentJobs') && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 text-sm">Recent Jobs</h2>
                <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                  View all <ArrowRight size={12} />
                </button>
              </div>
              <div className="divide-y divide-slate-50">
                {recentJobs.map(job => {
                  const customer = customers.find(c => c.id === job.customerId);
                  return (
                    <button
                      key={job.id}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-amber-700 font-bold text-xs">{customer?.name?.charAt(0) || 'J'}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-slate-800 truncate">{customer?.name}</div>
                        <div className="text-xs text-slate-400 truncate">{job.jobNumber} · {job.jobType}</div>
                      </div>
                      <StatusBadge status={job.status} size="sm" />
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {visible('recentActivity') && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm">Recent Activity</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {recentActivity.map(act => {
                  const { icon: Icon, color, bg } = ACTIVITY_ICONS[act.type] || ACTIVITY_FALLBACK;
                  const job      = jobs.find(j => j.id === act.jobId);
                  const customer = job ? customers.find(c => c.id === job.customerId) : null;
                  return (
                    <button
                      key={act.id}
                      onClick={() => act.jobId && navigate(`/jobs/${act.jobId}`)}
                      className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon size={13} className={color} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-slate-700">{act.message}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {customer?.name && <span className="font-medium">{customer.name} · </span>}
                          {act.user} · {formatDistanceToNow(parseISO(act.createdAt), { addSuffix: true })}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}

    </div>
  );
}
