import { CheckCircle2, Ruler, AlertTriangle, RotateCcw } from 'lucide-react';
import { isPlanEstimate, lineVariance } from '../store/data';

/**
 * The plan-estimate → check-measured control.
 *
 * A dimension scaled off a drawing is an estimate. Custom-made blinds cut to an
 * estimate are scrap, so every takeoff-derived line carries this state until
 * someone has stood in the room with a tape. The badge is the visible half of
 * that; `orderGate` in the store is the half that actually blocks an order.
 */
export default function CheckMeasureControl({ item, onConfirm, onRevert, compact = false }) {
  if (item?.source !== 'takeoff') return null;
  const pending = isPlanEstimate(item);
  const variance = lineVariance(item);

  if (pending) {
    return (
      <button
        type="button"
        onClick={onConfirm}
        title="Confirm these dimensions were measured on site"
        className={`inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 text-amber-700 font-medium hover:bg-amber-100 transition-colors ${
          compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
        }`}
      >
        <Ruler size={compact ? 10 : 12} />
        {compact ? 'Plan' : 'Plan estimate — confirm'}
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${compact ? 'text-[10px]' : 'text-xs'}`}>
      <span className={`inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 text-green-700 font-medium ${
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1'
      }`}>
        <CheckCircle2 size={compact ? 10 : 12} /> {compact ? 'Measured' : 'Check measured'}
      </span>
      {variance?.significant && (
        <span
          className="inline-flex items-center gap-1 text-amber-600"
          title={`Plan said ${item.planWidthMm || '—'} × ${item.planDropMm || '—'} mm`}
        >
          <AlertTriangle size={compact ? 10 : 12} />
          {variance.percent.toFixed(0)}% off plan
        </span>
      )}
      {onRevert && (
        <button
          type="button"
          onClick={onRevert}
          title="Undo — back to the plan estimate"
          className="text-slate-300 hover:text-slate-500"
        >
          <RotateCcw size={compact ? 10 : 12} />
        </button>
      )}
    </span>
  );
}

/**
 * Sheet-level banner. Ordering is where a plan estimate becomes expensive, so
 * the count is stated up front rather than left to be discovered per row.
 */
export function CheckMeasureBanner({ lineItems = [], onConfirmAll }) {
  const pending = lineItems.filter(isPlanEstimate);
  if (!pending.length) return null;
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 mb-4">
      <Ruler size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-amber-800">
          {pending.length} line{pending.length === 1 ? '' : 's'} still scaled off the plan
        </p>
        <p className="text-xs text-amber-700 mt-0.5">
          {pending.slice(0, 4).map(li => li.location || 'Unnamed').join(', ')}
          {pending.length > 4 && ` and ${pending.length - 4} more`}
          {' '}— check-measure on site before ordering. Purchase orders are blocked until then.
        </p>
      </div>
      {onConfirmAll && (
        <button
          type="button"
          onClick={onConfirmAll}
          className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600"
        >
          All measured
        </button>
      )}
    </div>
  );
}
