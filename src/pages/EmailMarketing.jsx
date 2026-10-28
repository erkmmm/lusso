import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Loader2, Send, Eye, X, AlertTriangle, CheckCircle2, Ban, Users, RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast } from '../components/ToastContainer';
import Card from '../components/Card';

// What each segment actually is, in the words that decide whether to mail it.
// The letters on their own mean nothing to anyone who didn't build this.
const SEGMENTS = {
  A: { label: '0–2 years',  blurb: 'Recent. Ask for the review, not the sale.' },
  B: { label: '2–5 years',  blurb: 'The room they skipped. Motorisation retrofit.' },
  C: { label: '5–8 years',  blurb: 'Service window — repairs are the point here.' },
  D: { label: '8+ years',   blurb: 'Replacement cycle. Highest repair volume.' },
  E: { label: 'Quoted, never bought', blurb: 'Needs a reason to come back, not a nudge.' },
  F: { label: 'No quote on record',   blurb: 'Imported contacts. Mostly unusable addresses.' },
};

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();

export default function EmailMarketing() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);   // campaign id mid-request
  const [preview, setPreview] = useState(null);   // { campaign, result }
  const [confirm, setConfirm] = useState(null);   // campaign pending a real send
  const [me, setMe]           = useState('');

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('marketing_dashboard');
    if (error) toast(`Could not load campaigns: ${error.message}`, 'error');
    else setData(d);
    setLoading(false);
  }, []);

  // Promise-then with a cancelled flag, matching ContentQueue — the initial
  // load must not setState into an unmounted page.
  useEffect(() => {
    let cancelled = false;
    supabase.rpc('marketing_dashboard').then(({ data: d, error }) => {
      if (cancelled) return;
      if (error) toast(`Could not load campaigns: ${error.message}`, 'error');
      else setData(d);
      setLoading(false);
    });
    supabase.auth.getUser().then(({ data: u }) => {
      if (!cancelled) setMe(u?.user?.email || '');
    });
    return () => { cancelled = true; };
  }, []);

  /** Call the wave sender. Every button on this page goes through here. */
  const call = async (campaignId, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ campaignId, ...body }),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Sender returned HTTP ${res.status}`);
    return json;
  };

  const doPreview = async (c) => {
    setBusy(c.id);
    try { setPreview({ campaign: c, result: await call(c.id, { dryRun: true }) }); }
    catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(null); }
  };

  const doTest = async (c) => {
    if (!me) return toast('No address on your account to send a test to.', 'error');
    setBusy(c.id);
    try {
      await call(c.id, { testTo: me });
      toast(`Test sent to ${me} — it uses the first real recipient's details.`);
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(null); }
  };

  const doSend = async (c) => {
    setConfirm(null);
    setBusy(c.id);
    try {
      const r = await call(c.id, {});
      toast(`Wave ${r.wave}: ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}. ${r.remaining} left in this segment.`,
        r.failed ? 'error' : 'success');
      if (r.errors?.length) console.warn('[marketing-send] failures:', r.errors);
      await load();
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 text-sm p-8">
      <Loader2 size={16} className="animate-spin" /> Loading campaigns…
    </div>;
  }

  const segments  = data?.segments ?? [];
  const campaigns = data?.campaigns ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <Mail size={20} className="text-slate-400" /> Email
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Campaigns go out in waves sized to what the install diary can absorb — the repair
            requests these generate are the point, but only at a rate you can service.
          </p>
        </div>
        <button onClick={load} className="text-slate-400 hover:text-slate-600 p-2" title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* ── Who is on the list ── */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Users size={14} className="text-slate-400" /> The list
          </h2>
          {data?.suppressed > 0 && (
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <Ban size={12} /> {data.suppressed} suppressed
            </span>
          )}
        </div>
        <div className="divide-y divide-slate-50">
          {segments.map(s => (
            <div key={s.segment} className="px-5 py-3 flex items-center gap-4">
              <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold
                               flex items-center justify-center flex-shrink-0">{s.segment}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700">{SEGMENTS[s.segment]?.label || s.segment}</p>
                <p className="text-xs text-slate-400 truncate">{SEGMENTS[s.segment]?.blurb}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm text-slate-700 tabular-nums">
                  {s.retail}<span className="text-slate-300"> retail</span>
                  {s.trade > 0 && <span className="text-slate-400"> · {s.trade} trade</span>}
                </p>
                <p className="text-xs text-slate-400 tabular-nums">{money(s.value)} lifetime</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Campaigns ── */}
      <div className="space-y-3">
        {campaigns.map(c => {
          const thisWave = Math.min(c.wave_size, c.remaining);
          const done     = c.remaining === 0;
          return (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-800 text-sm">{c.name}</h3>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      c.status === 'done'    ? 'bg-green-100 text-green-700'
                      : c.status === 'sending' ? 'bg-amber-100 text-amber-700'
                      : c.status === 'paused'  ? 'bg-slate-100 text-slate-500'
                      : 'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-mono">{c.subject}</p>
                  {c.notes && <p className="text-xs text-slate-400 mt-2 max-w-xl">{c.notes}</p>}

                  <div className="flex items-center gap-4 mt-3 text-xs text-slate-500 tabular-nums flex-wrap">
                    <span><strong className="text-slate-700">{c.sent}</strong> sent</span>
                    <span><strong className="text-slate-700">{c.remaining}</strong> still to go</span>
                    <span>{c.waves} wave{c.waves === 1 ? '' : 's'} of {c.wave_size}</span>
                    {c.replied > 0 && <span className="text-green-600">{c.replied} replied</span>}
                    {c.failed  > 0 && <span className="text-red-500">{c.failed} failed</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => doPreview(c)} disabled={busy === c.id || done}
                    className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 text-slate-600
                               hover:bg-slate-50 rounded-lg px-2.5 py-1.5 disabled:opacity-40">
                    <Eye size={12} /> Preview
                  </button>
                  <button onClick={() => doTest(c)} disabled={busy === c.id || done}
                    className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 text-slate-600
                               hover:bg-slate-50 rounded-lg px-2.5 py-1.5 disabled:opacity-40">
                    <Send size={12} /> Test to me
                  </button>
                  <button onClick={() => setConfirm({ ...c, thisWave })} disabled={busy === c.id || done}
                    className="flex items-center gap-1.5 text-xs font-medium bg-slate-800 text-white
                               hover:bg-slate-700 rounded-lg px-3 py-1.5 disabled:opacity-40">
                    {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    {done ? 'All sent' : `Send ${thisWave}`}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ── Preview ── */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
             onClick={() => setPreview(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full my-8" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">{preview.campaign.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Wave {preview.result.wave} · {preview.result.inThisWave} recipients ·
                  {' '}from {preview.result.from}
                </p>
              </div>
              <button onClick={() => setPreview(null)} className="text-slate-300 hover:text-slate-500 p-1">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {(preview.result.preview ?? []).map((p, i) => (
                <div key={i} className="border border-slate-100 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                    <p className="text-xs text-slate-500">To {p.name} · {p.to}</p>
                    <p className="text-sm font-medium text-slate-800 mt-0.5">{p.subject}</p>
                  </div>
                  {p.problems?.length > 0 && (
                    <div className="px-3 py-2 bg-red-50 text-xs text-red-700 flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                      {p.problems.join('; ')} — this recipient would be skipped.
                    </div>
                  )}
                  <pre className="px-3 py-3 text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">
                    {p.text}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Send confirmation ──
          A wave is real mail to real customers and cannot be recalled, so the
          count and the segment are spelled out rather than assumed. */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
             onClick={() => setConfirm(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Send this wave?
            </h3>
            <p className="text-sm text-slate-600 mt-3">
              <strong>{confirm.thisWave}</strong> customers in segment {confirm.segment}
              {' '}({SEGMENTS[confirm.segment]?.label}) will get
              {' '}&ldquo;<span className="font-mono text-xs">{confirm.subject}</span>&rdquo;.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {confirm.remaining - confirm.thisWave} would be left for later waves. Replies thread
              back onto each customer&rsquo;s record. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirm(null)}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
              <button onClick={() => doSend(confirm)}
                className="flex items-center gap-1.5 text-sm font-medium bg-slate-800 text-white
                           hover:bg-slate-700 rounded-lg px-4 py-2">
                <CheckCircle2 size={14} /> Send {confirm.thisWave}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
