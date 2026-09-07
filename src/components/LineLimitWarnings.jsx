/**
 * What the supplier's spec sheet says about the opening just measured.
 *
 * Sits under the width and drop fields, because that is where the number was
 * typed and where the answer is still cheap — a width that has to change is a
 * ten-second fix on site and a rejected order a week later.
 *
 * Errors and warnings look different on purpose. Red is "they will not make
 * this". Amber is "they will make it, but the customer has to be told" — the
 * fabric-join case, which is the one that turns into a complaint precisely
 * because nobody thinks to ask.
 *
 * Every line names the sheet it came from and opens it, so "says who?" is a tap
 * rather than an argument.
 */
import { AlertTriangle, AlertOctagon, FileText } from 'lucide-react';

export default function LineLimitWarnings({ results = [], onOpenDoc, compact = false }) {
  if (!results.length) return null;

  if (compact) {
    // Table view: one badge, the detail in its tooltip. The grid is already
    // dense enough without three lines of prose per row.
    const errors = results.filter(r => r.severity === 'error').length;
    const worst  = errors ? 'error' : 'warning';
    return (
      <span
        title={results.map(r => `${r.severity === 'error' ? '✕' : '!'} ${r.text}`).join('\n')}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
          worst === 'error'
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
        {worst === 'error' ? <AlertOctagon size={10} /> : <AlertTriangle size={10} />}
        {errors || results.length}
      </span>
    );
  }

  return (
    <div className="space-y-1.5 mt-2">
      {results.map((r, i) => {
        const isError = r.severity === 'error';
        return (
          <div key={i}
            className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
              isError ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
            }`}>
            {isError
              ? <AlertOctagon size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
              : <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-medium ${isError ? 'text-red-700' : 'text-amber-800'}`}>{r.text}</p>
              {r.detail && <p className="text-[11px] text-slate-500 mt-0.5">{r.detail}</p>}
              {r.source && (
                <button type="button"
                  onClick={() => onOpenDoc?.(r.source.id)}
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 underline decoration-dotted">
                  <FileText size={9} />
                  {[r.source.supplier, r.source.title].filter(Boolean).join(' · ')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
