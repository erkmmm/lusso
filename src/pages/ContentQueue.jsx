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
import { FileStack, AlertTriangle, RefreshCw, Send, Info, PenLine, Loader2, Clock, Plus, X, Eye, Wand2, ImageOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';

export default function ContentQueue() {
  const { user } = useAuth();
  const [state, setState] = useState(() =>
    supabase ? { loading: true } : { loading: false, error: 'offline' });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);  // { loading } | { ok, html, ... }
  const [sched, setSched] = useState(null);      // null until loaded
  const [savingSched, setSavingSched] = useState(false);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const apply = (data, error) =>
    setState({ loading: false, ...(error ? { error: error.message } : data) });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.functions.invoke('content-queue-status')
      .then(({ data, error }) => { if (!cancelled) apply(data, error); });
    supabase.functions.invoke('content-queue-status', { body: { action: 'get-schedule' } })
      .then(({ data }) => { if (!cancelled && data?.ok) setSched(data.slots); });
    return () => { cancelled = true; };
  }, []);

  const openPreview = async (post) => {
    setEditText('');
    setPreview({ loading: true, sha: post.sha, message: post.message });
    const { data, error: err } = await supabase.functions.invoke('content-queue-page', {
      body: { sha: post.sha },
    });
    if (err || !data?.ok) {
      setPreview(null);
      return toast(`Couldn't load that page: ${data?.error || err?.message}`, 'error');
    }
    setPreview({ ...data, sha: post.sha });
  };

  // The page has never been published, so its stylesheet and fonts only exist on
  // the live site — a <base> sends every relative path there. Its photos do not:
  // those are inlined as data URIs by content-queue-page, because they are on the
  // private queue branch and an iframe cannot authenticate to fetch them. A data
  // URI is absolute, so <base> leaves it alone.
  //
  // The CSP meta has to come out first: inside an iframe `default-src 'self'`
  // resolves to nothing useful and blocks the lot — including the data URIs — so
  // the page would render as unstyled text with no pictures.
  //
  // And the copy has to be forced visible. The site fades most of a page in on
  // scroll — `.reveal { opacity: 0 }` until main.js adds `.is-in` from an
  // IntersectionObserver — which is 86% of the words on a typical page. No
  // scripts run under `sandbox=""`, so `.is-in` never arrives and the page
  // previews as a headline over a column of photos with the article missing.
  // Killing the animation is the right fix rather than allowing scripts: this
  // is a proofreading view, so every word should be on screen at once, and the
  // markup stays unable to execute anything inside the CRM.
  const REVEAL_SHIM = `<style>
    .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
  </style>`;

  const previewDoc = (html) => html
    .replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
    .replace(/<head([^>]*)>/i, '<head$1><base href="https://lusso.com.au/">')
    // After the site stylesheet, never before it — an override that loses the
    // cascade is an override that does nothing.
    .replace(/<\/head>/i, `${REVEAL_SHIM}</head>`);

  const setSlot = (i, field, v) =>
    setSched(s => s.map((x, j) => (j === i ? { ...x, [field]: Number(v) } : x)));
  const addSlot = () => setSched(s => [...s, { hour: 12, count: 1 }]);
  const removeSlot = (i) => setSched(s => s.filter((_, j) => j !== i));

  const saveSchedule = async () => {
    setSavingSched(true);
    const { data, error: err } = await supabase.functions.invoke('content-queue-status', {
      body: { action: 'set-schedule', slots: sched },
    });
    setSavingSched(false);
    if (err || !data?.ok) {
      const msg = data?.hint ? `${data.error} — ${data.hint}` : (data?.error || err?.message);
      return toast(`Couldn't save the schedule: ${msg}`, 'error', { duration: 9000 });
    }
    setSched(data.slots);
    toast(`Saved — ${data.perDay} a day. Takes effect once it reaches main.`, 'success');
  };

  const requestEdit = async () => {
    const instruction = editText.trim();
    if (!instruction) return;
    setEditBusy(true);
    const { data, error: err } = await supabase.functions.invoke('content-queue-status', {
      body: {
        action: 'request-edit',
        filename: preview.filename,
        instruction,
        requestedBy: user?.email,
      },
    });
    setEditBusy(false);
    if (err || !data?.ok) {
      const msg = data?.hint ? `${data.error} — ${data.hint}` : (data?.error || err?.message);
      return toast(`Couldn't request that edit: ${msg}`, 'error', { duration: 9000 });
    }
    setEditText('');
    toast(data.alreadyRequested
      ? 'This page already has an edit waiting — the Mac will do both together'
      : 'Asked for. The Mac picks it up within a couple of minutes.', 'success');
    // Shown from what we just did, not from a re-read: GitHub takes about a
    // minute to index a newly labelled issue, so refreshing here would come back
    // without it and the request would look like it had gone nowhere.
    setState(prev => ({
      ...prev,
      editRequests: [
        ...(prev.editRequests ?? []).filter(e => e.file !== preview.filename),
        { number: data.number, file: preview.filename, since: new Date().toISOString(), running: false },
      ],
    }));
  };

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

  const { loading, ok, configured, posts, commits, daysOfDrip, perDay, next, all, error,
          pendingRun, editRequests } = state;
  const list = all?.length ? all : next;
  const low = ok && daysOfDrip < 2;
  // Which page the open preview is, in edit terms. Matched on filename because
  // that is what survives an edit — applying one rewrites the commit, so the sha
  // in `list` stops existing the moment the Mac finishes.
  const pendingEdit = editRequests?.find(e => e.file === preview?.filename);

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

      {ok && list?.length > 0 && (
        <Card className="px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">In the queue</h2>
            <span className="text-xs text-slate-400">publishing order · tap to read</span>
          </div>
          <ol className="mt-3 divide-y divide-slate-100">
            {list.map((p, i) => {
              // Which day each one lands on, at the current rate. The queue is
              // strictly FIFO, so position is a date — which is the thing you
              // actually want to know when looking at a list this long.
              const day = Math.floor(i / (perDay || 4));
              const when = day === 0 ? 'today' : day === 1 ? 'tomorrow' : `in ${day} days`;
              return (
                <li key={p.sha}>
                  <button onClick={() => openPreview(p)}
                    className="group flex w-full items-baseline gap-3 py-2 text-left hover:bg-slate-50">
                    <span className="w-6 flex-shrink-0 text-right text-xs tabular-nums text-slate-300">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-slate-700">
                      {p.message.replace(/^Add /i, '')}
                    </span>
                    <Eye size={13} className="flex-shrink-0 text-slate-200 group-hover:text-slate-400" />
                    <span className={`flex-shrink-0 text-xs ${day === 0 ? 'font-medium text-green-600' : 'text-slate-400'}`}>
                      {when}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {editRequests?.length > 0 && (
        <Card className="px-5 py-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Wand2 size={14} className="text-slate-400" /> Edits waiting
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Asked for from a preview. Each one amends the queued page in place, so it goes
            live with the change instead of going live twice.
          </p>
          <ul className="mt-3 divide-y divide-slate-100">
            {editRequests.map(e => (
              <li key={e.number} className="flex items-center gap-2 py-2">
                <Loader2 size={12} className={`flex-shrink-0 text-slate-300 ${e.running ? 'animate-spin text-amber-500' : ''}`} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{e.file}</span>
                <span className="flex-shrink-0 text-xs text-slate-400">
                  {e.running ? 'editing now' : 'waiting for the Mac'}
                </span>
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

      {sched && (
        <Card className="px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <Clock size={14} className="text-slate-400" /> Publishing times
            </h2>
            <span className="text-xs text-slate-400">
              {sched.reduce((n, s) => n + (Number(s.count) || 0), 0)} a day · AEST
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            When the drip runs and how many it sends each time. Between 6am and 8pm —
            outside that the workflow is asleep and a slot would never fire.
          </p>

          <div className="mt-3 space-y-2">
            {sched.map((slot, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={slot.hour} onChange={e => setSlot(i, 'hour', e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                  {Array.from({ length: 15 }, (_, h) => h + 6).map(h => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
                <select value={slot.count} onChange={e => setSlot(i, 'count', e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                  {[1, 2, 3, 4].map(c => (
                    <option key={c} value={c}>{c} post{c === 1 ? '' : 's'}</option>
                  ))}
                </select>
                <button onClick={() => removeSlot(i)} disabled={sched.length <= 1}
                  className="text-slate-300 hover:text-rose-500 disabled:opacity-30"
                  aria-label="Remove this time">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button onClick={addSlot} disabled={sched.length >= 8}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              <Plus size={12} /> Add a time
            </button>
            <button onClick={saveSchedule} disabled={savingSched}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
              {savingSched ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </Card>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/50 p-3 sm:p-6"
          onClick={() => setPreview(null)}>
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {preview.title || preview.message?.replace(/^Add /i, '') || 'Loading…'}
                </p>
                {preview.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{preview.description}</p>
                )}
                {preview.filename && (
                  <p className="mt-1 text-xs text-slate-400">
                    {preview.filename} · {preview.words?.toLocaleString()} words · not published yet
                  </p>
                )}
              </div>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-700"
                aria-label="Close preview">
                <X size={18} />
              </button>
            </div>

            {preview.loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
            ) : (
              <>
                <iframe
                  title={preview.filename || 'Queued page'}
                  srcDoc={previewDoc(preview.html)}
                  sandbox=""
                  className="flex-1 w-full border-0 bg-white"
                />

                <div className="border-t border-slate-100 px-4 py-3">
                  {pendingEdit ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <Loader2 size={14} className={`mt-0.5 flex-shrink-0 text-amber-600 ${pendingEdit.running ? 'animate-spin' : ''}`} />
                      <div className="text-xs text-amber-800">
                        <p className="font-medium">
                          {pendingEdit.running ? 'Being edited now' : 'Edit requested — waiting for the Mac'}
                        </p>
                        <p className="mt-0.5 text-amber-700">
                          The queued page is amended in place, so it publishes with the change
                          rather than publishing twice. Ask for another once this one lands.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <label htmlFor="queue-edit" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <Wand2 size={13} className="text-slate-400" /> Change something
                      </label>
                      <textarea
                        id="queue-edit"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={2}
                        maxLength={4000}
                        placeholder="Swap the second photo for one with a courtyard. Tighten the intro."
                        className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-300 focus:border-slate-400 focus:outline-none"
                      />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-400">
                          Written on the Mac, same as the pages themselves — a couple of
                          minutes to start, then it edits and re-queues the page.
                        </p>
                        <button onClick={requestEdit} disabled={editBusy || !editText.trim()}
                          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                          <Wand2 size={12} /> {editBusy ? 'Asking…' : 'Request edit'}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                  Styling comes from the live site; the photos are the queued ones
                  {preview.images ? ` (${preview.images.inlined} loaded)` : ''}. Scroll
                  animations are off, so the whole page reads at once.
                  {preview.images?.missing > 0 && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <ImageOff size={11} /> {preview.images.missing} too large to preview
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

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
