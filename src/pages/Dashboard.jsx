import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, parseISO, isAfter, isBefore, isWithinInterval, subDays, subMonths, startOfYear, endOfYear, startOfMonth, format } from 'date-fns';
import {
  Briefcase, ClipboardList, CheckCircle2, Clock,
  AlertTriangle, TrendingUp, Users, ArrowRight, Plus,
  CalendarDays, Package, Wrench, Star, DollarSign,
  ChevronDown, BarChart2, TrendingDown,
} from 'lucide-react';
import { getJobs, getCustomers, getActivity, getQuotes, computeQuoteTotals } from '../store/data';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';

const STAT_GROUPS = [
  { label: 'New Enquiry',        key: 'New Enquiry',         icon: Plus,          color: 'text-slate-500',  bg: 'bg-slate-50' },
  { label: 'Measure Booked',     key: 'Measure Booked',      icon: CalendarDays,  color: 'text-blue-500',   bg: 'bg-blue-50' },
  { label: 'Measured',           key: 'Measured',            icon: ClipboardList, color: 'text-cyan-500',   bg: 'bg-cyan-50' },
  { label: 'Quote Required',     key: 'Quote Required',      icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50' },
  { label: 'Quoted',             key: 'Quoted',              icon: TrendingUp,    color: 'text-orange-500', bg: 'bg-orange-50' },
  { label: 'Awaiting Approval',  key: 'Awaiting Approval',   icon: Clock,         color: 'text-amber-500',  bg: 'bg-amber-50' },
  { label: 'Approved',           key: 'Approved',            icon: Star,          color: 'text-lime-600',   bg: 'bg-lime-50' },
  { label: 'Ordered',            key: 'Ordered',             icon: Package,       color: 'text-purple-500', bg: 'bg-purple-50' },
  { label: 'Installation Booked',key: 'Installation Booked', icon: CalendarDays,  color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { label: 'Installed',          key: 'Installed',           icon: Wrench,        color: 'text-teal-500',   bg: 'bg-teal-50' },
  { label: 'Completed',          key: 'Completed',           icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
];

const ACTIVITY_ICONS = {
  status_change:   { icon: TrendingUp,    color: 'text-blue-500',   bg: 'bg-blue-50' },
  measure_created: { icon: ClipboardList, color: 'text-amber-500',  bg: 'bg-amber-50' },
  job_created:     { icon: Briefcase,     color: 'text-purple-500', bg: 'bg-purple-50' },
  quote_sent:      { icon: TrendingUp,    color: 'text-orange-500', bg: 'bg-orange-50' },
  job_completed:   { icon: CheckCircle2,  color: 'text-green-500',  bg: 'bg-green-50' },
};

const PIPELINE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Waiting'];

// ─── Date range helpers ────────────────────────────────────────────────────────

function getAusFY(year) {
  // Aus FY: 1 Jul (year-1) to 30 Jun year
  return {
    start: new Date(year - 1, 6, 1, 0, 0, 0),  // Jul 1
    end:   new Date(year, 5, 30, 23, 59, 59),   // Jun 30
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
    case '30d':   return { start: subDays(now, 30), end: now };
    case '90d':   return { start: subDays(now, 90), end: now };
    case '6m':    return { start: subMonths(now, 6), end: now };
    case 'ytd':   return { start: startOfYear(now), end: now };
    case 'thisfy':return getCurrentAusFY();
    case 'prevfy':return getPreviousAusFY();
    case 'prevyr':return { start: startOfYear(new Date(now.getFullYear() - 1, 0, 1)), end: endOfYear(new Date(now.getFullYear() - 1, 0, 1)) };
    default:      return { start: subDays(now, 30), end: now };
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
    const d = parseISO(dateStr);
    return isWithinInterval(d, { start: range.start, end: range.end });
  } catch { return false; }
}

function quoteTotal(q) {
  const { total } = computeQuoteTotals(q.lineItems || [], q.depositType, q.depositValue, q.gstRate, q.includesGST, q.selectedLineItemIds || []);
  return total;
}

function pct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
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
  const isUp = change >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const color = isUp ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${color}`}>
      <Icon size={10} />
      {Math.abs(change).toFixed(0)}%
    </span>
  );
}

function fmt$(value) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const jobs = getJobs();
  const customers = getCustomers();
  const activity = getActivity();
  const quotes = getQuotes();

  const [globalRange, setGlobalRange] = useState('thisfy');

  const stats = useMemo(() => {
    const counts = {};
    jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });
    const active = jobs.filter(j => j.status !== 'Completed' && j.status !== 'Cancelled').length;
    const urgent = jobs.filter(j => j.urgency === 'Urgent' || j.urgency === 'High').length;
    return { counts, active, urgent };
  }, [jobs]);

  const recentJobs = useMemo(() =>
    [...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5),
    [jobs]
  );

  const recentActivity = useMemo(() =>
    [...activity].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    [activity]
  );

  // ─── Quote analytics ────────────────────────────────────────────────────────

  const analytics = useMemo(() => {
    const range = getDateRange(globalRange);
    const prev = getPreviousPeriod(globalRange);

    // Pipeline value (all non-terminal quotes, not date-filtered)
    const pipelineQuotes = quotes.filter(q => PIPELINE_STATUSES.includes(q.status));
    const pipelineValue = pipelineQuotes.reduce((s, q) => s + quoteTotal(q), 0);
    const pipelineByStatus = PIPELINE_STATUSES.map(status => ({
      status,
      count: pipelineQuotes.filter(q => q.status === status).length,
      value: pipelineQuotes.filter(q => q.status === status).reduce((s, q) => s + quoteTotal(q), 0),
    }));

    // Accepted quotes in current range
    const accepted = quotes.filter(q =>
      q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, range)
    );
    const acceptedPrev = quotes.filter(q =>
      q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, prev)
    );
    const acceptedCount = accepted.length;
    const acceptedCountPrev = acceptedPrev.length;
    const acceptedValue = accepted.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedValuePrev = acceptedPrev.reduce((s, q) => s + quoteTotal(q), 0);
    const acceptedAvg = acceptedCount > 0 ? acceptedValue / acceptedCount : 0;

    // Yearly performance (last 5 Aus FYs)
    const currentYear = new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const yearlyRows = [];
    for (let y = currentYear; y >= currentYear - 4; y--) {
      const fy = getAusFY(y);
      const fyQuotes = quotes.filter(q =>
        q.status === 'Accepted' && inRange(q.acceptedAt || q.updatedAt, fy)
      );
      const fyCount = fyQuotes.length;
      const fyValue = fyQuotes.reduce((s, q) => s + quoteTotal(q), 0);
      yearlyRows.push({
        label: `FY${String(y - 1).slice(-2)}/${String(y).slice(-2)}`,
        year: y,
        count: fyCount,
        value: fyValue,
        avg: fyCount > 0 ? fyValue / fyCount : 0,
      });
    }

    const maxValue = Math.max(...yearlyRows.map(r => r.value), 1);

    return {
      pipelineValue, pipelineByStatus, pipelineCount: pipelineQuotes.length,
      acceptedCount, acceptedCountPrev,
      acceptedValue, acceptedValuePrev,
      acceptedAvg,
      yearlyRows, maxValue,
    };
  }, [quotes, globalRange]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Welcome back — here's your business at a glance.</p>
        </div>
        <button
          onClick={() => navigate('/measure-sheets/new')}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors self-start"
        >
          <Plus size={16} />
          New Measure Sheet
        </button>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroStat
          label="Active Jobs"
          value={stats.active}
          icon={Briefcase}
          color="text-amber-600"
          bg="bg-amber-50"
          onClick={() => navigate('/jobs')}
        />
        <HeroStat
          label="Total Customers"
          value={customers.length}
          icon={Users}
          color="text-blue-600"
          bg="bg-blue-50"
          onClick={() => navigate('/customers')}
        />
        <HeroStat
          label="Urgent / High Priority"
          value={stats.urgent}
          icon={AlertTriangle}
          color="text-red-500"
          bg="bg-red-50"
          onClick={() => navigate('/jobs?urgency=urgent')}
        />
        <HeroStat
          label="Completed Jobs"
          value={stats.counts['Completed'] || 0}
          icon={CheckCircle2}
          color="text-green-600"
          bg="bg-green-50"
          onClick={() => navigate('/jobs?status=Completed')}
        />
      </div>

      {/* ─── Sales Performance ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Sales Performance</h2>
          <DateRangeSelect value={globalRange} onChange={setGlobalRange} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Quotes Accepted */}
          <Card className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <DeltaBadge current={analytics.acceptedCount} previous={analytics.acceptedCountPrev} />
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900">{analytics.acceptedCount}</div>
              <div className="text-sm text-slate-500 mt-0.5">Quotes Accepted</div>
            </div>
            <div className="text-xs text-slate-400">
              vs {analytics.acceptedCountPrev} in previous period
            </div>
          </Card>

          {/* Total Pipeline Value */}
          <Card className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <BarChart2 size={18} className="text-blue-600" />
              </div>
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {analytics.pipelineCount} active
              </span>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900">{fmt$(analytics.pipelineValue)}</div>
              <div className="text-sm text-slate-500 mt-0.5">Total Pipeline Value</div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {analytics.pipelineByStatus.filter(s => s.count > 0).map(s => (
                <span key={s.status} className="text-xs text-slate-400">
                  <span className="font-medium text-slate-600">{s.count}</span> {s.status}
                </span>
              ))}
            </div>
          </Card>

          {/* Accepted Quote Value */}
          <Card className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                <DollarSign size={18} className="text-amber-600" />
              </div>
              <DeltaBadge current={analytics.acceptedValue} previous={analytics.acceptedValuePrev} />
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900">{fmt$(analytics.acceptedValue)}</div>
              <div className="text-sm text-slate-500 mt-0.5">Accepted Quote Value</div>
            </div>
            <div className="text-xs text-slate-400">
              Avg {fmt$(analytics.acceptedAvg)} · vs {fmt$(analytics.acceptedValuePrev)} prior period
            </div>
          </Card>
        </div>
      </div>

      {/* Yearly Performance */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Yearly Performance</h2>
          <button onClick={() => navigate('/quotes')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
            View quotes <ArrowRight size={12} />
          </button>
        </div>

        {/* Bar chart */}
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
                      title={`${row.label}: ${fmt$(row.value)}`}
                    />
                  </div>
                  <span className="text-xs text-slate-400 truncate w-full text-center">{row.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Table */}
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
                  <td className="px-5 py-3 text-right text-slate-600">{row.count}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800">{fmt$(row.value)}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{row.count > 0 ? fmt$(row.avg) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pipeline status grid */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Job Pipeline</h2>
          <button onClick={() => navigate('/jobs')} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
            View all <ArrowRight size={12} />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {STAT_GROUPS.map(({ label, key, icon: Icon, color, bg }) => (
            <button
              key={key}
              onClick={() => navigate(`/jobs?status=${encodeURIComponent(key)}`)}
              className="flex flex-col gap-2 p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all text-left"
            >
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={15} className={color} />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800 leading-tight">{stats.counts[key] || 0}</div>
                <div className="text-xs text-slate-500 leading-tight mt-0.5">{label}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Bottom two columns */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent jobs */}
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
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-700 font-bold text-xs">
                      {customer?.name?.charAt(0) || 'J'}
                    </span>
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

        {/* Recent activity */}
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Recent Activity</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {recentActivity.map(act => {
              const { icon: Icon, color, bg } = ACTIVITY_ICONS[act.type] || ACTIVITY_ICONS.job_created;
              const job = jobs.find(j => j.id === act.jobId);
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
      </div>
    </div>
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
