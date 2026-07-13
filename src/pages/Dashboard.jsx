import { useDataRefresh } from '../hooks/useDataRefresh';
import { useMountAnimation } from '../hooks/useMountAnimation';
import { useMemo, useState, useEffect, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatDistanceToNow, parseISO, isWithinInterval,
  subDays, subMonths, subYears, startOfYear,
  format, differenceInDays,
} from 'date-fns';
import {
  Briefcase, ClipboardList, CheckCircle2, Clock,
  AlertTriangle, TrendingUp, TrendingDown, Users, ArrowRight, Plus,
  DollarSign, ChevronDown, BarChart2, HardHat, Percent,
  SlidersHorizontal, Eye, EyeOff, FileText, X, Mail, Target, Package,
  Pencil, Trophy, CalendarDays, Timer, FileDown,
} from 'lucide-react';
import {
  getJobsFiltered, getCustomersFiltered, getActivity,
  getQuotesFiltered, computeQuoteTotals, calcItemPricing,
  getInstallRequests, getCalendarEvents, JOB_STATUSES, isStalledJob,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';
import { DonutChart, AreaChart, Sparkline } from '../components/DashboardCharts';
import { PrivacyCtx, Fig } from '../components/PrivacyFig';
import { PIPELINE_RAMP } from '../lib/chartColors';
import { categorizeProduct } from '../lib/productCategories';
import { downloadDashboardReport } from '../lib/dashboardReport';

// Chart accent follows the active colour theme (Apex emerald by default).
const ACCENT = 'var(--brand-500)';
const LARP_KEY = 'lusso_larp_mode';

function loadLarp() {
  try { return localStorage.getItem(LARP_KEY) === 'true'; }
  catch { return false; }
}
function saveLarp(v) { localStorage.setItem(LARP_KEY, v ? 'true' : 'false'); }

// Ordered job pipeline stages (label === status key). Derived from the
// canonical status ladder so new statuses appear automatically; Cancelled is
// excluded — it's an exit, not a stage. Coloured via PIPELINE_RAMP.
const PIPELINE_STAGES = JOB_STATUSES.filter(s => s !== 'Cancelled');

// Quote statuses that count as "in the pipeline" (sent, not yet decided).
const PIPELINE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Waiting'];

// Activity feed icons — covers every activity type the app emits.
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
];

// Calendar-year values look like 'yr2015' (rendered as their own optgroup).
const yearValue = (value) => /^yr(\d{4})$/.exec(value)?.[1];

function getDateRange(value) {
  const now = new Date();
  const yr = yearValue(value);
  if (yr) {
    const y = Number(yr);
    return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59) };
  }
  switch (value) {
    case '30d':    return { start: subDays(now, 30),   end: now };
    case '90d':    return { start: subDays(now, 90),   end: now };
    case '6m':     return { start: subMonths(now, 6),  end: now };
    case 'ytd':    return { start: startOfYear(now),   end: now };
    case 'thisfy': return getCurrentAusFY();
    case 'prevfy': return getPreviousAusFY();
    default: return { start: subDays(now, 30), end: now };
  }
}

// Comparison period = the SAME window one year earlier (seasonal business —
// June should compare with last June, not with May).
function getPreviousPeriod(value) {
  const yr = yearValue(value);
  if (yr) return getDateRange(`yr${Number(yr) - 1}`); // vs the prior calendar year
  const { start, end } = getDateRange(value);
  return { start: subYears(start, 1), end: subYears(end, 1) };
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

// Line items that actually count toward a quote's total (mirrors computeQuoteTotals).
function activeLineItems(q) {
  const selected = q.selectedLineItemIds || [];
  return (q.lineItems || []).filter(li =>
    li.type === 'Required' || li.type === 'Part' ||
    ((li.type === 'Optional' || li.type === 'Multiple Choice') && selected.includes(li.id))
  );
}

// Per-line revenue — new pricing model when present, legacy fallback otherwise.
function lineItemRevenue(li) {
  if (li.unitCostPrice !== undefined) {
    const { lineTotal } = calcItemPricing(li.unitCostPrice, li.labourCost, li.marginPercent, li.manualSellPrice, li.quantity);
    return lineTotal;
  }
  return ((Number(li.unitPrice) || 0) + (Number(li.labourCost) || 0)) * (Number(li.quantity) || 1);
}

// ─── Monthly targets (persisted) ───────────────────────────────────────────────
const TARGETS_KEY = 'lusso_dashboard_targets';
const DEFAULT_TARGETS = { revenue: 50000, quotesWon: 10, newCustomers: 8 };
function loadTargets() {
  try { return { ...DEFAULT_TARGETS, ...JSON.parse(localStorage.getItem(TARGETS_KEY)) }; }
  catch { return DEFAULT_TARGETS; }
}
function saveTargets(t) { localStorage.setItem(TARGETS_KEY, JSON.stringify(t)); }

// Quote status pill colours (quote statuses aren't in the job StatusBadge map).
const QUOTE_STATUS_STYLE = {
  Accepted: 'bg-green-100 text-green-700',
  Declined: 'bg-red-100 text-red-600',
  Sent:     'bg-blue-100 text-blue-700',
  Viewed:   'bg-cyan-100 text-cyan-700',
  Waiting:  'bg-amber-100 text-amber-700',
  Draft:    'bg-slate-100 text-slate-600',
};

function pct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function fmt$(value) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
  }).format(value);
}

function fmtCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000)     return `$${Math.round(value / 1_000)}K`;
  return fmt$(value);
}

// ─── Small shared UI ───────────────────────────────────────────────────────────
function DateRangeSelect({ value, onChange, years = [] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 rounded-lg pl-3 pr-7 py-2 border border-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
      >
        {DATE_RANGE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        {years.length > 0 && (
          <optgroup label="Calendar years">
            {years.map(y => <option key={y} value={`yr${y}`}>{y}</option>)}
          </optgroup>
        )}
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
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isUp ? 'text-green-600' : 'text-red-500'}`}>
      <Icon size={12} /><Fig>{Math.abs(change).toFixed(1)}%</Fig>
    </span>
  );
}

// Count-up number (Apex-style). Animates 0 → value on mount / value change,
// eased out over ~0.9s. `format` turns the interpolated number into display text.
function CountUp({ value, format = (v) => v }) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [display, setDisplay] = useState(0);
  const rafRef = useRef();
  useEffect(() => {
    if (reduced) return;
    const from = 0, dur = 900, t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, reduced]);
  return <>{format(reduced ? value : display)}</>;
}

// Apex-style KPI stat card: label + icon, big value, delta + caption, sparkline.
// Pass `raw` (number) + `format` to get the count-up animation; `value` is the
// static fallback for non-numeric values ("—").
function StatCard({ icon: Icon, label, value, raw, format, valueTitle, delta, caption, spark, sparkColor = ACCENT, onClick, delay = 0 }) {
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-fade-up bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 text-left hover:shadow-md transition-shadow flex flex-col min-w-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-500 font-medium truncate">{label}</span>
        <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Icon size={15} className="text-slate-500" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900 truncate" title={valueTitle}>
        <Fig>{raw !== undefined ? <CountUp value={raw} format={format} /> : value}</Fig>
      </div>
      <div className="mt-1 flex items-center gap-1.5 min-w-0 text-xs">
        {delta}
        <span className="text-slate-400 truncate">{caption}</span>
      </div>
      {spark && spark.length > 1 && (
        /* mt-auto bottom-aligns the sparkline in every card, so a card whose
           caption wraps to one line doesn't show a hole under the numbers */
        <div className="mt-auto pt-3 -mb-1"><Sparkline values={spark} color={sparkColor} height={34} /></div>
      )}
    </button>
  );
}

// ─── Needs Attention ──────────────────────────────────────────────────────────
function NeedsAttention({ jobs, quotes, navigate, infl }) {
  const stalled = jobs.filter(isStalledJob).length;
  const quotesOut       = quotes.filter(q => ['Sent', 'Viewed'].includes(q.status)).length;
  const pendingInstalls = getInstallRequests().filter(r => r.status === 'Sent').length;

  // Projects ready to install but with nothing booked yet — mirrors the
  // calendar's "needing installation scheduling" list.
  const installReqs   = getInstallRequests();
  const installEvents = getCalendarEvents().filter(e => e.eventType === 'install' && !e.deletedAt);
  const needsScheduling = jobs.filter(j =>
    ['Received', 'Approved', 'Ordered'].includes(j.status) &&
    !installReqs.some(r => r.jobId === j.id && r.status !== 'Declined' && r.status !== 'Cancelled') &&
    !installEvents.some(e => e.jobId === j.id)
  ).length;

  const items = [
    { key: 'stalled',    count: stalled,         label: 'Stalled projects', sub: 'No activity 14+ days',  icon: AlertTriangle, color: 'text-red-500',   bg: 'bg-red-50',   onClick: () => navigate('/jobs?stalled=1') },
    { key: 'schedule',   count: needsScheduling, label: 'Needs scheduling', sub: 'Ready, no install booked', icon: CalendarDays, color: 'text-teal-600',  bg: 'bg-teal-50',  onClick: () => navigate('/calendar') },
    { key: 'quotesOut',  count: quotesOut,       label: 'Quotes out',       sub: 'Awaiting customer',     icon: Clock,         color: 'text-amber-600', bg: 'bg-amber-50', onClick: () => navigate('/jobs') },
    { key: 'install',    count: pendingInstalls, label: 'Install requests', sub: 'Awaiting installer',    icon: HardHat,       color: 'text-blue-600',  bg: 'bg-blue-50',  onClick: () => navigate('/calendar') },
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
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

// ─── Targets (Apex "Revenue Targets" / "Quarterly Targets") ───────────────────
function ProgressRow({ label, current, target, fmt = (v) => v, color = 'bg-amber-500' }) {
  const mounted = useMountAnimation();
  const pctDone = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-400 tabular-nums">
          <Fig><span className="text-slate-800 font-semibold">{fmt(current)}</span> / {fmt(target)}</Fig>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: mounted ? `${pctDone}%` : '0%', transition: 'width 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.15s' }}
        />
      </div>
      <div className="mt-1 text-right text-xs text-slate-400 tabular-nums">{pctDone.toFixed(0)}%</div>
    </div>
  );
}

function TargetsCard({ revenue, quotesWon, newCustomers, lM, lI }) {
  const [targets, setTargets] = useState(loadTargets);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(targets);

  const startEdit = () => { setDraft(targets); setEditing(true); };
  const save = () => {
    const next = {
      revenue:      Math.max(0, Number(draft.revenue)      || 0),
      quotesWon:    Math.max(0, Number(draft.quotesWon)    || 0),
      newCustomers: Math.max(0, Number(draft.newCustomers) || 0),
    };
    setTargets(next); saveTargets(next); setEditing(false);
  };

  return (
    <Card className="min-w-0">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Target size={15} className="text-amber-500" /> Monthly Targets
        </h2>
        {editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            <button onClick={save} className="text-xs font-semibold text-amber-600 hover:text-amber-700">Save</button>
          </div>
        ) : (
          <button onClick={startEdit} title="Edit targets" className="text-slate-300 hover:text-slate-500 p-1 transition-colors">
            <Pencil size={13} />
          </button>
        )}
      </div>
      <div className="p-5 space-y-5">
        {editing ? (
          <>
            {[
              { key: 'revenue',      label: 'Revenue ($)' },
              { key: 'quotesWon',    label: 'Quotes won' },
              { key: 'newCustomers', label: 'New customers' },
            ].map(f => (
              <label key={f.key} className="block">
                <span className="text-xs font-medium text-slate-500">{f.label}</span>
                <input
                  type="number" min="0" value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </label>
            ))}
          </>
        ) : (
          <>
            <ProgressRow label="Revenue"       current={lM(revenue)}    target={lM(targets.revenue)} fmt={fmtCompact} color="bg-amber-500" />
            <ProgressRow label="Quotes won"    current={lI(quotesWon)}    target={lI(targets.quotesWon)}    color="bg-green-500" />
            <ProgressRow label="New customers" current={lI(newCustomers)} target={lI(targets.newCustomers)} color="bg-blue-500" />
            <p className="text-xs text-slate-400">Progress this calendar month.</p>
          </>
        )}
      </div>
    </Card>
  );
}

// ─── Top Products (Apex "Top Selling Products") ────────────────────────────────
// Category rows expand to the individual products inside them (item codes),
// each with units, average unit price and revenue.
const SUB_LIMIT = 10;
function TopProducts({ products, lM, lI }) {
  const maxRev = Math.max(1, ...products.map(p => p.revenue));
  const [expanded, setExpanded] = useState(new Set());
  const toggle = (name) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Package size={15} className="text-amber-500" /> Top Products
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Accepted revenue by product category</p>
      </div>
      {products.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-400">No accepted quotes in this period.</p>
      ) : (
        <>
        {/* Phone: stacked rows — no sideways scrolling */}
        <div className="sm:hidden divide-y divide-slate-50">
          {products.map((p, i) => (
            <div key={p.name}>
              <button onClick={() => toggle(p.name)} className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5 min-w-0">
                    <ChevronDown size={13} className={`text-slate-400 flex-shrink-0 transition-transform ${expanded.has(p.name) ? '' : '-rotate-90'}`} />
                    <span className="text-slate-400 tabular-nums">{i + 1}.</span>
                    <span className="truncate">{p.name}</span>
                  </p>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums flex-shrink-0"><Fig>{fmtCompact(lM(p.revenue))}</Fig></span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden flex-1">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${(p.revenue / maxRev) * 100}%` }} />
                  </div>
                  <span className="text-xs text-slate-400 tabular-nums flex-shrink-0">{lI(p.units)} unit{lI(p.units) !== 1 ? 's' : ''}</span>
                </div>
              </button>
              {expanded.has(p.name) && (
                <div className="bg-slate-50/60 divide-y divide-slate-100">
                  {p.items.slice(0, SUB_LIMIT).map(it => (
                    <div key={it.name} className="px-4 py-2 pl-9">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs text-slate-600 truncate">{it.name}</p>
                        <span className="text-xs font-medium text-slate-800 tabular-nums flex-shrink-0"><Fig>{fmtCompact(lM(it.revenue))}</Fig></span>
                      </div>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {lI(it.units)} unit{lI(it.units) !== 1 ? 's' : ''} · avg <Fig>{fmtCompact(lM(it.revenue / Math.max(1, it.units)))}</Fig>
                      </p>
                    </div>
                  ))}
                  {p.items.length > SUB_LIMIT && (
                    <p className="px-4 py-2 pl-9 text-[11px] text-slate-400">…and {p.items.length - SUB_LIMIT} more</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Tablet/desktop: full table with expandable rows */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
                <th className="px-5 py-2.5 text-left font-medium w-8">#</th>
                <th className="px-5 py-2.5 text-left font-medium">Product</th>
                <th className="px-5 py-2.5 text-right font-medium">Units</th>
                <th className="px-5 py-2.5 text-right font-medium">Revenue</th>
                <th className="px-5 py-2.5 text-left font-medium w-32">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {products.map((p, i) => (
                <Fragment key={p.name}>
                  <tr onClick={() => toggle(p.name)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <td className="px-5 py-3 text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">
                      <span className="flex items-center gap-1.5">
                        <ChevronDown size={13} className={`text-slate-400 transition-transform ${expanded.has(p.name) ? '' : '-rotate-90'}`} />
                        {p.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{lI(p.units)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800 tabular-nums"><Fig>{fmtCompact(lM(p.revenue))}</Fig></td>
                    <td className="px-5 py-3">
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden w-full min-w-16">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${(p.revenue / maxRev) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                  {expanded.has(p.name) && (
                    <tr>
                      <td colSpan={5} className="p-0 bg-slate-50/60">
                        <div className="divide-y divide-slate-100">
                          {p.items.slice(0, SUB_LIMIT).map(it => (
                            <div key={it.name} className="flex items-center gap-3 pl-16 pr-5 py-2">
                              <span className="text-xs text-slate-600 truncate flex-1">{it.name}</span>
                              <span className="text-xs text-slate-400 tabular-nums flex-shrink-0 w-16 text-right">{lI(it.units)} unit{lI(it.units) !== 1 ? 's' : ''}</span>
                              <span className="text-xs text-slate-400 tabular-nums flex-shrink-0 w-20 text-right">avg <Fig>{fmtCompact(lM(it.revenue / Math.max(1, it.units)))}</Fig></span>
                              <span className="text-xs font-medium text-slate-800 tabular-nums flex-shrink-0 w-20 text-right"><Fig>{fmtCompact(lM(it.revenue))}</Fig></span>
                            </div>
                          ))}
                          {p.items.length > SUB_LIMIT && (
                            <p className="pl-16 pr-5 py-2 text-[11px] text-slate-400">…and {p.items.length - SUB_LIMIT} more</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Card>
  );
}

// ─── Recent Quotes (Apex "Recent Deals") ───────────────────────────────────────
function RecentQuotes({ quotes, customers, navigate, lM }) {
  const recent = [...quotes]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 6);
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <FileText size={15} className="text-amber-500" /> Recent Quotes
        </h2>
        <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
          View all <ArrowRight size={12} />
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-400">No quotes yet.</p>
      ) : (
        <>
        {/* Phone: stacked rows — no sideways scrolling */}
        <div className="sm:hidden divide-y divide-slate-50">
          {recent.map(q => {
            const cust = customers.find(c => c.id === q.customerId);
            return (
              <button
                key={q.id}
                onClick={() => navigate(`/quotes/${q.id}`)}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-800 truncate">{cust?.name || 'Customer'}</p>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums flex-shrink-0"><Fig>{fmtCompact(lM(quoteTotal(q)))}</Fig></span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400 truncate">
                    {q.quoteNumber || '—'}{(q.updatedAt || q.createdAt) ? ` · ${format(parseISO(q.updatedAt || q.createdAt), 'd MMM')}` : ''}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${QUOTE_STATUS_STYLE[q.status] || 'bg-slate-100 text-slate-600'}`}>
                    {q.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {/* Tablet/desktop: full table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
                <th className="px-5 py-2.5 text-left font-medium whitespace-nowrap">Quote</th>
                <th className="px-5 py-2.5 text-left font-medium">Customer</th>
                <th className="px-5 py-2.5 text-right font-medium">Value</th>
                <th className="px-5 py-2.5 text-left font-medium">Stage</th>
                <th className="px-5 py-2.5 text-right font-medium whitespace-nowrap">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recent.map(q => {
                const cust = customers.find(c => c.id === q.customerId);
                return (
                  <tr
                    key={q.id}
                    onClick={() => navigate(`/quotes/${q.id}`)}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{q.quoteNumber || '—'}</td>
                    <td className="px-5 py-3 font-medium text-slate-800 truncate max-w-40">{cust?.name || 'Customer'}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800 tabular-nums whitespace-nowrap"><Fig>{fmtCompact(lM(quoteTotal(q)))}</Fig></td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${QUOTE_STATUS_STYLE[q.status] || 'bg-slate-100 text-slate-600'}`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-400 text-xs whitespace-nowrap">
                      {(q.updatedAt || q.createdAt) ? format(parseISO(q.updatedAt || q.createdAt), 'd MMM') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Card>
  );
}

// ─── Top Salespeople (Apex "Top Sales Reps") ───────────────────────────────────
function TopSalesReps({ reps, lM, lI, lW }) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Trophy size={15} className="text-amber-500" /> Top Salespeople
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Won revenue in period</p>
      </div>
      <div className="divide-y divide-slate-50">
        {reps.map((r, i) => (
          <div key={r.name} className="flex items-center gap-3 px-5 py-3">
            <span className="w-5 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700 font-bold text-xs">
                {r.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
              <p className="text-xs text-slate-400">{lI(r.won)} won{r.winRate !== null ? ` · ${lW(r.winRate).toFixed(0)}% win rate` : ''}</p>
            </div>
            <span className="text-sm font-semibold text-slate-800 tabular-nums flex-shrink-0"><Fig>{fmtCompact(lM(r.revenue))}</Fig></span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Follow-up detection: open quotes from the last 90 days that the customer
// never opened (3+ days after sending) or that expire within 14 days.
function computeFollowUps(quotes) {
  const now = Date.now(), DAY = 86400000;
  return quotes
    .filter(q => ['Sent', 'Viewed', 'Waiting'].includes(q.status) && q.sentAt
      && (now - new Date(q.sentAt).getTime()) < 90 * DAY)
    .map(q => {
      // Imported (Quotient) quotes carry no open-tracking data — Quotient's
      // export never said whether the customer opened them — so "never opened"
      // can't be inferred for them. Only quotes actually sent through Lusso
      // have firstOpenedAt/viewedAt.
      const imported = q.source === 'Quotient Import' || (q.quoteNumber || '').startsWith('QNT-');
      const opened   = !!(q.firstOpenedAt || q.viewedAt);
      const sentDays = Math.floor((now - new Date(q.sentAt).getTime()) / DAY);
      const expDays  = q.expiryDate ? Math.ceil((new Date(q.expiryDate).getTime() - now) / DAY) : null;
      const unopened = !imported && !opened && sentDays >= 3;
      const expiring = expDays !== null && expDays >= 0 && expDays <= 14;
      return (unopened || expiring) ? { q, sentDays, expDays, unopened, expiring } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.sentDays - a.sentDays)
    .slice(0, 8);
}

// ─── Follow-ups: quotes that need chasing ──────────────────────────────────────
function FollowUps({ items, customers, navigate, lM }) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Mail size={15} className="text-amber-500" /> Follow-ups
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Open quotes the customer never opened, or expiring within 14 days</p>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <CheckCircle2 size={24} className="text-green-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500 font-medium">Nothing needs chasing</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {items.map(({ q, sentDays, expDays, unopened, expiring }) => {
            const cust = customers.find(c => c.id === q.customerId);
            return (
              <button
                key={q.id}
                onClick={() => navigate(`/quotes/${q.id}`)}
                className="w-full px-5 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-800 truncate">{cust?.name || 'Customer'}</p>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums flex-shrink-0"><Fig>{fmtCompact(lM(quoteTotal(q)))}</Fig></span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400 truncate">{q.quoteNumber || '—'} · sent {sentDays}d ago</span>
                  <span className="flex gap-1.5 flex-shrink-0">
                    {unopened && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1">
                        <Eye size={10} /> Not opened
                      </span>
                    )}
                    {expiring && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Expires {expDays === 0 ? 'today' : `in ${expDays}d`}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── Decision Time: sent→won conversion + how long customers take ─────────────
function DecisionTime({ insights, lI }) {
  const { sentCount, wonOfSent, medianDays, decisionCount, buckets } = insights;
  const maxBucket = Math.max(1, ...buckets.map(([, n]) => n));
  return (
    <Card className="min-w-0">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Timer size={15} className="text-amber-500" /> Decision Time
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {lI(sentCount)} sent → {lI(wonOfSent)} won
          {medianDays !== null && <> · median <b className="text-slate-600">{medianDays}d</b> when they go away to decide</>}
        </p>
      </div>
      <div className="p-5 space-y-2.5">
        {decisionCount === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No wins in this period.</p>
        ) : (
          buckets.map(([label, n]) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-20 flex-shrink-0">{label}</span>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${(n / maxBucket) * 100}%` }} />
              </div>
              <span className="text-xs text-slate-600 tabular-nums w-8 text-right">{lI(n)}</span>
            </div>
          ))
        )}
        {decisionCount > 0 && (
          <p className="text-xs text-slate-400 pt-1">How long wins took from sent to yes. “On the spot” = accepted within an hour (closed at the consult).</p>
        )}
      </div>
    </Card>
  );
}

// ─── Seasonality: average accepted revenue per calendar month, all years ───────
function Seasonality({ data, lM }) {
  const max = Math.max(1, ...data.avg);
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  return (
    <Card className="min-w-0">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <CalendarDays size={15} className="text-amber-500" /> Seasonality
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Average accepted revenue by month across {data.years} year{data.years !== 1 ? 's' : ''}</p>
      </div>
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-end gap-1.5 h-28">
          {data.avg.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={fmt$(lM(v))}>
              <div className="w-full flex items-end h-full">
                <div className="w-full bg-amber-400 hover:bg-amber-500 rounded-t transition-colors" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-400">{MONTHS[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Top Customers by lifetime value ───────────────────────────────────────────
function TopCustomers({ items, navigate, lM, lI }) {
  return (
    <Card className="min-w-0">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Users size={15} className="text-amber-500" /> Top Customers
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Lifetime accepted value</p>
      </div>
      <div className="divide-y divide-slate-50">
        {items.map((c, i) => (
          <button
            key={c.customerId}
            onClick={() => navigate(`/customers/${c.customerId}`)}
            className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <span className="w-5 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
              <p className="text-xs text-slate-400">{lI(c.count)} accepted quote{lI(c.count) !== 1 ? 's' : ''}</p>
            </div>
            <span className="text-sm font-semibold text-slate-800 tabular-nums flex-shrink-0"><Fig>{fmtCompact(lM(c.total))}</Fig></span>
          </button>
        ))}
        {items.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No accepted quotes yet.</p>}
      </div>
    </Card>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  useDataRefresh();
  const navigate  = useNavigate();
  const { isAM = true, displayName = '', isSP } = useProfile() || {};
  const [salesFilter, setSalesFilter] = useState('all');
  // Range selection persists across refreshes and navigation.
  const RANGE_KEY = 'lusso_dashboard_range';
  const [globalRange, setGlobalRangeState] = useState(() => {
    const stored = localStorage.getItem(RANGE_KEY);
    const valid = stored && (DATE_RANGE_OPTIONS.some(o => o.value === stored) || /^yr\d{4}$/.test(stored));
    return valid ? stored : 'thisfy';
  });
  const setGlobalRange = (v) => { setGlobalRangeState(v); localStorage.setItem(RANGE_KEY, v); };
  const [larpMode, setLarpMode]       = useState(loadLarp);
  // Privacy mode — blur every figure so clients on site can't read them.
  // Always starts hidden each time the dashboard opens (safest on site); the
  // salesperson taps to reveal for the current view only.
  const [privacy, setPrivacy] = useState(true);
  const updatePrivacy = (v) => setPrivacy(v);

  const customers = getCustomersFiltered(isAM, displayName);
  const activity  = getActivity();

  // Every salesperson seen anywhere — job assignments AND quote salespeople
  // (the imported history carries names that never appear on a job).
  const salespeople = [...new Set([
    ...getJobsFiltered(isAM, displayName).map(j => j.assignedStaff),
    ...getQuotesFiltered(isAM, displayName).map(q => (q.salesperson || '').trim()),
  ].filter(Boolean))].sort();
  const jobs   = salesFilter === 'all' ? getJobsFiltered(isAM, displayName)   : getJobsFiltered(false, salesFilter);
  const quotes = salesFilter === 'all' ? getQuotesFiltered(isAM, displayName) : getQuotesFiltered(false, salesFilter);

  const updateLarp = (v) => { setLarpMode(v); saveLarp(v); };

  // Inflation helpers — only active for AMs with larpMode ("presentation") on.
  const larpActive = larpMode && isAM;
  const lI  = (n) => larpActive ? Math.round((n || 0) * 87) : (n || 0);
  const lM  = (v) => larpActive ? ((v || 0) * 237)          : (v || 0);
  const lW  = (p) => (larpActive && p !== null) ? Math.min(100, p * 1.5) : p;
  const larpMul = larpActive ? 237 : 1;

  // ── Current-state stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const counts = {};
    jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });
    const active = jobs.filter(j => !['Completed', 'Cancelled'].includes(j.status)).length;
    const urgent = jobs.filter(j => ['Urgent', 'High'].includes(j.urgency)).length;
    return { counts, active, urgent };
  }, [jobs]);

  const recentJobs = useMemo(() =>
    [...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6),
    [jobs]
  );

  const recentActivity = useMemo(() =>
    [...activity].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 7),
    [activity]
  );

  // ── Trailing 12-month series (for the hero chart + KPI sparklines) ───────────
  const monthly = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return {
        label: format(d, 'MMM'),
        start: new Date(d.getFullYear(), d.getMonth(), 1),
        end:   new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
      };
    });
    return months.map(m => {
      const range = { start: m.start, end: m.end };
      const acc = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));
      const created = quotes.filter(q => inRange(q.createdAt, range));
      // Same resolution-based win rate as the KPI: outcomes that happened
      // this month (Expired = loss; open quotes excluded).
      const wins = quotes.filter(q =>
        (q.status === 'Accepted' || q.status === 'Completed') && inRange(q.acceptedAt || q.updatedAt, range)).length;
      const losses = quotes.filter(q =>
        (q.status === 'Declined' && inRange(q.declinedAt || q.updatedAt, range)) ||
        (q.status === 'Expired'  && inRange(q.updatedAt, range))).length;
      // Gross margin % for the month (only lines with a known cost).
      let sellKnown = 0, gpKnown = 0;
      acc.forEach(q => activeLineItems(q).forEach(li => {
        const c = ((Number(li.unitCostPrice) || 0) + (Number(li.labourCost) || 0)) * (Number(li.quantity) || 1);
        if (c > 0) { const s = lineItemRevenue(li); sellKnown += s; gpKnown += s - c; }
      }));
      return {
        label: m.label,
        acceptedValue: acc.reduce((s, q) => s + quoteTotal(q), 0),
        acceptedCount: acc.length,
        newQuotes: created.length,
        winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
        marginPct: sellKnown > 0 ? (gpKnown / sellKnown) * 100 : 0,
      };
    });
  }, [quotes]);

  // ── Period analytics (respond to the date-range filter) ──────────────────────
  const analytics = useMemo(() => {
    const range = getDateRange(globalRange);
    const prev  = getPreviousPeriod(globalRange);

    // Pipeline = open quotes sent (or created) in the last 12 months. Imported
    // history keeps its honest Waiting/Sent statuses; the recency window is
    // what keeps years-old undecided quotes from inflating this number.
    const pipelineCutoff = subMonths(new Date(), 12);
    const pipelineQuotes = quotes.filter(q => {
      if (!PIPELINE_STATUSES.includes(q.status)) return false;
      const d = q.sentAt || q.createdAt;
      return d ? new Date(d) >= pipelineCutoff : true; // undated drafts stay in
    });
    const pipelineValue  = pipelineQuotes.reduce((s, q) => s + quoteTotal(q), 0);

    const accepted     = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));
    const acceptedPrev = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, prev));
    const acceptedValue     = accepted.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedValuePrev = acceptedPrev.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedAvg       = accepted.length > 0 ? acceptedValue / accepted.length : 0;

    // Win rate — resolution-based: outcomes that HAPPENED in the period,
    // whenever the quote was sent. Wins = accepted in period; losses =
    // declined or expired in period (customers rarely formally decline —
    // quotes mostly lapse, so Expired counts as a loss). Cohort-by-sent-date
    // reads 100% on short recent windows because losses lag wins.
    const resolutionsIn = (r) => {
      const wins = quotes.filter(q =>
        (q.status === 'Accepted' || q.status === 'Completed') && inRange(q.acceptedAt || q.updatedAt, r));
      const losses = quotes.filter(q =>
        (q.status === 'Declined' && inRange(q.declinedAt || q.updatedAt, r)) ||
        (q.status === 'Expired'  && inRange(q.updatedAt, r)));
      return { wins: wins.length, losses: losses.length };
    };
    const res     = resolutionsIn(range);
    const resPrev = resolutionsIn(prev);
    const decisions     = res.wins + res.losses;
    const decisionsPrev = resPrev.wins + resPrev.losses;
    const winRate     = decisions > 0     ? (res.wins / decisions) * 100         : null;
    const winRatePrev = decisionsPrev > 0 ? (resPrev.wins / decisionsPrev) * 100 : null;

    return {
      pipelineValue, pipelineCount: pipelineQuotes.length,
      acceptedCount: accepted.length, acceptedCountPrev: acceptedPrev.length,
      acceptedValue, acceptedValuePrev, acceptedAvg,
      winRate, winRatePrev, decisions,
    };
  }, [quotes, globalRange]);

  // ── Top categories + category split (accepted quotes in range) ──────────────
  // Grouped by product CATEGORY (keyword rules over item code + title) —
  // imported Quotient titles are unique room descriptions, so grouping by
  // name would make every line its own "product".
  const products = useMemo(() => {
    const range = getDateRange(globalRange);
    const accepted = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));
    const m = {};
    accepted.forEach(q => {
      // Inc-GST, mirroring quoteTotal() — so the category totals reconcile
      // exactly with the Total Revenue KPI for the same period.
      const gstMul = q.includesGST === false ? 1 : 1 + (Number(q.gstRate) || 10) / 100;
      activeLineItems(q).forEach(li => {
        const name = categorizeProduct(li.productNameSnapshot || li.productType || '', li.description || '');
        if (!m[name]) m[name] = { name, units: 0, revenue: 0, items: {} };
        const qty = Number(li.quantity) || 1;
        const rev = lineItemRevenue(li) * gstMul;
        m[name].units   += qty;
        m[name].revenue += rev;
        // Drill-down level: the item code is the actual product ("RB 40 Block");
        // uncoded lines fall back to their title.
        const key = (li.description || '').trim() || (li.productNameSnapshot || '').trim() || 'Unspecified';
        if (!m[name].items[key]) m[name].items[key] = { name: key, units: 0, revenue: 0 };
        m[name].items[key].units   += qty;
        m[name].items[key].revenue += rev;
      });
    });
    let cats = Object.values(m)
      .map(c => ({ ...c, items: Object.values(c.items).sort((a, b) => b.revenue - a.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    // Fold the tail into "Other" instead of dropping it, so the category
    // totals cover 100% of the period's revenue.
    if (cats.length > 8) {
      let head = cats.slice(0, 7);
      const rest = cats.slice(7);
      const existingOther = head.find(c => c.name === 'Other');
      if (existingOther) { rest.push(existingOther); head = head.filter(c => c.name !== 'Other'); }
      const other = rest.reduce((acc, c) => ({
        name: 'Other',
        units: acc.units + c.units,
        revenue: acc.revenue + c.revenue,
        items: [...acc.items, ...c.items],
      }), { name: 'Other', units: 0, revenue: 0, items: [] });
      other.items.sort((a, b) => b.revenue - a.revenue);
      cats = [...head, other].sort((a, b) => b.revenue - a.revenue);
    }
    return cats;
  }, [quotes, globalRange]);

  // ── Salesperson leaderboard (accepted/declined in range) ─────────────────────
  const reps = useMemo(() => {
    const range = getDateRange(globalRange);
    const m = {};
    quotes.forEach(q => {
      const name = (q.salesperson || '').trim();
      if (!name) return;
      if (!m[name]) m[name] = { name, won: 0, lost: 0, revenue: 0 };
      if (q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range)) {
        m[name].won += 1; m[name].revenue += quoteTotal(q);
      } else if ((q.status === 'Declined' || q.status === 'Expired') && inRange(q.updatedAt, range)) {
        // Expired counts as a loss — same win-rate definition as the KPI.
        m[name].lost += 1;
      }
    });
    return Object.values(m)
      .filter(r => r.won + r.lost > 0)
      .map(r => ({ ...r, winRate: r.won + r.lost > 0 ? (r.won / (r.won + r.lost)) * 100 : null }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [quotes, globalRange]);

  // ── Insight metrics: margin, decision time, sent→won, repeat business ───────
  const insights = useMemo(() => {
    const range = getDateRange(globalRange);
    const accepted = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));

    // Gross margin (ex-GST — GST isn't profit). Only lines with a known cost
    // count, and we report how much of the revenue that covers.
    let sell = 0, sellKnown = 0, gpKnown = 0;
    accepted.forEach(q => activeLineItems(q).forEach(li => {
      const s = lineItemRevenue(li);
      sell += s;
      const c = ((Number(li.unitCostPrice) || 0) + (Number(li.labourCost) || 0)) * (Number(li.quantity) || 1);
      if (c > 0) { sellKnown += s; gpKnown += s - c; }
    }));
    const marginPct  = sellKnown > 0 ? (gpKnown / sellKnown) * 100 : null;
    // Discount lines (negative, no cost) can push the ratio past 100 — cap it.
    const knownShare = sell > 0 ? Math.min(100, (sellKnown / sell) * 100) : 0;

    // Decision time: days from sent → accepted for wins in the period.
    // Wins accepted within an hour of sending are on-the-spot sales (entered
    // in one sitting after the consult) — a close-rate stat, not a customer
    // decision interval, so they're reported separately and excluded from
    // the median. Verified against the data: 375 wins share the exact same
    // send/accept second.
    const HOUR = 1 / 24;
    const daysAll = accepted
      .filter(q => q.sentAt && q.acceptedAt)
      .map(q => (new Date(q.acceptedAt) - new Date(q.sentAt)) / 86400000)
      .filter(d => d >= 0 && d < 365)
      .sort((a, b) => a - b);
    const instant    = daysAll.filter(d => d < HOUR).length;
    const considered = daysAll.filter(d => d >= HOUR);
    const medianDays = considered.length ? Math.round(considered[Math.floor(considered.length / 2)]) : null;
    const instantPct = daysAll.length ? (instant / daysAll.length) * 100 : null;
    const buckets = [['On the spot', instant], ['Same week', 0], ['1–2 wks', 0], ['2–4 wks', 0], ['1–2 mths', 0], ['2 mths+', 0]];
    considered.forEach(d => { buckets[d <= 7 ? 1 : d <= 14 ? 2 : d <= 30 ? 3 : d <= 60 ? 4 : 5][1]++; });

    // Sent → won for quotes sent in the period (long-range conversion view).
    const sentIn = quotes.filter(q => q.sentAt && inRange(q.sentAt, range));
    const wonOfSent = sentIn.filter(q => q.status === 'Accepted' || q.status === 'Completed').length;

    // Repeat business: share of the period's accepted revenue from customers
    // who had already accepted an earlier quote (any time).
    const firstWin = new Map();
    quotes.forEach(q => {
      if (q.status !== 'Accepted' && q.status !== 'Completed') return;
      const t = new Date(q.acceptedAt || q.updatedAt).getTime();
      if (!Number.isFinite(t)) return;
      if (!firstWin.has(q.customerId) || t < firstWin.get(q.customerId)) firstWin.set(q.customerId, t);
    });
    let repeatRev = 0, totalRev = 0;
    const repeatCusts = new Set();
    accepted.forEach(q => {
      const t = new Date(q.acceptedAt || q.updatedAt).getTime();
      const v = quoteTotal(q);
      totalRev += v;
      if (firstWin.get(q.customerId) < t) { repeatRev += v; repeatCusts.add(q.customerId); }
    });
    const repeatPct = totalRev > 0 ? (repeatRev / totalRev) * 100 : null;

    return {
      marginValue: gpKnown, marginPct, knownShare,
      medianDays, decisionCount: daysAll.length, instantPct, buckets,
      sentCount: sentIn.length, wonOfSent,
      repeatPct, repeatCount: repeatCusts.size,
    };
  }, [quotes, globalRange]);

  // ── Seasonality: average accepted revenue per calendar month, all years ─────
  const seasonality = useMemo(() => {
    const sums = Array(12).fill(0);
    const years = new Set();
    quotes.forEach(q => {
      if (q.status !== 'Accepted') return;
      const d = q.acceptedAt || q.updatedAt;
      if (!d) return;
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return;
      years.add(dt.getFullYear());
      sums[dt.getMonth()] += quoteTotal(q);
    });
    const n = Math.max(1, years.size);
    return { avg: sums.map(s => s / n), years: years.size };
  }, [quotes]);

  // ── Top customers by lifetime accepted value ─────────────────────────────────
  const topCustomers = useMemo(() => {
    const m = new Map();
    quotes.forEach(q => {
      if (q.status !== 'Accepted' && q.status !== 'Completed') return;
      if (!m.has(q.customerId)) m.set(q.customerId, { customerId: q.customerId, total: 0, count: 0 });
      const e = m.get(q.customerId);
      e.total += quoteTotal(q); e.count += 1;
    });
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 5)
      .map(e => ({ ...e, name: customers.find(c => c.id === e.customerId)?.name || 'Customer' }));
  }, [quotes, customers]);

  // ── Follow-ups: recent open quotes never opened, or expiring soon ───────────
  const followUps = useMemo(() => computeFollowUps(quotes), [quotes]);

  // ── This-calendar-month progress (for targets) ───────────────────────────────
  const monthProgress = useMemo(() => {
    const now = new Date();
    const range = { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    const acc = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));
    return {
      revenue:      acc.reduce((s, q) => s + quoteTotal(q), 0),
      quotesWon:    acc.length,
      newCustomers: customers.filter(c => inRange(c.createdAt, range)).length,
    };
  }, [quotes, customers]);

  // Hero revenue chart + monthly/yearly toggle.
  const [revView, setRevView] = useState('monthly');
  const yearly = useMemo(() => {
    const cur = new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const rows = [];
    for (let y = cur - 4; y <= cur; y++) {
      const fy  = getAusFY(y);
      const fyQ = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, fy));
      rows.push({ label: `FY${String(y - 1).slice(-2)}/${String(y).slice(-2)}`, value: fyQ.reduce((s, q) => s + quoteTotal(q), 0), count: fyQ.length });
    }
    return rows;
  }, [quotes]);

  const rangeLabel = yearValue(globalRange)
    || DATE_RANGE_OPTIONS.find(o => o.value === globalRange)?.label
    || '';

  // ── PDF report export — snapshots exactly what's on screen ──────────────────
  const [exporting, setExporting] = useState(false);
  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const reportRange = getDateRange(globalRange);
      await downloadDashboardReport({
        periodLabel: rangeLabel,
        periodDates: `${format(reportRange.start, 'd MMM yyyy')} – ${format(reportRange.end, 'd MMM yyyy')}`,
        salesperson: salesFilter !== 'all' ? salesFilter : null,
        generatedAt: format(new Date(), 'd MMM yyyy, h:mm a'),
        revenue: lM(analytics.acceptedValue),
        revenueDeltaPct: analytics.acceptedValuePrev > 0
          ? ((analytics.acceptedValue - analytics.acceptedValuePrev) / analytics.acceptedValuePrev) * 100 : null,
        pipelineValue: lM(analytics.pipelineValue),
        pipelineCount: lI(analytics.pipelineCount),
        quotesWon: lI(analytics.acceptedCount),
        avgQuote: lM(analytics.acceptedAvg),
        winRate: analytics.winRate !== null ? lW(analytics.winRate) : null,
        decisions: lI(analytics.decisions),
        marginValue: insights.marginPct !== null ? lM(insights.marginValue) : null,
        marginPct: insights.marginPct,
        knownShare: insights.knownShare,
        medianDays: insights.medianDays,
        instantPct: insights.instantPct,
        repeatPct: insights.repeatPct !== null ? lW(insights.repeatPct) : null,
        repeatCount: lI(insights.repeatCount),
        buckets: insights.buckets.map(([label, n]) => [label, lI(n)]),
        categories: products.map(p => ({ name: p.name, units: lI(p.units), revenue: lM(p.revenue) })),
        topCustomers: topCustomers.map(c => ({ name: c.name, count: lI(c.count), total: lM(c.total) })),
        reps: reps.map(r => ({ name: r.name, won: lI(r.won), winRate: r.winRate !== null ? lW(r.winRate) : null, revenue: lM(r.revenue) })),
        seasonality: { avg: seasonality.avg.map(v => lM(v)), years: seasonality.years },
        followUps: followUps.map(f => ({
          customer: customers.find(c => c.id === f.q.customerId)?.name || 'Customer',
          quoteNumber: f.q.quoteNumber || '—',
          value: lM(quoteTotal(f.q)),
          sentDays: f.sentDays, expDays: f.expDays,
          unopened: f.unopened, expiring: f.expiring,
        })),
      });
    } catch (e) {
      console.error('[dashboard] PDF export failed:', e);
      window.alert(`PDF export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  // Calendar years covered by the quote history (newest first) — feeds the
  // range dropdown so imported years like 2015 are directly selectable.
  const quoteYears = useMemo(() => {
    const ys = new Set();
    quotes.forEach(q => {
      const d = q.sentAt || q.createdAt;
      if (d) ys.add(Number(d.slice(0, 4)));
    });
    return [...ys].filter(y => y >= 2000).sort((a, b) => b - a);
  }, [quotes]);

  // Pipeline donut data
  const dc = larpActive
    ? Object.fromEntries(Object.entries(stats.counts).map(([k, v]) => [k, Math.round(v * 91)]))
    : stats.counts;
  const pipelineData  = PIPELINE_STAGES.map((label, i) => ({ label, value: dc[label] || 0, color: PIPELINE_RAMP[i] }));

  const revValues = revView === 'monthly'
    ? monthly.map(m => m.acceptedValue * larpMul)
    : yearly.map(y => y.value * larpMul);
  const revLabels = revView === 'monthly' ? monthly.map(m => m.label) : yearly.map(y => y.label);
  const revTotal  = revValues.reduce((s, v) => s + v, 0);

  return (
    <PrivacyCtx.Provider value={privacy}>
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isSP
              ? `Welcome back, ${displayName} — here's what's happening with your pipeline.`
              : "Welcome back — here's what's happening with your business today."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {isAM && salespeople.length > 0 && (
            <div className="relative">
              <select
                value={salesFilter}
                onChange={e => setSalesFilter(e.target.value)}
                className="appearance-none text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 rounded-lg pl-3 pr-7 py-2 border border-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
              >
                <option value="all">All salespeople</option>
                {salespeople.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          )}
          <DateRangeSelect value={globalRange} onChange={setGlobalRange} years={quoteYears} />
          <button
            onClick={() => updatePrivacy(!privacy)}
            title={privacy ? 'Figures hidden — tap to show' : 'Hide figures (for when clients can see the screen)'}
            aria-pressed={privacy}
            className={`flex items-center justify-center gap-1.5 rounded-lg p-2 sm:px-3 border transition-colors ${
              privacy ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {privacy ? <EyeOff size={15} /> : <Eye size={15} />}
            <span className="hidden sm:inline text-xs font-medium">{privacy ? 'Hidden' : 'Hide figures'}</span>
          </button>
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            title="Export PDF report"
            className="flex items-center justify-center gap-1.5 rounded-lg p-2 sm:px-3 border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <FileDown size={15} />
            <span className="hidden sm:inline text-xs font-medium">{exporting ? 'Exporting…' : 'Report'}</span>
          </button>
          {isAM && (
            <button
              onClick={() => updateLarp(!larpMode)}
              title="Presentation mode"
              className={`flex items-center justify-center rounded-lg p-2 border transition-colors ${
                larpMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal size={15} />
            </button>
          )}
        </div>
      </div>

      {/* ── Presentation-mode banner ─────────────────────────────────────────── */}
      {larpActive && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-semibold text-amber-700 tracking-wide uppercase">Presentation mode</span>
          </div>
          <button onClick={() => updateLarp(false)} className="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors">
            Disable
          </button>
        </div>
      )}

      {/* ── Row 1 · KPI stat cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={DollarSign} label="Total Revenue"
          raw={lM(analytics.acceptedValue)} format={fmtCompact}
          valueTitle={fmt$(lM(analytics.acceptedValue))}
          delta={<DeltaBadge current={analytics.acceptedValue} previous={analytics.acceptedValuePrev} />}
          caption={`vs same time last year · ${rangeLabel}`}
          spark={monthly.map(m => m.acceptedValue)}
          onClick={() => navigate('/jobs')}
        />
        <StatCard
          icon={BarChart2} label="Pipeline Value" delay={70}
          raw={lM(analytics.pipelineValue)} format={fmtCompact}
          valueTitle={fmt$(lM(analytics.pipelineValue))}
          delta={<span className="text-xs font-semibold text-blue-600"><Fig>{lI(analytics.pipelineCount)}</Fig></span>}
          caption={`open quote${lI(analytics.pipelineCount) !== 1 ? 's' : ''} (last 12 mo)`}
          spark={monthly.map(m => m.newQuotes)}
          sparkColor="#2E6E65"
          onClick={() => navigate('/jobs')}
        />
        <StatCard
          icon={CheckCircle2} label="Quotes Won" delay={140}
          raw={lI(analytics.acceptedCount)} format={(v) => Math.round(v)}
          delta={<DeltaBadge current={analytics.acceptedCount} previous={analytics.acceptedCountPrev} />}
          caption={<>avg <Fig>{fmtCompact(lM(analytics.acceptedAvg))}</Fig></>}
          spark={monthly.map(m => m.acceptedCount)}
          sparkColor="#16A34A"
          onClick={() => navigate('/jobs')}
        />
        <StatCard
          icon={Percent} label="Win Rate" delay={210}
          {...(analytics.winRate !== null
            ? { raw: lW(analytics.winRate), format: (v) => `${v.toFixed(0)}%` }
            : { value: '—' })}
          delta={analytics.winRate !== null && analytics.winRatePrev !== null
            ? <DeltaBadge current={analytics.winRate} previous={analytics.winRatePrev} /> : null}
          caption={analytics.decisions > 0 ? `of ${lI(analytics.decisions)} resolved quotes` : 'no resolved quotes yet'}
          spark={monthly.map(m => m.winRate)}
          sparkColor="#9333EA"
          onClick={() => navigate('/jobs')}
        />
      </div>

      {/* ── Row 1b · Insight KPIs: margin, decision speed, repeat business ────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          icon={TrendingUp} label="Gross Margin" delay={60}
          {...(insights.marginPct !== null
            ? { raw: lM(insights.marginValue), format: fmtCompact }
            : { value: '—' })}
          delta={insights.marginPct !== null
            ? <span className="text-xs font-semibold text-green-600"><Fig>{insights.marginPct.toFixed(0)}%</Fig></span> : null}
          caption={insights.marginPct !== null
            ? `margin · costs known for ${insights.knownShare.toFixed(0)}% of revenue`
            : 'no cost prices in period'}
          spark={monthly.map(m => m.marginPct)}
          sparkColor="#16A34A"
        />
        <StatCard
          icon={Timer} label="Days to Win" delay={120}
          {...(insights.medianDays !== null
            ? { raw: insights.medianDays, format: (v) => `${Math.round(v)}d` }
            : { value: '—' })}
          caption={insights.medianDays !== null
            ? `median wait${insights.instantPct !== null ? ` · ${insights.instantPct.toFixed(0)}% say yes on the spot` : ''}`
            : 'no wins with dates in period'}
        />
        <StatCard
          icon={Users} label="Repeat Revenue" delay={180}
          {...(insights.repeatPct !== null
            ? { raw: lW(insights.repeatPct), format: (v) => `${v.toFixed(0)}%` }
            : { value: '—' })}
          caption={insights.repeatPct !== null
            ? `from ${lI(insights.repeatCount)} returning customer${lI(insights.repeatCount) !== 1 ? 's' : ''}`
            : 'no accepted quotes in period'}
        />
      </div>

      {/* ── Needs Attention ──────────────────────────────────────────────────── */}
      <div className="animate-fade-up" style={{ animationDelay: '120ms' }}>
        <NeedsAttention jobs={jobs} quotes={quotes} navigate={navigate} infl={lI} />
      </div>

      {/* ── Row 1c · Follow-ups + Decision time ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up" style={{ animationDelay: '160ms' }}>
        <div className="lg:col-span-2 min-w-0">
          <FollowUps items={followUps} customers={customers} navigate={navigate} lM={lM} />
        </div>
        <DecisionTime insights={insights} lI={lI} />
      </div>

      {/* ── Row 2 · Revenue area chart + Pipeline donut ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up" style={{ animationDelay: '200ms' }}>
        <Card className="lg:col-span-2 min-w-0">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <BarChart2 size={15} className="text-amber-500" /> Revenue
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {revView === 'monthly' ? 'Last 12 months' : 'By financial year'} · {fmt$(revTotal)} accepted
              </p>
            </div>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 flex-shrink-0">
              {['monthly', 'yearly'].map(v => (
                <button
                  key={v}
                  onClick={() => setRevView(v)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                    revView === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {v === 'monthly' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2 pt-4 pb-2">
            <AreaChart values={revValues} xLabels={revLabels} color={ACCENT} height={260} />
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">Job Pipeline</h2>
            <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="p-5">
            <DonutChart data={pipelineData} centerValue={lI(stats.active)} centerLabel="active projects" />
          </div>
        </Card>
      </div>

      {/* ── Row 3 · Top products + Sales by category donut ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up" style={{ animationDelay: '280ms' }}>
        <div className="lg:col-span-2 min-w-0">
          <TopProducts products={products} lM={lM} lI={lI} />
        </div>
        <Card className="min-w-0">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Sales by Category</h2>
            <p className="text-xs text-slate-400 mt-0.5">Revenue by product type</p>
          </div>
          <div className="p-5">
            <DonutChart
              data={products.map((p, i) => ({ label: p.name, value: Math.round(lM(p.revenue)), color: PIPELINE_RAMP[(i * 2) % PIPELINE_RAMP.length] }))}
              centerValue={fmtCompact(products.reduce((s, p) => s + lM(p.revenue), 0))}
              centerLabel="accepted"
              valueFmt={fmtCompact}
            />
          </div>
        </Card>
      </div>

      {/* ── Row 3b · Seasonality + Top customers ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up" style={{ animationDelay: '320ms' }}>
        <div className="lg:col-span-2 min-w-0">
          <Seasonality data={seasonality} lM={lM} />
        </div>
        <TopCustomers items={topCustomers} navigate={navigate} lM={lM} lI={lI} />
      </div>

      {/* ── Row 4 · Recent quotes + Targets / Top salespeople ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up" style={{ animationDelay: '360ms' }}>
        <div className="lg:col-span-2 min-w-0">
          <RecentQuotes quotes={quotes} customers={customers} navigate={navigate} lM={lM} />
        </div>
        <div className="min-w-0 space-y-6">
          <TargetsCard
            revenue={monthProgress.revenue}
            quotesWon={monthProgress.quotesWon}
            newCustomers={monthProgress.newCustomers}
            lM={lM} lI={lI}
          />
          {reps.length > 1 && <TopSalesReps reps={reps} lM={lM} lI={lI} lW={lW} />}
        </div>
      </div>

      {/* ── Row 5 · Recent jobs table + Activity feed ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up" style={{ animationDelay: '440ms' }}>
        <Card className="lg:col-span-2 min-w-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">Recent Jobs</h2>
            <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </button>
          </div>
          {/* Phone: stacked rows — no sideways scrolling */}
          <div className="sm:hidden divide-y divide-slate-50">
            {recentJobs.map(job => {
              const cust = customers.find(c => c.id === job.customerId);
              return (
                <button
                  key={job.id}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-700 font-bold text-xs">{cust?.name?.charAt(0) || 'J'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{cust?.name || 'Customer'}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {job.jobNumber}{job.jobType ? ` · ${job.jobType}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={job.status} size="sm" />
                </button>
              );
            })}
            {recentJobs.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No jobs yet.</p>
            )}
          </div>
          {/* Tablet/desktop: full table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
                  <th className="px-5 py-2.5 text-left font-medium">Customer</th>
                  <th className="px-5 py-2.5 text-left font-medium whitespace-nowrap">Job</th>
                  <th className="px-5 py-2.5 text-left font-medium">Type</th>
                  <th className="px-5 py-2.5 text-left font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium whitespace-nowrap">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentJobs.map(job => {
                  const cust = customers.find(c => c.id === job.customerId);
                  return (
                    <tr
                      key={job.id}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-amber-700 font-bold text-xs">{cust?.name?.charAt(0) || 'J'}</span>
                          </div>
                          <span className="font-medium text-slate-800 truncate">{cust?.name || 'Customer'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{job.jobNumber}</td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{job.jobType || '—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={job.status} size="sm" /></td>
                      <td className="px-5 py-3 text-right text-slate-400 whitespace-nowrap text-xs">
                        {job.updatedAt ? formatDistanceToNow(parseISO(job.updatedAt), { addSuffix: true }) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {recentJobs.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">No jobs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Recent Activity</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {recentActivity.map(act => {
              const { icon: Icon, color, bg } = ACTIVITY_ICONS[act.type] || ACTIVITY_FALLBACK;
              const job  = jobs.find(j => j.id === act.jobId);
              const cust = job ? customers.find(c => c.id === job.customerId) : null;
              return (
                <button
                  key={act.id}
                  onClick={() => act.jobId && navigate(`/jobs/${act.jobId}`)}
                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Icon size={13} className={color} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-700 line-clamp-2">{act.message}</div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {cust?.name && <span className="font-medium">{cust.name} · </span>}
                      {act.user} · {formatDistanceToNow(parseISO(act.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </button>
              );
            })}
            {recentActivity.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-slate-400">No activity yet.</p>
            )}
          </div>
        </Card>
      </div>

    </div>
    </PrivacyCtx.Provider>
  );
}
