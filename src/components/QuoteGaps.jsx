/**
 * The holes in a measure sheet, shown on the way to a quote.
 *
 * Every row is one missing answer with the field to type it in sitting right
 * next to it, because the alternative is what used to happen: open the sheet
 * in another tab, find the line, fill it, come back, start again. Three
 * missing drops was a five-minute round trip and most people just priced the
 * $0 by hand instead.
 *
 * Dismiss is a first-class answer, not an escape hatch. A roller blind with no
 * chain colour is motorised; a bay window with no drop is being re-measured
 * next week. Saying so takes the row off the list and is remembered on the
 * line, so the next quote off this sheet does not ask again. A warning that
 * cannot be answered is a warning everybody learns to scroll past.
 *
 * Rows do not vanish as they are filled — they tick green and stay put. A list
 * that reshuffles under your thumb while you type in it is how you end up
 * typing a drop into a fabric field.
 */
import { useMemo } from 'react';
import {
  AlertOctagon, AlertTriangle, Check, X, Undo2, ExternalLink,
} from 'lucide-react';
import { makeProductSelectHandlers } from '../store/data';
import { gapId } from '../lib/sheetGaps';
import PricedItemPicker from './PricedItemPicker';
import Card from './Card';

const SEVERITY = {
  price: {
    Icon: AlertOctagon,
    icon: 'text-red-500',
    chip: 'bg-red-50 text-red-700 border-red-200',
    note: "won't be priced",
  },
  order: {
    Icon: AlertTriangle,
    icon: 'text-amber-500',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    note: "can't be ordered",
  },
};

const fieldCls =
  'w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white ' +
  'text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100';

function GapEditor({ gap, value, onChange, onCommitMeasure, productTypes, onProductPick }) {
  if (gap.editor === 'select') {
    const options = gap.options || [];
    const extra = value && !options.includes(value) ? [value] : [];
    return (
      <select
        value={value || ''}
        onChange={e => onChange(gap.field, e.target.value)}
        className={`${fieldCls} cursor-pointer`}
      >
        <option value="">Choose…</option>
        {[...options, ...extra].map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (gap.editor === 'measure') {
    return (
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value ?? ''}
          onChange={e => onChange(gap.field, e.target.value)}
          onBlur={e => onCommitMeasure(gap.field, e.target.value)}
          placeholder="0"
          className={`${fieldCls} pr-9 text-right font-semibold`}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">
          {gap.unit || 'mm'}
        </span>
      </div>
    );
  }

  if (gap.editor === 'text') {
    return (
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(gap.field, e.target.value)}
        placeholder={gap.label}
        className={fieldCls}
      />
    );
  }

  if (gap.editor === 'product') {
    return (
      <PricedItemPicker
        value={value || ''}
        productTypes={productTypes}
        typesFirst
        onSelect={onProductPick.onSelect}
        onSelectType={onProductPick.onSelectType}
        placeholder="Pick a product…"
      />
    );
  }

  return null;
}

function GapRow({
  gap, value, resolved, dismissed,
  onChange, onCommitMeasure, onDismiss, onRestore, productTypes, onProductPick,
}) {
  const sev = SEVERITY[gap.severity] || SEVERITY.order;
  const { Icon } = sev;

  if (dismissed) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50/70">
        <X size={13} className="text-slate-300 flex-shrink-0" />
        <p className="text-xs text-slate-400 line-through flex-1 min-w-0 truncate">{gap.what}</p>
        <button
          type="button"
          onClick={onRestore}
          className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800"
        >
          <Undo2 size={11} /> Undo
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        {resolved
          ? <Check size={14} className="text-emerald-500 flex-shrink-0 mt-2" />
          : <Icon size={14} className={`${sev.icon} flex-shrink-0 mt-2`} />}

        <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-x-3 gap-y-1.5 items-start">
          <div className="min-w-0">
            <p className={`text-xs font-medium ${resolved ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
              {gap.what}
            </p>
            {gap.detail && <p className="text-[11px] text-slate-500 mt-0.5">{gap.detail}</p>}
            {!resolved && gap.hint && <p className="text-[11px] text-slate-400 mt-0.5">{gap.hint}</p>}
            {!resolved && !gap.editor && !gap.href && (
              <p className="text-[11px] text-slate-400 mt-0.5">Fixed on the measure sheet</p>
            )}
          </div>

          <div className="min-w-0 space-y-1">
            {gap.editor && (
              <GapEditor
                gap={gap}
                value={value}
                onChange={onChange}
                onCommitMeasure={onCommitMeasure}
                productTypes={productTypes}
                onProductPick={onProductPick}
              />
            )}
            {gap.href && (
              <a
                href={gap.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700"
              >
                <ExternalLink size={10} /> {gap.fixLabel || 'Open the fix'}
              </a>
            )}
          </div>
        </div>

        {!resolved && (
          <button
            type="button"
            onClick={onDismiss}
            title="Not needed on this line"
            className="flex-shrink-0 text-[11px] font-medium text-slate-400 hover:text-slate-700 px-1.5 py-1 rounded hover:bg-slate-100 mt-1"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function LineBlock({
  line, resolvedIds, dismissed, getValue, onChange, onCommitMeasure,
  onDismiss, onRestore, onDismissLine, productTypes,
}) {
  const { id, index, item, gaps } = line;

  // Picking the product rewires three fields at once (library item, product
  // type, display name), so it reuses the measure sheet's own handlers rather
  // than a second copy of that logic here.
  const onProductPick = useMemo(
    () => makeProductSelectHandlers((_i, field, value) => onChange(id, field, value), 0, productTypes),
    [id, onChange, productTypes],
  );

  const live = gaps.filter(g => !dismissed.has(gapId(id, g.key)) && !resolvedIds.has(gapId(id, g.key)));

  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50/60">
        <span className="text-[11px] text-slate-400 font-mono">#{index + 1}</span>
        <p className="text-xs font-semibold text-slate-700 truncate">
          {item.location || 'No room name'}
        </p>
        {(item.productNameSnapshot || item.productType) && (
          <span className="text-[11px] text-slate-500 truncate">
            {item.productNameSnapshot || item.productType}
          </span>
        )}
        <span className="flex-1" />
        {live.length > 0 && (
          <button
            type="button"
            onClick={() => onDismissLine(id)}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-700 whitespace-nowrap"
          >
            Dismiss {live.length}
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-50">
        {gaps.map(gap => (
          <GapRow
            key={gap.key}
            gap={gap}
            value={gap.field ? getValue(id, gap.field) : ''}
            resolved={resolvedIds.has(gapId(id, gap.key))}
            dismissed={dismissed.has(gapId(id, gap.key))}
            onChange={(field, value) => onChange(id, field, value)}
            onCommitMeasure={(field, raw) => onCommitMeasure(id, field, raw)}
            onDismiss={() => onDismiss(gapId(id, gap.key))}
            onRestore={() => onRestore(gapId(id, gap.key))}
            productTypes={productTypes}
            onProductPick={onProductPick}
          />
        ))}
      </div>
    </div>
  );
}

export default function QuoteGaps({
  lines = [],
  totals = { price: 0, order: 0, total: 0, lines: 0 },
  resolvedIds = new Set(),
  dismissed = new Set(),
  getValue,
  onChange,
  onCommitMeasure,
  onDismiss,
  onRestore,
  onDismissLine,
  onDismissAll,
  productTypes = [],
}) {
  if (!lines.length) return null;

  const allAnswered = totals.total === 0;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            {allAnswered
              ? <Check size={14} className="text-emerald-500" />
              : <AlertTriangle size={14} className="text-amber-500" />}
            Missing information
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {allAnswered
              ? 'All answered. Anything you filled in is saved back to the measure sheet.'
              : <>
                  {totals.total} missing on {totals.lines} line{totals.lines !== 1 ? 's' : ''}
                  {totals.price > 0 && <> · <span className="text-red-600 font-medium">{totals.price} {SEVERITY.price.note}</span></>}
                  {totals.order > 0 && <> · <span className="text-amber-700 font-medium">{totals.order} {SEVERITY.order.note}</span></>}
                </>}
          </p>
        </div>
        {!allAnswered && (
          <button
            type="button"
            onClick={onDismissAll}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap"
          >
            Dismiss all
          </button>
        )}
      </div>

      <div>
        {lines.map(line => (
          <LineBlock
            key={line.id}
            line={line}
            resolvedIds={resolvedIds}
            dismissed={dismissed}
            getValue={getValue}
            onChange={onChange}
            onCommitMeasure={onCommitMeasure}
            onDismiss={onDismiss}
            onRestore={onRestore}
            onDismissLine={onDismissLine}
            productTypes={productTypes}
          />
        ))}
      </div>

      <p className="px-5 py-3 text-[11px] text-slate-400 border-t border-slate-100">
        Filled-in answers are written back to the measure sheet when the quote is
        created, so the sheet and the quote agree. Dismissed answers are
        remembered on the line and not asked again.
      </p>
    </Card>
  );
}
