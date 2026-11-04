// The growth plan, as a working page rather than a document.
//
// The argument it carries is simple enough to state in one line: one person
// tops out around nine measure-and-quote appointments a week, and roughly a
// third of the appointments currently being made earn almost nothing. Both
// halves of that are claims about live data, which is why this is a page and
// not a PDF — every figure below is recomputed by growth_scoreboard() on load,
// so the plan either stays true or visibly stops being true.
//
// Two things are deliberately NOT hard-coded here:
//   - The per-visit economics table is derived in SQL, not transcribed. If the
//     job mix shifts, the table that justifies the whole strategy shifts with
//     it rather than quietly becoming a historical curiosity.
//   - The capacity assumptions are editable, and the ceiling they produce is
//     never restated in prose anywhere on the page - the headline reads it
//     from the scoreboard. The shipped defaults (3h per measure, 3h post-sale)
//     were estimates; whoever tracks a real fortnight corrects them here and
//     every number, headline included, moves with them.

import { useState, useEffect, useCallback } from 'react';
import {
  Gauge, CheckCircle2, Circle, Loader2, RefreshCw, ChevronDown, Sliders,
  AlertTriangle, TrendingUp, Target, Info, Hammer, Megaphone, MapPin,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast } from '../components/ToastContainer';
import Card from '../components/Card';
import { TradePanel, AdsPanel, TerritoryPanel } from './growthPanels';

// The blocks of the plan, in the order they must happen. The order is the
// advice: the free qualification work comes before any spend, and the cheap
// hire comes before the expensive one.
//
// Revised 2026-11-03. The original Q1 was a re-engagement pass over the
// existing book, with paid search held back to Q2. That was dropped in favour
// of buying new leads, and the data says it was the right call: segments C and
// D are 57% and 62% small-job customers (median jobs of $1,944 and $1,794),
// and a second purchase runs at roughly half the median value of a first one.
// Those waves would have filled the diary with the $39-$153/hour bands. Paid
// search costs far more per lead and is still worth more per appointment,
// because it buys a first-time job. Trade and organic each moved up a quarter.
//
// q4 is kept deliberately even though nothing sits in it: a stage with no
// entry here would silently hide any task later assigned to it.
const STAGES = [
  { key: 'now',  label: 'Do now',        sub: 'Free. Changes the mix, not the volume.' },
  { key: 'q1',   label: 'Quarter 1',     sub: 'Turn on paid search. $1,500–2,500/mo.' },
  { key: 'q2',   label: 'Quarter 2',     sub: 'Build the trade channel. Time, not cash.' },
  { key: 'q3',   label: 'Quarter 3',     sub: 'Let organic compound.' },
  { key: 'q4',   label: 'Quarter 4',     sub: 'Unassigned.' },
  { key: 'hire', label: 'Hire triggers', sub: 'Both have conditions. Wait for them.' },
];

const TABS = [
  { key: 'plan',      label: 'Plan',      icon: Target },
  { key: 'trade',     label: 'Trade',     icon: Hammer },
  { key: 'ads',       label: 'Ads',       icon: Megaphone },
  { key: 'territory', label: 'Territory', icon: MapPin },
];

const money = (n) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString();
const pct   = (n) => n == null ? '—' : Number(n).toFixed(n % 1 === 0 ? 0 : 1) + '%';

// Colour the per-hour column by whether that band is worth the windscreen
// time. The thresholds are the point of the table, so they belong in one place.
const hourBand = (v) => v < 200 ? 'bad' : v < 400 ? 'warn' : 'good';
const HOUR_STYLE = {
  bad:  'text-rose-700 bg-rose-50',
  warn: 'text-amber-700 bg-amber-50',
  good: 'text-emerald-700 bg-emerald-50',
};

/** The headline: appointments run against the ceiling, as a filled bar. */
function CapacityGauge({ m, revenue }) {
  const filled = Math.min(100, Number(m?.pct_of_ceiling) || 0);
  const full = filled >= 90;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wider">
            <Gauge size={13} /> Capacity
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums text-slate-900">{m?.per_week ?? '—'}</span>
            <span className="text-slate-400 text-xl">/</span>
            <span className="text-xl font-medium tabular-nums text-slate-500">{m?.ceiling ?? '—'}</span>
            <span className="text-sm text-slate-500 ml-1">measures per week</span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-semibold tabular-nums ${full ? 'text-rose-600' : 'text-emerald-600'}`}>
            {pct(m?.pct_of_ceiling)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">of solo ceiling</div>
        </div>
      </div>

      <div className="mt-4 h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${full ? 'bg-rose-500' : 'bg-emerald-500'}`}
          style={{ width: `${filled}%` }}
        />
      </div>

      <div className="mt-4 grid sm:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-slate-500 text-xs">Headroom</div>
          <div className="font-semibold tabular-nums text-slate-900">
            {m?.headroom ?? '—'} more / week
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">Banked per month</div>
          <div className="font-semibold tabular-nums text-slate-900">{money(revenue?.actual_month)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">At the ceiling</div>
          <div className="font-semibold tabular-nums text-slate-900">{money(revenue?.at_ceiling)}</div>
        </div>
      </div>

      {m?.source === 'customers_quoted' && (
        <div className="mt-4 flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Appointments are <strong>inferred</strong> from distinct customers quoted, because no job has
            ever had a measure date recorded. Start filling in measure dates and this becomes exact
            automatically — it's the fourth item on the <em>Do now</em> list.
          </span>
        </div>
      )}
    </Card>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500 leading-snug">{sub}</div>}
    </Card>
  );
}

/** One checklist row: checkbox, impact line, and the detail behind a toggle. */
function TaskRow({ task, onToggle, onPatch, busy }) {
  const [open, setOpen]   = useState(false);
  const [notes, setNotes] = useState(task.notes || '');
  const done = !!task.done_at;

  const saveNotes = () => {
    if ((task.notes || '') === notes) return;
    onPatch(task.id, { notes });
  };

  return (
    <div className={`border-b border-slate-100 last:border-0 ${done ? 'bg-slate-50/60' : ''}`}>
      <div className="flex items-start gap-3 p-3.5">
        <button
          onClick={() => onToggle(task)}
          disabled={busy}
          aria-label={done ? 'Mark not done' : 'Mark done'}
          className="shrink-0 mt-0.5 text-slate-300 hover:text-emerald-600 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-amber-500 rounded"
        >
          {busy ? <Loader2 size={19} className="animate-spin text-slate-400" />
                : done ? <CheckCircle2 size={19} className="text-emerald-600" />
                : <Circle size={19} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium leading-snug ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {task.title}
          </div>
          {task.impact && (
            <div className={`text-xs mt-0.5 ${done ? 'text-slate-400' : 'text-amber-700'}`}>
              {task.impact}
            </div>
          )}

          {open && (
            <div className="mt-3 space-y-3">
              <p className="text-[13px] text-slate-600 leading-relaxed">{task.detail}</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  Due
                  <input
                    type="date"
                    value={task.due_date || ''}
                    onChange={(e) => onPatch(task.id, { due_date: e.target.value || null })}
                    className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700"
                  />
                </label>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                rows={2}
                placeholder="Notes — what you actually did, what it returned…"
                className="w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-2 text-slate-700 placeholder:text-slate-400 focus:outline-2 focus:outline-amber-500"
              />
            </div>
          )}
        </div>

        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Hide detail' : 'Show detail'}
          aria-expanded={open}
          className="shrink-0 text-slate-400 hover:text-slate-700 p-1 rounded focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

/** The capacity inputs. Estimates, and labelled as such. */
// Remounted by the parent (keyed on assumptions.updated_at) whenever the saved
// values change, so the draft seeds itself from the server copy without a
// prop-to-state sync effect.
function Assumptions({ a, onSave, saving }) {
  const [form, setForm] = useState(a);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const FIELDS = [
    ['hours_per_measure',  'Hours per measure',    'Drive, site, quote build, follow-up'],
    ['hours_post_sale',    'Hours post-sale',      'PO, suppliers, subbie, invoice, snags'],
    ['weekly_admin_hours', 'Weekly admin hours',   'Fixed cost of running the business'],
    ['target_week_hours',  'Working week',         'The week being solved for'],
  ];

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wider">
        <Sliders size={13} /> Capacity assumptions
      </div>
      <p className="mt-2 text-[13px] text-slate-600 leading-relaxed">
        These are <strong>estimates, not measurements</strong>, and they set the ceiling. Track a real
        fortnight and correct them — every number on this page moves with them.
      </p>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {FIELDS.map(([k, label, hint]) => (
          <label key={k} className="block">
            <span className="text-xs font-medium text-slate-700">{label}</span>
            <input
              type="number" step="0.5" min="0"
              value={form?.[k] ?? ''}
              onChange={(e) => set(k, e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm tabular-nums focus:outline-2 focus:outline-amber-500"
            />
            <span className="text-[11px] text-slate-400">{hint}</span>
          </label>
        ))}
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-[13px] text-slate-700">
        <input
          type="checkbox"
          checked={!!form?.has_coordinator}
          onChange={(e) => set('has_coordinator', e.target.checked)}
          className="mt-0.5 accent-emerald-600"
        />
        <span>
          <strong>Operations coordinator hired.</strong> Tick this when they start — the post-sale
          hours leave your week and the ceiling jumps from ~9 to ~15.
        </span>
      </label>

      <button
        onClick={() => onSave(form)}
        disabled={saving}
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium bg-slate-900 text-white rounded-lg px-3.5 py-2 hover:bg-slate-800 disabled:opacity-50"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        Save &amp; recalculate
      </button>
    </Card>
  );
}

export default function GrowthPlan() {
  const [sb, setSb]         = useState(null);
  const [tasks, setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab]       = useState('plan');

  const load = useCallback(async () => {
    const [{ data: s, error: sErr }, { data: t, error: tErr }] = await Promise.all([
      supabase.rpc('growth_scoreboard'),
      supabase.from('growth_tasks').select('*').is('deleted_at', null)
        .order('stage').order('sort'),
    ]);
    if (sErr) toast(`Scoreboard: ${sErr.message}`, 'error');
    if (tErr) toast(`Checklist: ${tErr.message}`, 'error');
    if (s) setSb(s);
    if (t) setTasks(t);
    setLoading(false);
  }, []);

  // Promise-then with a cancelled flag, matching Campaigns and ContentQueue —
  // the initial load must not setState into an unmounted page.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.rpc('growth_scoreboard'),
      supabase.from('growth_tasks').select('*').is('deleted_at', null)
        .order('stage').order('sort'),
    ]).then(([{ data: s, error: sErr }, { data: t, error: tErr }]) => {
      if (cancelled) return;
      if (sErr) toast(`Could not load the scoreboard: ${sErr.message}`, 'error');
      else if (s) setSb(s);
      if (tErr) toast(`Could not load the checklist: ${tErr.message}`, 'error');
      else if (t) setTasks(t);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (task) => {
    setBusyId(task.id);
    const done_at = task.done_at ? null : new Date().toISOString();
    const { error } = await supabase.from('growth_tasks')
      .update({ done_at, updated_at: new Date().toISOString() }).eq('id', task.id);
    setBusyId(null);
    if (error) return toast(error.message, 'error');
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, done_at } : t));
    setSb(s => s && ({ ...s, tasks: {
      open: (s.tasks?.open ?? 0) + (done_at ? -1 : 1),
      done: (s.tasks?.done ?? 0) + (done_at ? 1 : -1),
    }}));
  };

  const patch = async (id, fields) => {
    const { error } = await supabase.from('growth_tasks')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast(error.message, 'error');
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...fields } : t));
    toast('Saved', 'success');
  };

  const saveAssumptions = async (form) => {
    setSaving(true);
    const { error } = await supabase.from('growth_settings').update({
      hours_per_measure:  Number(form.hours_per_measure),
      hours_post_sale:    Number(form.hours_post_sale),
      weekly_admin_hours: Number(form.weekly_admin_hours),
      target_week_hours:  Number(form.target_week_hours),
      has_coordinator:    !!form.has_coordinator,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) { setSaving(false); return toast(error.message, 'error'); }
    await load();
    setSaving(false);
    toast('Recalculated', 'success');
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Loading the plan…
      </div>
    );
  }

  const m = sb?.measures;
  const done = sb?.tasks?.done ?? 0;
  const total = done + (sb?.tasks?.open ?? 0);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Growth plan</h1>
          {/* The ceiling is read from the scoreboard, never written in prose.
              It moves whenever the assumptions below are edited, and a headline
              that disagrees with the gauge underneath it discredits both. */}
          <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
            On your current assumptions one person tops out near{' '}
            <strong className="text-slate-700 tabular-nums">{m?.ceiling ?? '—'}</strong> measures a
            week, and the smallest third of your appointments earn almost nothing. Every figure
            here is recomputed from live quote data, so the plan either stays true or visibly
            stops being true.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums text-slate-900">{done}/{total}</div>
            <div className="text-xs text-slate-500">done</div>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Four views, one page. The plan is the default because it is what the
          page is for; the other three are the evidence behind its three
          biggest line items and each loads its own data on first open. */}
      <div className="flex gap-1 border-b border-slate-200 -mb-1 overflow-x-auto">
        {TABS.map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                on ? 'border-amber-500 text-slate-900 font-medium'
                   : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'trade'     && <TradePanel />}
      {tab === 'ads'       && <AdsPanel />}
      {tab === 'territory' && <TerritoryPanel />}

      {tab === 'plan' && <>
      <CapacityGauge m={m} revenue={sb?.revenue} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Close rate" value={pct(sb?.close_rate)}
             sub="Matured quotes only — 90 days to 15 months old. Raw rates read far lower because open quotes aren't losses." />
        <Kpi label="Average won job" value={money(sb?.avg_won)}
             sub={`Matured. Jobs accepted in the last 13 weeks average ${money(sb?.avg_won_recent)} — the mix is already climbing.`} />
        <Kpi label="Gross margin" value={pct(sb?.gm_pct)}
             sub={`${money(sb?.revenue?.gp_month)} of gross profit a month at today's volume.`} />
        <Kpi label="This week" value={`${sb?.this_week?.customers ?? 0} quoted`}
             sub={`${sb?.this_week?.quotes ?? 0} quotes raised, ${sb?.this_week?.won ?? 0} accepted so far.`} />
      </div>

      {/* The table that decides how the diary gets booked. Derived, not remembered. */}
      <Card className="overflow-hidden">
        <div className="p-5 pb-3">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wider">
            <TrendingUp size={13} /> What each appointment is worth
          </div>
          <p className="mt-2 text-[13px] text-slate-600 leading-relaxed max-w-2xl">
            Rolling 22 months. <strong>Revenue per visit</strong> counts every appointment in the band,
            won or lost, so it already prices in the lower win rate on big jobs. The last column is
            what an hour of your time earned.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
                <th className="text-left font-medium px-5 py-2.5">Quote size</th>
                <th className="text-right font-medium px-3 py-2.5">Quotes</th>
                <th className="text-right font-medium px-3 py-2.5">Won</th>
                <th className="text-right font-medium px-3 py-2.5">Win rate</th>
                <th className="text-right font-medium px-3 py-2.5">Revenue won</th>
                <th className="text-right font-medium px-3 py-2.5">Rev / visit</th>
                <th className="text-right font-medium px-3 py-2.5">GP / visit</th>
                <th className="text-right font-medium px-5 py-2.5">Per hour</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(sb?.bands || []).map(b => (
                <tr key={b.band} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 font-medium text-slate-900 whitespace-nowrap">{b.label}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{b.quotes}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{b.won}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{b.win_pct}%</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{money(b.won_value)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{money(b.rev_per_visit)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{money(b.gp_per_visit)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <span className={`inline-block font-semibold px-2 py-0.5 rounded ${HOUR_STYLE[hourBand(b.per_hour)]}`}>
                      {money(b.per_hour)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex gap-2 text-xs text-slate-600">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            Qualify on <strong>who is asking</strong>, not only job size. Repeat buyers are 72% of all
            lifetime value, so a small job for a builder who spends $40k a year is account
            maintenance, not a waste of a trip.
          </span>
        </div>
      </Card>

      {/* Checklist */}
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          {STAGES.map(stage => {
            const items = (tasks || []).filter(t => t.stage === stage.key);
            if (!items.length) return null;
            const sDone = items.filter(t => t.done_at).length;
            return (
              <Card key={stage.key} className="overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">{stage.label}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">{stage.sub}</p>
                  </div>
                  <span className="text-xs text-slate-400 tabular-nums shrink-0">{sDone}/{items.length}</span>
                </div>
                <div>
                  {items.map(t => (
                    <TaskRow key={t.id} task={t} onToggle={toggle} onPatch={patch} busy={busyId === t.id} />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wider">
              <Target size={13} /> The sequence
            </div>
            <ol className="mt-3 space-y-2.5 text-[13px] text-slate-700">
              <li><strong>1.</strong> Fix the lead mix — free.</li>
              <li><strong>2.</strong> Lift lead volume — cheap.</li>
              <li><strong>3.</strong> Hire the coordinator at 8 measures/week — ~$80k.</li>
              <li><strong>4.</strong> Hire the salesperson at 15 — ~$115k.</li>
            </ol>
            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
              Reverse the two hires and you pay $115k to unlock less capacity than $80k would have,
              and put the lead-generation problem on payroll.
            </p>
          </Card>

          <Assumptions
            key={sb?.assumptions?.updated_at || 'assumptions'}
            a={sb?.assumptions}
            onSave={saveAssumptions}
            saving={saving}
          />
        </div>
      </div>
      </>}
    </div>
  );
}
