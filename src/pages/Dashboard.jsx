import { useDataRefresh } from '../hooks/useDataRefresh';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatDistanceToNow, parseISO, isWithinInterval,
  subDays, subMonths, startOfYear, endOfYear,
  format, differenceInDays,
} from 'date-fns';
import {
  Briefcase, ClipboardList, CheckCircle2, Clock,
  AlertTriangle, TrendingUp, TrendingDown, Users, ArrowRight, Plus,
  DollarSign, ChevronDown, BarChart2, HardHat, Percent,
  SlidersHorizontal, Eye, FileText, X, Mail,
} from 'lucide-react';
import {
  getJobsFiltered, getCustomersFiltered, getActivity,
  getQuotesFiltered, computeQuoteTotals, getInstallRequests,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';
import { DonutChart, AreaChart, Sparkline } from '../components/DashboardCharts';
import { PIPELINE_RAMP } from '../lib/chartColors';

// Brand accents (kept muted — Lusso amber/teal, never neon). To adopt the Apex
// template's teal accent instead, swap ACCENT to '#2E6E65'.
const ACCENT = '#C0873A';
const LARP_KEY = 'lusso_larp_mode';

function loadLarp() {
  try { return localStorage.getItem(LARP_KEY) === 'true'; }
  catch { return false; }
}
function saveLarp(v) { localStorage.setItem(LARP_KEY, v ? 'true' : 'false'); }

// Ordered job pipeline stages (label === status key). Coloured via PIPELINE_RAMP.
const PIPELINE_STAGES = [
  'New Enquiry', 'Measure Booked', 'Measured', 'Quote Required', 'Quoted',
  'Awaiting Approval', 'Approved', 'Ordered', 'Installation Booked', 'Installed', 'Completed',
];

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

function fmtCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000)     return `$${Math.round(value / 1_000)}K`;
  return fmt$(value);
}

// ─── Small shared UI ───────────────────────────────────────────────────────────
function DateRangeSelect({ value, onChange }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 rounded-lg pl-3 pr-7 py-2 border border-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
      >
        {DATE_RANGE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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
      <Icon size={12} />{Math.abs(change).toFixed(1)}%
    </span>
  );
}

// Apex-style KPI stat card: label + icon, big value, delta + caption, sparkline.
function StatCard({ icon: Icon, label, value, valueTitle, delta, caption, spark, sparkColor = ACCENT, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-left hover:shadow-md transition-shadow flex flex-col min-w-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-500 font-medium truncate">{label}</span>
        <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Icon size={15} className="text-slate-500" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900 truncate" title={valueTitle}>{value}</div>
      <div className="mt-1 flex items-center gap-1.5 min-w-0 text-xs">
        {delta}
        <span className="text-slate-400 truncate">{caption}</span>
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-3 -mb-1"><Sparkline values={spark} color={sparkColor} height={34} /></div>
      )}
    </button>
  );
}

// ─── Needs Attention ──────────────────────────────────────────────────────────
function NeedsAttention({ jobs, quotes, navigate, infl }) {
  const now      = new Date();
  const TERMINAL = ['Completed', 'Cancelled'];

  const stalled = jobs.filter(j =>
    !TERMINAL.includes(j.status) && j.updatedAt &&
    differenceInDays(now, parseISO(j.updatedAt)) >= 14
  ).length;
  const quotesOut       = quotes.filter(q => ['Sent', 'Viewed'].includes(q.status)).length;
  const pendingInstalls = getInstallRequests().filter(r => r.status === 'Sent').length;

  const items = [
    { key: 'stalled',   count: stalled,         label: 'Stalled jobs',     sub: 'No activity 14+ days', icon: AlertTriangle, color: 'text-red-500',   bg: 'bg-red-50',   onClick: () => navigate('/jobs') },
    { key: 'quotesOut', count: quotesOut,       label: 'Quotes out',       sub: 'Awaiting customer',    icon: Clock,         color: 'text-amber-600', bg: 'bg-amber-50', onClick: () => navigate('/quotes') },
    { key: 'install',   count: pendingInstalls, label: 'Install requests', sub: 'Awaiting installer',   icon: HardHat,       color: 'text-blue-600',  bg: 'bg-blue-50',  onClick: () => navigate('/calendar') },
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
  const [salesFilter, setSalesFilter] = useState('all');
  const [globalRange, setGlobalRange] = useState('thisfy');
  const [larpMode, setLarpMode]       = useState(loadLarp);

  const customers = getCustomersFiltered(isAM, displayName);
  const activity  = getActivity();

  const salespeople = [...new Set(getJobsFiltered(isAM, displayName).map(j => j.assignedStaff).filter(Boolean))].sort();
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
      const dec = quotes.filter(q => q.status === 'Declined' && inRange(q.updatedAt, range));
      const created = quotes.filter(q => inRange(q.createdAt, range));
      const decisions = acc.length + dec.length;
      return {
        label: m.label,
        acceptedValue: acc.reduce((s, q) => s + quoteTotal(q), 0),
        acceptedCount: acc.length,
        newQuotes: created.length,
        winRate: decisions > 0 ? (acc.length / decisions) * 100 : 0,
      };
    });
  }, [quotes]);

  // ── Period analytics (respond to the date-range filter) ──────────────────────
  const analytics = useMemo(() => {
    const range = getDateRange(globalRange);
    const prev  = getPreviousPeriod(globalRange);

    const pipelineQuotes = quotes.filter(q => PIPELINE_STATUSES.includes(q.status));
    const pipelineValue  = pipelineQuotes.reduce((s, q) => s + quoteTotal(q), 0);

    const accepted     = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range));
    const acceptedPrev = quotes.filter(q => q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, prev));
    const acceptedValue     = accepted.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedValuePrev = acceptedPrev.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedAvg       = accepted.length > 0 ? acceptedValue / accepted.length : 0;

    const declined     = quotes.filter(q => q.status === 'Declined' && inRange(q.updatedAt, range));
    const declinedPrev = quotes.filter(q => q.status === 'Declined' && inRange(q.updatedAt, prev));
    const decisions     = accepted.length + declined.length;
    const decisionsPrev = acceptedPrev.length + declinedPrev.length;
    const winRate     = decisions > 0     ? (accepted.length / decisions) * 100         : null;
    const winRatePrev = decisionsPrev > 0 ? (acceptedPrev.length / decisionsPrev) * 100 : null;

    return {
      pipelineValue, pipelineCount: pipelineQuotes.length,
      acceptedCount: accepted.length, acceptedCountPrev: acceptedPrev.length,
      acceptedValue, acceptedValuePrev, acceptedAvg,
      winRate, winRatePrev, decisions,
    };
  }, [quotes, globalRange]);

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

  const rangeLabel = DATE_RANGE_OPTIONS.find(o => o.value === globalRange)?.label || '';

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
          <DateRangeSelect value={globalRange} onChange={setGlobalRange} />
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={DollarSign} label="Total Revenue"
          value={fmtCompact(lM(analytics.acceptedValue))}
          valueTitle={fmt$(lM(analytics.acceptedValue))}
          delta={<DeltaBadge current={analytics.acceptedValue} previous={analytics.acceptedValuePrev} />}
          caption={`vs previous · ${rangeLabel}`}
          spark={monthly.map(m => m.acceptedValue)}
          onClick={() => navigate('/quotes')}
        />
        <StatCard
          icon={BarChart2} label="Pipeline Value"
          value={fmtCompact(lM(analytics.pipelineValue))}
          valueTitle={fmt$(lM(analytics.pipelineValue))}
          delta={<span className="text-xs font-semibold text-blue-600">{lI(analytics.pipelineCount)}</span>}
          caption={`open quote${lI(analytics.pipelineCount) !== 1 ? 's' : ''}`}
          spark={monthly.map(m => m.newQuotes)}
          sparkColor="#2E6E65"
          onClick={() => navigate('/quotes')}
        />
        <StatCard
          icon={CheckCircle2} label="Quotes Won"
          value={lI(analytics.acceptedCount)}
          delta={<DeltaBadge current={analytics.acceptedCount} previous={analytics.acceptedCountPrev} />}
          caption={`avg ${fmtCompact(lM(analytics.acceptedAvg))}`}
          spark={monthly.map(m => m.acceptedCount)}
          sparkColor="#16A34A"
          onClick={() => navigate('/quotes')}
        />
        <StatCard
          icon={Percent} label="Win Rate"
          value={analytics.winRate !== null ? `${lW(analytics.winRate).toFixed(0)}%` : '—'}
          delta={analytics.winRate !== null && analytics.winRatePrev !== null
            ? <DeltaBadge current={analytics.winRate} previous={analytics.winRatePrev} /> : null}
          caption={analytics.decisions > 0 ? `${lI(analytics.decisions)} decisions` : 'no decisions yet'}
          spark={monthly.map(m => m.winRate)}
          sparkColor="#9333EA"
          onClick={() => navigate('/quotes')}
        />
      </div>

      {/* ── Needs Attention ──────────────────────────────────────────────────── */}
      <NeedsAttention jobs={jobs} quotes={quotes} navigate={navigate} infl={lI} />

      {/* ── Row 2 · Revenue area chart + Pipeline donut ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
            <DonutChart data={pipelineData} centerValue={lI(stats.active)} centerLabel="active jobs" />
          </div>
        </Card>
      </div>

      {/* ── Row 3 · Recent jobs table + Activity feed ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 min-w-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">Recent Jobs</h2>
            <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="overflow-x-auto">
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
  );
}
