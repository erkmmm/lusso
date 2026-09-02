/**
 * The SEO content pipeline, from the CRM.
 *
 * Two halves that are easy to confuse:
 *   • WRITING happens on the Mac. Pages are built by Claude, one long run each,
 *     and committed to the `queue` branch. A browser cannot start that — there
 *     is no Claude on this side of the wire — so the Monday task does it.
 *   • PUBLISHING is a GitHub Action fast-forwarding `main` over the queue. That
 *     is a single API call, so it CAN be triggered from here.
 *
 * Hence one button, not two: publish now. Everything else is a readout.
 */

import { useEffect, useState } from 'react';
import { FileStack, AlertTriangle, RefreshCw, Send, CheckCircle2, Info, PenLine, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';

export default function ContentQueue() {
  const [state, setState] = useState(() =>
    supabase ? { loading: true } : { loading: false, error: 'offline' });
  const [busy, setBusy] = useState(false);

  const apply = (data, error) =>
    setState({ loading: false, ...(error ? { error: error.message } : data) });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.functions.invoke('content-queue-status')
      .then(({ data, error }) => { if (!cancelled) apply(data, error); });
    return () => { cancelled = true; };
  }, []);

  const refresh = () => {
    if (!supabase) return;
    setState({ loading: true });
    supabase.functions.invoke('content-queue-status').then(({ data, error }) => apply(data, error));
  };

  const publishNow = async (count) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('content-queue-status', {
      body: { action: 'publish', count },
    });
    setBusy(false);
    if (error || !data?.ok) {
      const msg = data?.hint ? `${data.error} — ${data.hint}` : (data?.error || error?.message);
      return toast(`Couldn't publish: ${msg}`, 'error', { duration: 9000 });
    }
    // The Action takes a minute or two, and the queue count won't move until it
    // has. Saying so beats a refresh that appears to have done nothing.
    toast(`Publishing ${count} post${count === 1 ? '' : 's'} — GitHub takes a minute or two`, 'success');
  };

  const requestRun = async () => {
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('content-queue-status', {
      body: { action: 'request-run' },
    });
    setBusy(false);
    if (err || !data?.ok) {
      const msg = data?.hint ? `${data.error} — ${data.hint}` : (data?.error || err?.message);
      return toast(`Couldn't request a run: ${msg}`, 'error', { duration: 9000 });
    }
    toast(data.alreadyRequested
      ? 'Already requested — the Mac will pick it up'
      : 'Requested. The Mac picks it up within a couple of minutes.', 'success');
    // Shown from what we just did, not from a re-read. GitHub takes about a
    // minute to index a newly labelled issue, so refreshing here would come
    // back empty and the button would look like it had done nothing.
    setState(prev => ({
      ...prev,
      pendingRun: { number: data.number, since: new Date().toISOString(), running: false },
    }));
  };

  const { loading, ok, configured, posts, commits, daysOfDrip, perDay, next, error, pendingRun } = state;
  const low = ok && daysOfDrip < 2;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FileStack size={22} className="text-amber-500" /> Content
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Pages waiting to go live on lusso.com.au
        </p>
      </div>

      <Card className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Queue depth</h2>
          <button onClick={refresh} disabled={loading}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
            aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading && <p className="mt-2 text-sm text-slate-400">Checking…</p>}

        {!loading && configured === false && (
          <p className="mt-2 text-sm text-slate-500">Not connected — the repo token isn’t set.</p>
        )}

        {!loading && configured !== false && !ok && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-600">
            <AlertTriangle size={14} /> Couldn’t read the queue{error ? ` (${error})` : ''}
          </p>
        )}

        {!loading && ok && (
          <>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900">{posts}</span>
              <span className="text-sm text-slate-500">
                posts · {daysOfDrip} day{daysOfDrip === 1 ? '' : 's'} at {perDay}/day
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {commits} commits on the queue branch; the rest are tooling and don’t publish.
            </p>
            {low && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                <AlertTriangle size={12} /> Running low — top it up before it empties
              </p>
            )}
          </>
        )}
      </Card>

      {ok && posts > 0 && (
        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Publish now</h2>
          <p className="mt-1 text-xs text-slate-500">
            Sends the next post{posts > 1 ? 's' : ''} live immediately, instead of waiting for
            the 9am or 2pm drip. Same mechanism, just early.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[1, 2, 4].filter(n => n <= posts).map(n => (
              <button key={n} onClick={() => publishNow(n)} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                <Send size={12} /> {n} post{n === 1 ? '' : 's'}
              </button>
            ))}
          </div>
        </Card>
      )}

      {ok && next?.length > 0 && (
        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Next out the door</h2>
          <ul className="mt-3 space-y-2">
            {next.map(p => (
              <li key={p.sha} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-slate-300" />
                <span>{p.message.replace(/^Add /i, '')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-800">Write more pages</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Tops the queue back up to a week’s worth. The writing happens on the Mac — a
          browser has no Claude to run it with — so this leaves a request the Mac picks
          up within a couple of minutes, then works for hours.
        </p>

        {pendingRun ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <Loader2 size={14} className={`mt-0.5 flex-shrink-0 text-amber-600 ${pendingRun.running ? 'animate-spin' : ''}`} />
            <div className="text-xs text-amber-800">
              <p className="font-medium">
                {pendingRun.running ? 'Running now' : 'Requested — waiting for the Mac'}
              </p>
              <p className="mt-0.5 text-amber-700">
                {pendingRun.running
                  ? 'Started on the Mac. It reports back when it finishes.'
                  : 'Picked up within a couple of minutes, if the Mac is awake and logged in.'}
              </p>
            </div>
          </div>
        ) : (
          <button onClick={requestRun} disabled={busy || !ok}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
            <PenLine size={12} /> Request a top-up
          </button>
        )}
      </Card>

      <Card className="px-5 py-4 bg-slate-50/60">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Info size={14} className="text-slate-400" /> How this works
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Pages are written on the Mac and committed to a queue branch. A GitHub Action
          publishes {perDay || 4} a day to lusso.com.au. Nothing here is live until the
          drip sends it — which is why a week’s buffer is the target, not a month’s.
        </p>
      </Card>
    </div>
  );
}
