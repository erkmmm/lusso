/**
 * CurtainCostPanel — the curtain cost calculator, inline on a quote line.
 *
 * Replaces the "calculation sheet" tabs of the old Excel workbook: it takes the
 * line's width, drop, heading and track and shows exactly where the cost comes
 * from, then writes the result into the line's Material and Labour cost so the
 * quote's existing margin model prices it.
 *
 * The four rate-driven inputs (fabric $/m and roll width, lining $/m, extras)
 * live on the line item, not in the rate card — they're per-job, the way the
 * workbook's 'Curtain Cost' sheet had a fabric price typed against each row.
 */
import { Calculator, AlertTriangle, Check } from 'lucide-react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { calcCurtain, resolveLineFabricPrice } from '../lib/curtainCalc';
import { getCurtainRates, getPricedItems, OPERATION_TYPE_OPTIONS } from '../store/data';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const m2 = (n) => `${(Number(n) || 0).toFixed(2)}m`;

function Num({ label, value, onChange, placeholder, prefix, suffix }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{prefix}</span>}
        <input
          type="number" value={value ?? ''} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={`w-full rounded-lg border border-slate-200 bg-white py-1.5 text-sm text-slate-800 outline-none focus:border-amber-400 ${prefix ? 'pl-5' : 'pl-2'} ${suffix ? 'pr-8' : 'pr-2'}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}

/** One line of the breakdown: what it is, how it got there, what it cost. */
function Row({ label, detail, amount, muted }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className={`text-xs font-medium ${muted ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
      <span className="flex-1 truncate text-[11px] text-slate-400">{detail}</span>
      <span className={`text-xs tabular-nums ${muted ? 'text-slate-400' : 'font-semibold text-slate-700'}`}>{money(amount)}</span>
    </div>
  );
}

export default function CurtainCostPanel({ item, set }) {
  // Re-read on 'lusso:data-changed' so editing the rate card in Settings (or a
  // sync landing) reprices open lines without a reload.
  useDataRefresh();
  const rates = getCurtainRates();

  // Fabric $/m: typed on the line wins, else matched from the price library by
  // the fabric's name, else the rate card default.
  const fabricPrice = resolveLineFabricPrice(item, rates, getPricedItems());

  const result = calcCurtain({
    widthMm:         item.widthMm,
    dropMm:          item.dropMm,
    heading:         item.heading,
    trackType:       item.trackType,
    fabricPricePerM: fabricPrice.pricePerM,
    fabricWidthMm:   item.curtainFabricWidthMm,
    fittingEnabled:  item.curtainFittingEnabled !== false,
    extraCost:       item.curtainExtraCost,
    lining: {
      enabled:   !!item.attachedLining,
      pricePerM: item.curtainLiningPricePerM,
    },
  }, rates);

  const { fabric, making, lining, track, fitting, materialsCost, labourCost, totalCost, warnings } = result;

  // Already applied? Compare against what's on the line so the button reads
  // "Applied" rather than inviting a pointless re-click.
  const applied =
    Math.abs((Number(item.unitCostPrice) || 0) - materialsCost) < 0.005 &&
    Math.abs((Number(item.labourCost)    || 0) - labourCost)    < 0.005 &&
    totalCost > 0;

  const apply = () => {
    set('unitCostPrice', Math.round(materialsCost * 100) / 100);
    set('labourCost',    Math.round(labourCost    * 100) / 100);
    // Snapshot so the quote records how this price was reached, even if rates
    // change later.
    set('curtainCostBreakdown', {
      calculatedAt: new Date().toISOString(),
      fabric: { mode: fabric.mode, fullness: fabric.fullness, meterage: fabric.meterage, pricePerM: fabric.pricePerM, cost: fabric.cost },
      making: { drops: making.drops, cost: making.cost },
      lining: lining.enabled ? { meterage: lining.meterage, cost: lining.cost } : null,
      track:  { type: track.type, method: track.method, cost: track.cost },
      fitting:{ cost: fitting.cost },
      extras: result.extras,
      materialsCost, labourCost, totalCost,
    });
  };

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Calculator size={14} className="text-teal-600" />
        <span className="text-xs font-semibold text-teal-800">Curtain cost calculator</span>
        {fabric.mode && (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">
            {fabric.mode === 'Continuous' ? 'Continuous (railroaded)' : 'Regular (cut drops)'}
          </span>
        )}
      </div>

      {/* Inputs the rate card can't know: this job's fabric and any extras. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Num label="Fabric $/m" prefix="$" value={item.curtainFabricPricePerM}
             placeholder={String(fabricPrice.pricePerM)}
             onChange={v => set('curtainFabricPricePerM', v)} />
        <Num label="Fabric width" suffix="mm" value={item.curtainFabricWidthMm}
             placeholder={String(rates.fabricWidthMm)}
             onChange={v => set('curtainFabricWidthMm', v)} />
        {item.attachedLining && (
          <Num label="Lining $/m" prefix="$" value={item.curtainLiningPricePerM}
               placeholder={String(rates.lining.pricePerM)}
               onChange={v => set('curtainLiningPricePerM', v)} />
        )}
        <Num label="Extras (bending…)" prefix="$" value={item.curtainExtraCost}
             placeholder="0.00" onChange={v => set('curtainExtraCost', v)} />
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Track / operation</label>
          <select
            value={item.trackType || ''} onChange={e => set('trackType', e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-amber-400"
          >
            <option value=""></option>
            {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={!!item.attachedLining}
                 onChange={e => set('attachedLining', e.target.checked)}
                 className="accent-teal-600" />
          Attached lining
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={item.curtainFittingEnabled !== false}
                 onChange={e => set('curtainFittingEnabled', e.target.checked)}
                 className="accent-teal-600" />
          Include fitting
        </label>
      </div>

      {/* Breakdown — the old calculation sheet, one line per cost. */}
      <div className="rounded-lg bg-white/70 px-3 py-2">
        <Row label="Fabric"
             detail={fabric.mode
               ? `${m2(fabric.meterage)} @ ${money(fabric.pricePerM)}/m · ×${fabric.fullness} fullness${fabric.dropsRequired ? ` · ${fabric.dropsRequired} drops` : ''}`
               : 'not priced'}
             amount={fabric.cost} muted={!fabric.mode} />
        <p className="-mt-0.5 mb-1 pl-1 text-[10px] text-slate-400">
          {fabricPrice.source === 'manual'
            ? 'Fabric price set on this line'
            : fabricPrice.source === 'library'
              ? `Fabric price from price library — ${fabricPrice.item?.itemName}`
              : `Fabric price is the rate-card default — ${item.fabricColour ? `no per-metre "${item.fabricColour}" in the price library` : 'no fabric named on this line'}`}
        </p>
        <Row label="Making"
             detail={`${making.drops.toFixed(2)} drops @ ${money(making.ratePerDrop)}`}
             amount={making.cost} />
        {lining.enabled && (
          <Row label="Lining"
               detail={lining.meterage
                 ? `${m2(lining.meterage)} @ ${money(lining.pricePerM)}/m + making`
                 : 'not priced'}
               amount={lining.cost} muted={!lining.meterage} />
        )}
        <Row label="Track"
             detail={track.method === 'perMetre' ? `${track.type} · ${m2(track.widthM)} @ ${money(track.ratePerM)}/m`
                   : track.method === 'table'    ? `${track.type} · ${track.band}mm band · ${track.column === 'clearWave' ? 'Clear Wave' : 'Standard'}`
                   : 'not priced'}
             amount={track.cost} muted={track.method === 'none'} />
        <Row label="Fitting"
             detail={!fitting.enabled ? 'excluded'
                   : `${money(fitting.base)} base${fitting.dropSurcharge ? ` + ${money(fitting.dropSurcharge)} tall drop` : ''}${fitting.doubled ? ' · ×2 dual track' : ''}`}
             amount={fitting.cost} muted={!fitting.enabled} />
        {result.extras > 0 && <Row label="Extras" detail="bending, freight, etc." amount={result.extras} />}

        <div className="mt-1.5 flex items-baseline gap-3 border-t border-slate-200 pt-1.5">
          <span className="text-[11px] text-slate-500">Materials {money(materialsCost)}</span>
          <span className="text-[11px] text-slate-500">Labour {money(labourCost)}</span>
          <span className="ml-auto text-sm font-bold text-teal-800">{money(totalCost)} cost</span>
        </div>
      </div>

      {!result.priced && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
          {(() => {
            const missing = [!item.widthMm && 'width', !item.dropMm && 'drop'].filter(Boolean);
            const have = ['heading', 'track', 'fabric'].filter(k => k === 'heading' ? item.heading : k === 'track' ? item.trackType : item.fabricColour);
            return (
              <p className="text-xs text-amber-900">
                <span className="font-semibold">
                  Add the {missing.join(' and ')} to price this curtain.
                </span>{' '}
                {missing.length === 1
                  ? `It's the ${missing[0]} box at the top of this line.`
                  : "They're the two boxes at the top of this line."}
                {have.length > 0 && ` Everything else — ${have.join(', ')} — is already set.`}
              </p>
            );
          })()}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          <ul className="space-y-0.5 text-[11px] text-amber-800">
            {warnings.map((w, i) => <li key={i}>{typeof w === 'string' ? w : w.message}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button" onClick={apply} disabled={totalCost <= 0}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            totalCost <= 0 ? 'cursor-not-allowed bg-slate-100 text-slate-400'
            : applied      ? 'bg-teal-100 text-teal-700'
                           : 'bg-teal-600 text-white hover:bg-teal-700'
          }`}
        >
          {applied ? <span className="flex items-center gap-1"><Check size={12} /> Applied to line</span>
                   : 'Apply to Material + Labour cost'}
        </button>
        <span className="text-[11px] text-slate-400">
          Sell price still comes from the line's margin.
        </span>
      </div>
    </div>
  );
}
