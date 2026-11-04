// The three data views that hang off the growth plan: trade revival, ad
// performance, and territory. Split out of GrowthPlan.jsx because that file is
// the checklist and the capacity model, and three more tables in it would bury
// both.
//
// Each panel loads its own RPC the first time its tab is opened rather than on
// page load. The plan tab is what people actually come for; making it wait on
// three extra round trips to render a table nobody looked at is how a page
// gets a reputation for being slow.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, Phone, ShieldCheck, TrendingDown, AlertTriangle, MapPin, Info, Plus, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast } from '../components/ToastContainer';
import Card from '../components/Card';

const money = (n) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString();

/** Shared loader: calls one RPC once, keeps loading/error state out of each panel. */
function useRpc(fn) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc(fn).then(({ data: d, error }) => {
      if (cancelled) return;
      if (error) toast(`Could not load: ${error.message}`, 'error');
      else setData(d);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fn]);
  return { data, loading };
}

function Spinner() {
  return (
    <div className="p-8 flex items-center gap-2 text-slate-500 text-sm">
      <Loader2 size={15} className="animate-spin" /> Loading…
    </div>
  );
}

// ── Trade ────────────────────────────────────────────────────────────────────

const RECENCY_PILL = {
  lapsed_1_2: { label: 'Quiet 1–2 yrs', cls: 'bg-amber-100 text-amber-800' },
  lapsed_2_4: { label: 'Quiet 2–4 yrs', cls: 'bg-orange-100 text-orange-800' },
  cold:       { label: 'Cold 4 yrs+',   cls: 'bg-slate-100 text-slate-600' },
};

export function TradePanel() {
  const { data, loading } = useRpc('growth_trade_targets');
  if (loading) return <Spinner />;

  const s = data?.summary || {};
  const sum = (...keys) => keys.reduce((a, k) => a + (s[k]?.accounts || 0), 0);
  const val = (...keys) => keys.reduce((a, k) => a + Number(s[k]?.value || 0), 0);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">The trade list isn&apos;t a prospecting list</h2>
        <p className="mt-2 text-[13px] text-slate-600 leading-relaxed max-w-2xl">
          The plan said find twenty new builders. Counting the existing accounts turned up
          something better: of the core trade accounts that have bought five or more times,
          only <strong>{sum('core_active')}</strong> have bought in the last year.
          <strong> {sum('core_lapsed_1_2', 'core_lapsed_2_4')} more</strong> bought repeatedly,
          averaged tens of thousands each, and quietly stopped between one and four years ago.
          A new builder relationship takes a year to produce its first job. These already produced several.
        </p>
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <div className="border border-slate-200 rounded-lg p-3">
            <div className="text-xs text-slate-500">Active — protect these</div>
            <div className="text-xl font-semibold tabular-nums">{sum('core_active')}</div>
            <div className="text-xs text-slate-500 mt-0.5">{money(val('core_active'))} lifetime</div>
          </div>
          <div className="border border-amber-300 bg-amber-50/50 rounded-lg p-3">
            <div className="text-xs text-amber-800 font-medium">Recoverable — call these</div>
            <div className="text-xl font-semibold tabular-nums text-amber-900">
              {sum('core_lapsed_1_2', 'core_lapsed_2_4')}
            </div>
            <div className="text-xs text-amber-700 mt-0.5">
              {money(val('core_lapsed_1_2', 'core_lapsed_2_4'))} lifetime
            </div>
          </div>
          <div className="border border-slate-200 rounded-lg p-3">
            <div className="text-xs text-slate-500">Behaves like trade</div>
            <div className="text-xl font-semibold tabular-nums">
              {sum('near_lapsed_1_2', 'near_lapsed_2_4', 'near_cold', 'near_active')}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">2–4 jobs, business name or multiple sites</div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Phone size={14} className="text-amber-600" />
          <h2 className="text-sm font-semibold text-slate-900">The call list</h2>
          <span className="text-xs text-slate-400 ml-auto">{(data?.targets || []).length} accounts, warmest first</span>
        </div>
        <div className="divide-y divide-slate-100">
          {(data?.targets || []).map(t => (
            <div key={t.id} className="p-3.5 flex items-start gap-3">
              <span className="text-xs font-mono text-slate-400 tabular-nums mt-0.5 w-6 shrink-0">
                {String(t.rank).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`/customers/${t.id}`} className="text-sm font-medium text-slate-900 hover:text-amber-700">
                  {t.business || t.name}
                </Link>
                {t.business && <span className="text-xs text-slate-400 ml-2">{t.name}</span>}
                <div className="text-xs text-slate-500 mt-0.5">{t.why}</div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {t.tier === 'core' && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-900 text-white">Core</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${RECENCY_PILL[t.recency]?.cls || ''}`}>
                  {RECENCY_PILL[t.recency]?.label || t.recency}
                </span>
              </div>
            </div>
          ))}
          {!(data?.targets || []).length && (
            <div className="p-6 text-sm text-slate-500">No lapsed trade accounts. Unusual, and good.</div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald-600" />
          <h2 className="text-sm font-semibold text-slate-900">Still active — don&apos;t neglect these</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {(data?.active || []).map(a => (
            <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <Link to={`/customers/${a.id}`} className="font-medium text-slate-900 hover:text-amber-700 truncate">
                {a.business || a.name}
              </Link>
              <span className="text-xs text-slate-500 ml-auto shrink-0 tabular-nums">
                {a.purchases} jobs · {money(a.lifetime)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Ads ──────────────────────────────────────────────────────────────────────

export function AdsPanel() {
  const { data, loading } = useRpc('growth_ad_performance');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ period: '', amount: '' });
  const [saving, setSaving] = useState(false);

  if (loading) return <Spinner />;

  const good = Number(data?.threshold_good || 0);
  const warn = Number(data?.threshold_warn || 0);
  const attr = data?.attribution || {};
  const months = data?.months || [];

  const cpmClass = (v) =>
    v == null ? 'text-slate-400'
    : v <= good ? 'text-emerald-700 bg-emerald-50'
    : v <= warn ? 'text-amber-700 bg-amber-50'
    : 'text-rose-700 bg-rose-50';

  const saveSpend = async () => {
    if (!form.period || !form.amount) return;
    setSaving(true);
    const { error } = await supabase.from('ad_spend').upsert({
      period: `${form.period}-01`, channel: 'google_ads',
      amount: Number(form.amount), updated_at: new Date().toISOString(),
    }, { onConflict: 'period,channel' });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast('Spend recorded', 'success');
    setAdding(false);
    window.location.reload();
  };

  return (
    <div className="space-y-5">
      {attr.pct === 0 && (
        <div className="flex gap-2.5 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <strong>Nothing is attributed yet.</strong> None of the {attr.total} customers added in
            the last 90 days has a lead source recorded, so cost per measure cannot be computed
            for any amount of spend. Ask every caller how they found you and set it on the
            customer record — the field is on the new-customer form.
          </div>
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">Cost per booked measure</h2>
        <p className="mt-2 text-[13px] text-slate-600 leading-relaxed max-w-2xl">
          The only ad number worth watching. Clicks, impressions and CTR are not what is being
          bought — an appointment is. Thresholds are derived from live gross profit per
          appointment ({money(data?.gp_per_visit)}), so they move with the business instead of
          going stale.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
            Under {money(good)} — profitable
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
            {money(good)}–{money(warn)} — tune it
          </span>
          <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700">
            Over {money(warn)} — buying work you don&apos;t want
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">By month</h2>
          <button
            onClick={() => setAdding(a => !a)}
            className="ml-auto inline-flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50"
          >
            <Plus size={13} /> Record spend
          </button>
        </div>

        {adding && (
          <div className="p-4 bg-slate-50 border-b border-slate-100 flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-600">
              Month
              <input type="month" value={form.period}
                onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                className="block mt-1 border border-slate-200 rounded-md px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-600">
              Spend (AUD, ex GST)
              <input type="number" min="0" step="1" value={form.amount} placeholder="2000"
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="block mt-1 border border-slate-200 rounded-md px-2 py-1.5 text-sm tabular-nums w-32" />
            </label>
            <button onClick={saveSpend} disabled={saving || !form.period || !form.amount}
              className="inline-flex items-center gap-1.5 text-sm bg-slate-900 text-white rounded-lg px-3 py-2 disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
          </div>
        )}

        {months.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No spend recorded and no paid leads attributed yet. This fills in once the campaign
            runs and lead sources are being captured.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th className="text-left font-medium px-4 py-2.5">Month</th>
                  <th className="text-right font-medium px-3 py-2.5">Spend</th>
                  <th className="text-right font-medium px-3 py-2.5">Measures</th>
                  <th className="text-right font-medium px-3 py-2.5">Won</th>
                  <th className="text-right font-medium px-3 py-2.5">Revenue</th>
                  <th className="text-right font-medium px-3 py-2.5">GP</th>
                  <th className="text-right font-medium px-4 py-2.5">Cost / measure</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {months.map(m => (
                  <tr key={m.period} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{m.period}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{money(m.spend)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{m.measures}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{m.won}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{money(m.revenue)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-900">{money(m.gp)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-block font-semibold px-2 py-0.5 rounded ${cpmClass(m.cost_per_measure)}`}>
                        {m.cost_per_measure == null ? '—' : money(m.cost_per_measure)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-100 flex gap-2 text-xs text-slate-600">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            Attribution coverage: <strong>{attr.asked ?? 0} of {attr.total ?? 0}</strong> customers
            added in the last 90 days have a lead source
            {attr.pct != null && <> ({attr.pct}%)</>}. Cost per measure is only as true as this number.
          </span>
        </div>
      </Card>
    </div>
  );
}

// ── Territory ────────────────────────────────────────────────────────────────

export function TerritoryPanel() {
  const { data, loading } = useRpc('growth_measure_batches');
  if (loading) return <Spinner />;

  const pending = data?.pending || [];
  const territory = data?.territory || [];
  const overall = territory.length
    ? territory.reduce((a, t) => a + Number(t.revenue), 0) /
      territory.reduce((a, t) => a + Number(t.jobs), 0)
    : 0;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <MapPin size={14} className="text-amber-600" />
          <h2 className="text-sm font-semibold text-slate-900">Waiting on a visit</h2>
          <span className="text-xs text-slate-400 ml-auto">{data?.pending_total ?? 0} open</span>
        </div>
        {pending.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Nothing is waiting on a visit. This groups open work by postcode so trips can be
            clustered — it earns its keep once the ads start producing enquiries.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map(g => (
              <div key={`${g.postcode}-${g.suburb}`} className="p-3.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-900">{g.suburb}</span>
                  <span className="text-xs font-mono text-slate-400">{g.postcode}</span>
                  <span className="text-xs text-slate-500 ml-auto">
                    {g.waiting} waiting · oldest {g.oldest_days}d
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(g.items || []).map((it, i) => (
                    it.job_id
                      ? <Link key={i} to={`/jobs/${it.job_id}`}
                          className="text-xs bg-slate-100 hover:bg-amber-100 rounded px-2 py-1">
                          {it.name} · {it.days}d
                        </Link>
                      : <span key={i} className="text-xs bg-slate-100 rounded px-2 py-1">
                          {it.name} · {it.days}d
                        </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Where the money actually is</h2>
          <p className="text-xs text-slate-500 mt-1">
            Won work by postcode, last three years. Average job size varies by more than 3× across
            these — which is a bid adjustment in the ads, not a curiosity.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                <th className="text-left font-medium px-4 py-2.5">Postcode</th>
                <th className="text-left font-medium px-3 py-2.5">Area</th>
                <th className="text-right font-medium px-3 py-2.5">Customers</th>
                <th className="text-right font-medium px-3 py-2.5">Jobs won</th>
                <th className="text-right font-medium px-3 py-2.5">Revenue</th>
                <th className="text-right font-medium px-4 py-2.5">Avg job</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {territory.map(t => {
                const hot = overall > 0 && Number(t.avg_job) > overall * 1.5;
                return (
                  <tr key={t.postcode} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-900">{t.postcode}</td>
                    <td className="px-3 py-2.5 text-slate-600">{t.suburb}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{t.customers}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{t.jobs}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{money(t.revenue)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={hot ? 'font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded' : 'text-slate-900'}>
                        {money(t.avg_job)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-100 flex gap-2 text-xs text-slate-600">
          <TrendingDown size={13} className="shrink-0 mt-0.5 rotate-180" />
          <span>
            Highlighted postcodes average more than 1.5× the overall job size. Those are the ones
            worth a positive location bid adjustment in Google Ads, and worth crossing town for.
          </span>
        </div>
      </Card>
    </div>
  );
}
