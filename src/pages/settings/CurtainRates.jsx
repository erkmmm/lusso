// ─── Curtain Rates ────────────────────────────────────────────────────────────
// The rate card behind the curtain cost calculator (lib/curtainCalc.js) — the
// numbers that used to live scattered through the Excel workbook's formulas.
//
// Only edited fields are stored; everything else falls through to the defaults,
// so "Reset" is just clearing the row.
import { useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator, Save, RotateCcw, Upload } from 'lucide-react';
import { useDataRefresh } from '../../hooks/useDataRefresh';
import { getCurtainRates, saveCurtainRates, resetCurtainRates } from '../../store/data';
import { toast } from '../../components/ToastContainer';
import SettingsCard from './SettingsCard';

function RateNum({ label, value, onChange, prefix, suffix, hint, step = 'any' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{prefix}</span>}
        <input
          type="number" step={step} value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={`w-full border border-slate-200 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${prefix ? 'pl-6' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'}`}
        />
        {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function CurtainRates() {
  useDataRefresh();
  const navigate = useNavigate();
  const [rates, setRates] = useState(() => getCurtainRates());
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Nested setter: path is a dot path into the rate card.
  const put = (path, value) => {
    setRates(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let node = next;
      for (const k of keys.slice(0, -1)) node = node[k];
      node[keys.at(-1)] = value;
      return next;
    });
    setDirty(true);
  };

  const save = () => {
    saveCurtainRates(rates);
    setDirty(false);
    setSavedAt(Date.now());
    toast('Curtain rates saved.');
  };

  const reset = () => {
    setRates(resetCurtainRates());
    setDirty(false);
    setSavedAt(Date.now());
    toast('Curtain rates reset to defaults.');
  };

  const headings = Object.keys(rates.fullness);
  const tracks   = Object.keys(rates.trackRatePerM);
  const osloCols = Object.keys(rates.oslo.prices);
  // Each track can carry its own bands — a recess track is sold 1–6m in half
  // metres, a battery track stops at 8m. The grid is the union of every band in
  // use, and a track with no price at a band shows blank rather than the next
  // value along, which would misrepresent it on screen.
  const osloWidthsFor = (col) =>
    rates.oslo.prices[col]?.widthsMm?.length ? rates.oslo.prices[col].widthsMm : rates.oslo.widthsMm;
  const osloRows = [...new Set(osloCols.flatMap(osloWidthsFor))].sort((a, b) => a - b);
  const osloIdx  = (col, width) => osloWidthsFor(col).indexOf(width);

  return (
    <>
      <SettingsCard
        id="curtain-rates"
        icon={Calculator}
        title="Curtain costing rates"
        description={<>
          What the curtain calculator charges. These are <span className="font-medium">cost</span> rates —
          the sell price still comes from each quote line&apos;s margin. Never shown on a customer&apos;s quote page.
        </>}
        scope="team"
        save={{ kind: 'manual', dirty, savedAt }}
        actions={<>
          <button onClick={reset}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 min-h-[36px]">
            <RotateCcw size={13} /> Reset
          </button>
          <button onClick={save} disabled={!dirty}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 min-h-[36px] ${
              dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            <Save size={13} /> Save
          </button>
        </>}
      >

        {/* Fullness */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Fullness by heading</h3>
        <p className="text-[11px] text-slate-400 mb-3">
          The width is multiplied by this before being divided into drops. Matched regardless of capitalisation.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {headings.map(h => (
            <RateNum key={h} label={h} value={rates.fullness[h]} suffix="×"
              onChange={v => put(`fullness.${h}`, v)} />
          ))}
        </div>

        {/* Fabric + making */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Fabric &amp; making</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <RateNum label="Default fabric roll width" value={rates.fabricWidthMm} suffix="mm"
            onChange={v => put('fabricWidthMm', v)}
            hint="A drop that fits inside this is railroaded (continuous)." />
          <RateNum label="Default fabric price" value={rates.fabricPricePerM} prefix="$" suffix="/m"
            onChange={v => put('fabricPricePerM', v)}
            hint="Used when a quote line doesn't specify one." />
          <RateNum label="Side / return allowance" value={rates.sideAllowanceM} suffix="m"
            onChange={v => put('sideAllowanceM', v)}
            hint="Added to every fullness calculation." />
          <RateNum label="Hem allowance" value={rates.hemAllowanceMm} suffix="mm"
            onChange={v => put('hemAllowanceMm', v)}
            hint="Added to the drop for a cut length." />
          <RateNum label="Making rate" value={rates.makingRatePerDrop} prefix="$" suffix="/drop"
            onChange={v => put('makingRatePerDrop', v)} />
          <RateNum label="Standard drop width" value={rates.makingDropWidthM} suffix="m"
            onChange={v => put('makingDropWidthM', v)}
            hint="Total fullness ÷ this = drops charged for making." />
        </div>

        {/* Lining */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Lining</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <RateNum label="Lining price" value={rates.lining.pricePerM} prefix="$" suffix="/m"
            onChange={v => put('lining.pricePerM', v)} />
          <RateNum label="Lining roll width" value={rates.lining.fabricWidthMm} suffix="mm"
            onChange={v => put('lining.fabricWidthMm', v)} />
          <RateNum label="Lining making rate" value={rates.lining.makingRatePerDrop} prefix="$" suffix="/drop"
            onChange={v => put('lining.makingRatePerDrop', v)} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lining fullness</label>
            <select
              value={rates.lining.followCurtain ? '__follow' : rates.lining.heading}
              onChange={e => {
                if (e.target.value === '__follow') put('lining.followCurtain', true);
                else { put('lining.followCurtain', false); put('lining.heading', e.target.value); }
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="__follow">Match the curtain&apos;s heading</option>
              {headings.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Used for attached linings, which are made the same way every time. A separate
              lining is asked for on the line instead — it is a curtain in its own right.
            </p>
          </div>
        </div>

        {/* Fitting */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Fitting</h3>
        <p className="text-[11px] text-slate-400 mb-3">
          Charged on the width band, plus a surcharge for tall drops. Doubled for dual tracks
          ({rates.fitting.dualTrackTypes.join(', ')}), and increased by the separate-lining
          percentage below when a lining hangs on its own track.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          {rates.fitting.bands.map((b, i) => (
            <RateNum key={i} label={`Up to ${b.maxWidthMm}mm`} value={b.cost} prefix="$"
              onChange={v => put('fitting.bands', rates.fitting.bands.map((x, j) => j === i ? { ...x, cost: v } : x))} />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <RateNum label={`Over ${rates.fitting.over.fromMm}mm — base`} value={rates.fitting.over.base} prefix="$"
            onChange={v => put('fitting.over.base', v)} />
          <RateNum label="…plus, per extra metre" value={rates.fitting.over.step} prefix="$"
            onChange={v => put('fitting.over.step', v)}
            hint="Whole metres only, rounded down." />
          <RateNum label="Tall-drop surcharge over" value={rates.fitting.dropSurcharge.overMm} suffix="mm"
            onChange={v => put('fitting.dropSurcharge.overMm', v)} />
          <RateNum label="…per extra metre of drop" value={rates.fitting.dropSurcharge.amount} prefix="$"
            onChange={v => put('fitting.dropSurcharge.amount', v)}
            hint="Whole metres only, rounded down." />
          {/* Stored as a fraction, shown as a percentage: nobody sets a
              surcharge in 0.7s. A proportion rather than a flat fee so it
              keeps tracking width and drop like the rest of fitting. */}
          <RateNum
            label="Separate lining — extra fitting"
            value={Math.round((rates.fitting.separateLiningExtra ?? 0) * 1000) / 10}
            suffix="%"
            onChange={v => put('fitting.separateLiningExtra', v === '' ? '' : Number(v) / 100)}
            hint="Added on top when a lining hangs on its own track." />
        </div>

        {/* Tracks priced per metre */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Tracks priced per metre</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tracks.map(t => (
            <RateNum key={t} label={t} value={rates.trackRatePerM[t]} prefix="$" suffix="/m"
              onChange={v => put(`trackRatePerM.${t}`, v)} />
          ))}
        </div>
      </SettingsCard>

      {/* Oslo band table */}
      <SettingsCard
        id="oslo-bands"
        icon={Calculator}
        title="Oslo track price bands"
        description="Motorised and Oslo tracks are priced by band, not per metre — the first band at or above the curtain width is the one charged. A Wave Fold heading takes the Clear Wave column. Widths past the last band aren't priced, and the calculator says so rather than guessing."
        scope="team"
        save={{ kind: 'manual', dirty, savedAt }}
      >
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left font-medium text-slate-500 px-2 py-2 sticky left-0 bg-white">Width</th>
                {osloCols.map(c => (
                  <th key={c} colSpan={2} className="text-center font-medium text-slate-600 px-2 py-2 border-l border-slate-100">{c}</th>
                ))}
              </tr>
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 bg-white" />
                {osloCols.map(c => (
                  <Fragment key={c}>
                    <th className="text-center font-normal text-slate-400 px-2 py-1 border-l border-slate-100">Standard</th>
                    <th className="text-center font-normal text-slate-400 px-2 py-1">Clear Wave</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {osloRows.map(w => (
                <tr key={w} className="border-b border-slate-50">
                  <td className="px-2 py-1 text-slate-600 font-medium sticky left-0 bg-white whitespace-nowrap">≤ {w}mm</td>
                  {osloCols.map(c => {
                    const bi = osloIdx(c, w);
                    const cell = (key) => bi < 0
                      ? <span className="block w-20 text-center text-xs text-slate-300">—</span>
                      : (
                        <input type="number" step="any" value={rates.oslo.prices[c][key][bi] ?? ''}
                          onChange={e => put(`oslo.prices.${c}.${key}`,
                            rates.oslo.prices[c][key].map((x, j) => j === bi ? Number(e.target.value) : x))}
                          className="w-20 border border-slate-200 rounded px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      );
                    return (
                      <Fragment key={c}>
                        <td className="px-1 py-1 border-l border-slate-100">{cell('standard')}</td>
                        <td className="px-1 py-1">{cell('clearWave')}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button
            onClick={() => navigate('/curtain-rates/import')}
            className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
          >
            <Upload size={13} /> Update from a supplier price book
          </button>
          <button onClick={save} disabled={!dirty}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 min-h-[44px] ${
              dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            <Save size={13} /> Save
          </button>
        </div>
      </SettingsCard>
    </>
  );
}
