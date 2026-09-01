/**
 * How deep the SEO drip queue is.
 *
 * The queue lives as a git branch in a private repo, published four posts a day
 * by a GitHub Action. Nothing about it is in this database, so the only honest
 * source is the branch itself — read through the `content-queue-status` edge
 * function, which holds the repo token server-side.
 *
 * It answers one question: is the content engine about to run dry. Below about
 * two days of buffer there is time to do something; at zero the site simply
 * stops publishing and nobody finds out for a week.
 */

import { useEffect, useState } from 'react';
import { FileStack, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Card from './Card';

export default function ContentQueueCard() {
  // The offline case is decided here rather than inside the effect, so the
  // effect never sets state synchronously — that path is what makes React
  // render twice before the first paint.
  const [state, setState] = useState(() =>
    supabase ? { loading: true } : { loading: false, error: 'offline' });

  const apply = (data, error) =>
    setState({ loading: false, ...(error ? { error: error.message } : data) });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.functions
      .invoke('content-queue-status')
      .then(({ data, error }) => { if (!cancelled) apply(data, error); });
    return () => { cancelled = true; };
  }, []);

  // The button, unlike the mount, does want the spinner straight away.
  const refresh = () => {
    if (!supabase) return;
    setState({ loading: true });
    supabase.functions.invoke('content-queue-status').then(({ data, error }) => apply(data, error));
  };

  const { loading, ok, configured, posts, daysOfDrip, perDay, next, error } = state;

  // Under two days is worth noticing before it becomes zero.
  const low = ok && daysOfDrip < 2;

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileStack size={16} className={low ? 'text-amber-500' : 'text-slate-400'} />
          <h2 className="text-sm font-semibold text-slate-800">Content queue</h2>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
          aria-label="Refresh content queue status"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && <p className="mt-2 text-sm text-slate-400">Checking…</p>}

      {!loading && configured === false && (
        <p className="mt-2 text-sm text-slate-500">
          Not connected yet — the repo token hasn’t been set.
        </p>
      )}

      {!loading && configured !== false && !ok && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-600">
          <AlertTriangle size={14} /> Couldn’t read the queue{error ? ` (${error})` : ''}
        </p>
      )}

      {!loading && ok && (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{posts}</span>
            <span className="text-sm text-slate-500">
              posts queued · {daysOfDrip} day{daysOfDrip === 1 ? '' : 's'} at {perDay}/day
            </span>
          </div>
          {low && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600">
              <AlertTriangle size={12} /> Running low — the Monday top-up may not be soon enough
            </p>
          )}
          {next?.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
              {next.map(p => (
                <li key={p.sha} className="truncate text-xs text-slate-500">
                  {p.message.replace(/^Add /i, '')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
