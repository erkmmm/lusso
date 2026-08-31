/**
 * Import track pricing from a supplier price book into the curtain rate card.
 *
 * Track prices aren't products — the calculator looks them up by band, so they
 * live in the rate card rather than the price library. A new price book means
 * re-typing eighty-odd cells by hand, which is what this replaces.
 *
 * Nothing is written until the change has been shown: every band is listed old
 * against new with the percentage move, because a rate card that silently
 * changes underneath you is worse than one you have to type.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, ArrowLeft, ArrowRight, Check, AlertTriangle, Table2, TrendingUp, TrendingDown } from 'lucide-react';
import { extractPdfPages, findTrackTables, suggestTrackType, diffAgainstRates } from '../lib/trackPriceList';
import { getCurtainRates, saveCurtainRates, getCurtainRatesRaw } from '../store/data';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';

const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);
const metres = (mm) => `${mm / 1000}m`;

function Pct({ value }) {
  if (value === null || value === undefined) return <span className="text-[11px] text-slate-300">new</span>;
  if (value === 0) return <span className="text-[11px] text-slate-400">—</span>;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? 'text-amber-700' : 'text-teal-700'}`}>
      <Icon size={11} />{up ? '+' : ''}{value}%
    </span>
  );
}

export default function ImportTrackPrices() {
  const navigate = useNavigate();
  const rates = getCurtainRates();
  const trackTypes = Object.keys(rates.oslo.prices);

  const [file, setFile]         = useState(null);
  const [reading, setReading]   = useState(false);
  const [error, setError]       = useState('');
  const [tables, setTables]     = useState(null);   // detected series tables
  const [mapping, setMapping]   = useState({});     // table index → rate-card track name
  const [applied, setApplied]   = useState(null);

  const pick = async (f) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setError('That needs to be a PDF.'); return; }
    setFile(f); setError(''); setTables(null); setApplied(null);
    setReading(true);
    try {
      const pages = await extractPdfPages(f);
      const found = findTrackTables(pages);
      if (!found.length) {
        setError('No banded track tables found. This importer looks for a "Track Size" table with a Standard and a Wave column.');
        return;
      }
      const auto = {};
      found.forEach((t, i) => {
        const s = suggestTrackType(t.title, trackTypes);
        // One rate-card track per series — the first (best) match wins.
        if (s && !Object.values(auto).includes(s)) auto[i] = s;
      });
      setTables(found);
      setMapping(auto);
    } catch (e) {
      setError(`Could not read the PDF: ${e.message}`);
    } finally {
      setReading(false);
    }
  };

  const mapped = tables ? Object.entries(mapping).filter(([, v]) => v) : [];

  const apply = () => {
    const raw = getCurtainRatesRaw();
    const nextPrices = { ...(rates.oslo.prices || {}) };
    for (const [idx, trackName] of mapped) {
      const t = tables[idx];
      nextPrices[trackName] = {
        widthsMm:  t.widthsMm,
        standard:  t.standard,
        clearWave: t.clearWave,
      };
    }
    saveCurtainRates({
      ...raw,
      oslo: { ...(raw.oslo || {}), prices: nextPrices },
    });
    setApplied(mapped.map(([idx, name]) => ({ name, bands: tables[idx].bands.length })));
    toast(`Updated ${mapped.length} track price table${mapped.length === 1 ? '' : 's'}.`);
  };

  // ── Applied ────────────────────────────────────────────────────────────────
  if (applied) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-teal-600" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">Track prices updated</h1>
          <p className="text-sm text-slate-500 mb-5">
            The curtain calculator prices from these immediately — open quotes reprice on their next load.
          </p>
          <div className="inline-block text-left border border-slate-200 rounded-xl overflow-hidden mb-6">
            {applied.map(a => (
              <div key={a.name} className="flex items-baseline gap-3 px-4 py-2 border-b border-slate-100 last:border-0">
                <Check size={12} className="text-teal-500" />
                <span className="text-sm font-medium text-slate-800">{a.name}</span>
                <span className="text-xs text-slate-400">{a.bands} bands</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => navigate('/settings?section=curtains')}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg">
              View the rate card
            </button>
            <button onClick={() => { setFile(null); setTables(null); setApplied(null); }}
              className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
              Import another
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <button onClick={() => navigate('/settings?section=curtains')}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
        <ArrowLeft size={13} /> Curtain Rates
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Update track prices</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Read a supplier price book and replace the banded track prices the curtain calculator uses.
        </p>
      </div>

      {/* ── Upload ─────────────────────────────────────────────────────────── */}
      {!tables && (
        <Card className="p-5">
          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl py-10 cursor-pointer transition-colors ${
            reading ? 'border-amber-300 bg-amber-50' : 'border-slate-200 hover:border-amber-300 hover:bg-amber-50/40'
          }`}>
            <input type="file" accept="application/pdf" className="hidden"
                   onChange={e => pick(e.target.files?.[0])} />
            {reading ? (
              <>
                <Table2 size={22} className="text-amber-500 animate-pulse" />
                <span className="text-sm font-medium text-amber-700">Reading the price book…</span>
                <span className="text-xs text-slate-400">{file?.name}</span>
              </>
            ) : (
              <>
                <Upload size={22} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-700">Drop a supplier price book here</span>
                <span className="text-xs text-slate-400">PDF · looks for &ldquo;Track Size&rdquo; tables</span>
              </>
            )}
          </label>

          <div className="mt-4 flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <FileText size={15} className="text-slate-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600">
              Made-to-measure track pricing is banded — a price per track length, in Standard and Wave.
              Each series in the book is found separately, so you choose which one replaces which track
              on your rate card. Bands are taken exactly as printed, including a series that stops
              early: the calculator then refuses to price past it rather than guessing.
            </p>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </Card>
      )}

      {/* ── Detected series ────────────────────────────────────────────────── */}
      {tables && (
        <>
          <Card className="overflow-hidden">
            <div className="px-5 py-3 bg-teal-50 border-b border-teal-200 flex flex-wrap items-center gap-2">
              <Table2 size={15} className="text-teal-600" />
              <span className="text-sm font-semibold text-teal-800">
                {tables.length} track series found
              </span>
              <span className="text-xs text-teal-700">{file?.name}</span>
              <button onClick={() => { setTables(null); setFile(null); }}
                className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-700">
                Start over
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-slate-500 mb-3">
                Choose which series replaces each track on your rate card. A series you leave unset is ignored.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 560 }}>
                  <thead className="text-slate-400 text-left">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Series</th>
                      <th className="pb-2 pr-3 font-medium">Bands</th>
                      <th className="pb-2 pr-3 font-medium">From</th>
                      <th className="pb-2 font-medium">Replaces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, i) => {
                      const active = !!mapping[i];
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className={`py-2 pr-3 ${active ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                            {t.title}
                            {t.notAvailableOverMm && (
                              <span className="ml-1.5 text-[10px] text-amber-600">
                                not available over {metres(t.notAvailableOverMm)}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
                            {t.bands.length} · {metres(t.widthsMm[0])}–{metres(t.widthsMm.at(-1))}
                          </td>
                          <td className="py-2 pr-3 text-slate-400">p{t.page}</td>
                          <td className="py-2">
                            <select
                              value={mapping[i] || ''}
                              onChange={e => setMapping(m => {
                                const next = { ...m };
                                if (e.target.value) {
                                  for (const k of Object.keys(next)) if (next[k] === e.target.value) delete next[k];
                                  next[i] = e.target.value;
                                } else delete next[i];
                                return next;
                              })}
                              className={`border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                                active ? 'border-teal-300 bg-teal-50 text-teal-800 font-medium' : 'border-slate-200 text-slate-500'
                              }`}
                            >
                              <option value="">Ignore</option>
                              {trackTypes.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* ── What changes ─────────────────────────────────────────────────── */}
          {mapped.map(([idx, trackName]) => {
            const t = tables[idx];
            const current = rates.oslo.prices[trackName];
            const currentWidths = current?.widthsMm?.length ? current.widthsMm : rates.oslo.widthsMm;
            const d = diffAgainstRates(t, { ...current, widthsMm: currentWidths });
            return (
              <Card key={idx} className="overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-800">{trackName}</span>
                  <span className="text-xs text-slate-400">← {t.title}</span>
                  <span className="ml-auto text-xs text-slate-500">
                    {d.changed} of {d.rows.length} bands change
                  </span>
                </div>
                {d.dropped.length > 0 && (
                  <div className="mx-5 mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-amber-900">
                      The new list stops at {metres(t.widthsMm.at(-1))}. Bands you have now at{' '}
                      {d.dropped.map(metres).join(', ')} are not in it — after this, the calculator
                      will refuse to price {trackName} above {metres(t.widthsMm.at(-1))} rather than
                      use last year&rsquo;s number.
                    </p>
                  </div>
                )}
                <div className="px-5 py-3 overflow-x-auto">
                  <table className="w-full text-xs tabular-nums" style={{ minWidth: 480 }}>
                    <thead className="text-slate-400 text-left">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">Track</th>
                        <th className="pb-2 pr-2 font-medium text-right" colSpan={3}>Standard</th>
                        <th className="pb-2 pr-2 font-medium text-right" colSpan={3}>Wave</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map(r => (
                        <tr key={r.widthMm} className="border-t border-slate-50">
                          <td className="py-1.5 pr-4 text-slate-600 font-medium">{metres(r.widthMm)}</td>
                          <td className="py-1.5 text-right text-slate-400">{money(r.oldStandard)}</td>
                          <td className="py-1.5 px-1 text-slate-300">→</td>
                          <td className="py-1.5 text-right font-semibold text-slate-800">{money(r.newStandard)}</td>
                          <td className="py-1.5 pl-2 pr-4 text-right"><Pct value={r.stdPct} /></td>
                          <td className="py-1.5 text-right text-slate-400">{money(r.oldClearWave)}</td>
                          <td className="py-1.5 px-1 text-slate-300">→</td>
                          <td className="py-1.5 text-right font-semibold text-slate-800">{money(r.newClearWave)}</td>
                          <td className="py-1.5 pl-2 text-right"><Pct value={r.wavePct} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}

          <button
            onClick={apply}
            disabled={mapped.length === 0}
            className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-colors ${
              mapped.length === 0
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-600 hover:bg-teal-500 text-white'
            }`}
          >
            <Check size={15} />
            {mapped.length === 0
              ? 'Choose at least one series to import'
              : `Update ${mapped.length} track price table${mapped.length === 1 ? '' : 's'}`}
            {mapped.length > 0 && <ArrowRight size={15} />}
          </button>
          <p className="text-center text-xs text-slate-400">
            This replaces the bands on your rate card. Nothing else in the rate card is touched.
          </p>
        </>
      )}
    </div>
  );
}
