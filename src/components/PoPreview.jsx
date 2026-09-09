/**
 * The PO exactly as it prints — driven entirely by a snapshot, so the builder
 * and the history viewer render the same document from the same data.
 */
import { PO_FOOTER, wandLabel, remoteLabel, snapshotHasAccessories } from '../lib/poDocument';

export default function PoPreview({ snapshot, id = 'po-print', highlightRows }) {
  if (!snapshot) return null;
  const { headers = [], rows = [], jobNumber, customerName, dateOrdered, dateRequiredDisplay, extraNotes } = snapshot;
  const hasAccessories = snapshotHasAccessories(snapshot);
  const flagged = highlightRows || new Set();

  return (
    <div id={id} className="p-5">
      {/* Header block */}
      <div className="flex items-start justify-between border-b-2 border-amber-500 pb-3 mb-4">
        <div>
          <div className="text-lg font-bold text-amber-700">LUSSO</div>
          <div className="text-xs text-slate-500">Curtain Purchase Order</div>
        </div>
        <div className="text-right text-xs text-slate-600 space-y-0.5">
          {(jobNumber || customerName) && (
            <div>
              {jobNumber && <><span className="text-slate-400">Job #:</span> {jobNumber}</>}
              {jobNumber && customerName && ' · '}
              {customerName && <><span className="text-slate-400">Customer:</span> {customerName}</>}
            </div>
          )}
          <div>
            <span className="text-slate-400">Date ordered:</span> {dateOrdered}
            {dateRequiredDisplay && <> · <span className="text-slate-400">Required:</span> {dateRequiredDisplay}</>}
          </div>
        </div>
      </div>

      {/* Line items table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50">
              {headers.map(h => (
                <th key={h} className="border border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={flagged.has(ri) ? 'bg-orange-50' : ''}>
                {r.map((cell, ci) => (
                  <td key={ci} className="border border-slate-200 px-2 py-1.5 text-slate-700 whitespace-nowrap">{cell === '' || cell == null ? '' : cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-order accessories + notes — populated entries only */}
      {(hasAccessories || (extraNotes || '').trim()) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 text-xs">
          {hasAccessories && (
            <div>
              <div className="font-semibold text-slate-700 mb-1">Order accessories</div>
              {snapshot.wands.map((w, i) => <div key={w.id || `w${i}`} className="text-slate-600">Wand: {wandLabel(w)}</div>)}
              {snapshot.remotes.map((r, i) => <div key={r.id || `r${i}`} className="text-slate-600">Remote: {remoteLabel(r)}</div>)}
            </div>
          )}
          {(extraNotes || '').trim() && (
            <div>
              <div className="font-semibold text-slate-700 mb-1">Extra notes</div>
              <div className="text-slate-600 whitespace-pre-wrap">{extraNotes}</div>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">{PO_FOOTER}</p>
    </div>
  );
}
