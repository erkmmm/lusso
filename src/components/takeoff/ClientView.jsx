import { CheckCircle2, Ruler, Camera, FileDown, Loader2, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { colourFor, summarise, measuredProgress } from '../../lib/clientSchedule';
import { arcPathD } from '../../lib/takeoffGeometry';

const fmtMm = (mm) => (mm == null || mm === '' ? '—' : `${Math.round(mm)}`);

/**
 * The coverings drawn onto the plan, in their product colour.
 *
 * Not a dot near the window — the actual RUN, from where the covering starts to
 * where it stops, with a stop tick at each end. Extent is the thing a customer
 * can check against their own house ("that one should reach the corner"), and
 * it's what catches a window measured half-width before anything is made.
 *
 * Still one run per opening, not per blind: a three-part bay draws as its one
 * continuous run, because the client is checking coverage, not the order split.
 */
export function ClientPins({ entries, palette, baseToScreen, viewScale = 1, selectedKey, onSelect }) {
  const drawable = entries.filter(e => e.anchor);
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none">
      {drawable.map(e => {
        const colour = colourFor(palette, e.product);
        const sel = selectedKey === e.key;
        const pts = e.points && e.points.length > 1 ? e.points : null;
        if (!pts) return null;
        const screen = pts.map(baseToScreen);
        const isArc = e.kind === 'arc' && pts.length === 3;
        const d = isArc
          ? arcPathD(pts[0], pts[1], pts[2], baseToScreen, viewScale)
          : `M ${screen.map(p => `${p.x} ${p.y}`).join(' L ')}`;
        const a = screen[0], b = screen[screen.length - 1];

        return (
          <g
            key={e.key}
            className="pointer-events-auto cursor-pointer"
            onPointerDown={() => onSelect?.(sel ? null : e.key)}
          >
            <path d={d} fill="none" stroke="transparent" strokeWidth={22} />
            {/* White casing so the colour reads over the drawing's own linework */}
            <path d={d} fill="none" stroke="#fff" strokeWidth={sel ? 11 : 9}
                  opacity={0.92} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke={colour} strokeWidth={sel ? 6 : 4.5}
                  strokeLinecap="round" strokeLinejoin="round" opacity={sel ? 1 : 0.9} />
            <EndStop p={a} towards={screen[1]} colour={colour} bold={sel} />
            <EndStop p={b} towards={screen[screen.length - 2]} colour={colour} bold={sel} />
          </g>
        );
      })}

      {/* Numbers ride above every run, so the plan and the list read together. */}
      {drawable.map(e => {
        const p = baseToScreen(e.anchor);
        const colour = colourFor(palette, e.product);
        const sel = selectedKey === e.key;
        const r = sel ? 15 : 12;
        return (
          <g
            key={`n-${e.key}`}
            className="pointer-events-auto cursor-pointer"
            onPointerDown={() => onSelect?.(sel ? null : e.key)}
          >
            <circle cx={p.x} cy={p.y} r={r} fill={colour} stroke="#fff" strokeWidth={2.5} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                  fontSize={sel ? 13 : 11} fill="#fff" fontWeight="700">
              {e.number}
            </text>
            {sel && (() => {
              const text = [e.label, e.product].filter(Boolean).join(' · ');
              const w = Math.max(90, text.length * 6.6 + 16);
              return (
                <g transform={`translate(${p.x}, ${p.y - r - 8})`}>
                  <rect x={-w / 2} y={-22} width={w} height={20} rx={4} fill="#0f172a" />
                  <text x={0} y={-12} textAnchor="middle" dominantBaseline="central"
                        fontSize={12} fill="#fff" fontWeight="600">{text}</text>
                </g>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A tick square across the end of a run.
 *
 * Without one, a thick rounded line just fades out and "where does it stop?"
 * is exactly the question this view exists to answer.
 */
function EndStop({ p, towards, colour, bold }) {
  if (!p || !towards) return null;
  const dx = towards.x - p.x, dy = towards.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;          // perpendicular to the run
  const h = bold ? 9 : 7.5;
  return (
    <>
      <line x1={p.x - nx * h} y1={p.y - ny * h} x2={p.x + nx * h} y2={p.y + ny * h}
            stroke="#fff" strokeWidth={bold ? 6 : 5} strokeLinecap="round" opacity={0.92} />
      <line x1={p.x - nx * h} y1={p.y - ny * h} x2={p.x + nx * h} y2={p.y + ny * h}
            stroke={colour} strokeWidth={bold ? 3.5 : 3} strokeLinecap="round" />
    </>
  );
}

/**
 * The schedule panel.
 *
 * Reads as a checklist of the customer's own house, room by room, so the thing
 * they're being asked to confirm is obvious. Sizes can be hidden — some jobs
 * are quoted before a check measure and showing provisional millimetres to a
 * client just creates an argument later.
 */
export default function ClientSchedule({
  entries, palette, pageNumber, pageCount, showSizes, onToggleSizes,
  selectedKey, onSelect, onExport, exporting, customerName, jobNumber,
  collapsed = false, onToggleCollapsed,
}) {
  const onPage = entries.filter(e => e.pageNumber === pageNumber);
  const totals = summarise(entries);
  const progress = measuredProgress(entries);

  // Collapsed to the same 64px rail as the working panel and the two rails on
  // the left — a client is often shown this on a laptop, where the plan wants
  // every pixel it can get.
  if (collapsed) {
    return (
      <div className="w-16 border-l border-slate-200 bg-white hidden lg:flex flex-col items-center py-2 gap-3 flex-shrink-0">
        <button
          onClick={onToggleCollapsed}
          title="Show the window schedule"
          aria-label="Show the window schedule"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <PanelRightOpen size={17} />
        </button>
        <div className="text-center leading-tight">
          <div className="text-sm font-semibold text-slate-800 tabular-nums">{onPage.length}</div>
          <div className="text-[9px] text-slate-400">page</div>
        </div>
        <div className="text-center leading-tight">
          <div className="text-sm font-semibold text-slate-500 tabular-nums">{entries.length}</div>
          <div className="text-[9px] text-slate-400">total</div>
        </div>
        <div title={progress.allMeasured ? 'All sizes confirmed on site' : `${progress.measured} of ${progress.total} measured on site`}>
          {progress.allMeasured
            ? <CheckCircle2 size={17} className="text-green-600" />
            : <Ruler size={17} className="text-amber-500" />}
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-slate-200 bg-white flex flex-col min-h-0 hidden lg:flex">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600">Window schedule</p>
          <h2 className="font-semibold text-slate-900 text-sm mt-0.5 truncate">{customerName || 'This job'}</h2>
          <p className="text-xs text-slate-400">
            {jobNumber ? `${jobNumber} · ` : ''}{entries.length} opening{entries.length === 1 ? '' : 's'}
            {pageCount > 1 && ` · ${onPage.length} on this page`}
          </p>
        </div>
        <button
          onClick={onToggleCollapsed}
          title="Collapse the panel"
          aria-label="Collapse the panel"
          className="text-slate-400 hover:text-slate-700 p-1 -mr-1 rounded transition-colors flex-shrink-0"
        >
          <PanelRightClose size={17} />
        </button>
      </div>

      {/* What's confirmed vs still scaled off the drawing. Saying this plainly
          up front is what stops "but you told me 1800" six weeks later. */}
      {entries.length > 0 && (
        <div className={`mx-3 mt-3 rounded-lg px-3 py-2 text-xs border ${
          progress.allMeasured
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          {progress.allMeasured ? (
            <span className="flex items-center gap-1.5"><CheckCircle2 size={13} /> All sizes confirmed on site</span>
          ) : (
            <>
              <span className="flex items-center gap-1.5 font-medium"><Ruler size={13} /> {progress.measured} of {progress.total} measured on site</span>
              <p className="mt-0.5 text-amber-700">
                The rest are taken off the plan and will be confirmed before anything is ordered.
              </p>
            </>
          )}
        </div>
      )}

      {totals.length > 0 && (
        <div className="px-3 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">What&rsquo;s going in</p>
          <div className="space-y-1">
            {totals.map(t => (
              <div key={t.product} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: colourFor(palette, t.product === 'Not yet specified' ? '' : t.product) }} />
                <span className="text-slate-700 truncate">{t.product}</span>
                <span className="ml-auto tabular-nums text-slate-500">×{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {pageCount > 1 ? `Page ${pageNumber}` : 'Openings'}
        </p>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
          <input type="checkbox" checked={showSizes} onChange={e => onToggleSizes(e.target.checked)} className="accent-amber-500" />
          Show sizes
        </label>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {onPage.length === 0 && (
          <p className="px-4 py-6 text-xs text-slate-400 text-center">
            Nothing marked up on page {pageNumber}.
          </p>
        )}
        {onPage.map(e => (
          <button
            key={e.key}
            onClick={() => onSelect(selectedKey === e.key ? null : e.key)}
            className={`w-full text-left px-3 py-2.5 flex gap-2.5 items-start transition-colors ${
              selectedKey === e.key ? 'bg-amber-50/70' : 'hover:bg-slate-50'
            }`}
          >
            <span
              className="w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: colourFor(palette, e.product) }}
            >
              {e.number}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-800 truncate">{e.label}</span>
              <span className="block text-xs text-slate-500 truncate">
                {e.product || <em className="text-slate-400">Product to be confirmed</em>}
                {e.quantity > 1 && ` · ×${e.quantity}`}
                {e.shape && ` · ${e.shape}`}
              </span>
              {showSizes && (
                <span className="block text-xs text-slate-400 tabular-nums mt-0.5">
                  {fmtMm(e.totalWidthMm)} × {fmtMm(e.dropMm)} mm
                  {e.parts > 1 && ` (${e.parts} parts)`}
                </span>
              )}
            </span>
            <span className="flex flex-col items-end gap-1 flex-shrink-0">
              {e.measured
                ? <CheckCircle2 size={13} className="text-green-600" title="Measured on site" />
                : <Ruler size={13} className="text-amber-500" title="From the plan — to be confirmed on site" />}
              {e.photoCount > 0 && (
                <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Camera size={10} />{e.photoCount}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-slate-100">
        <button
          onClick={onExport}
          disabled={exporting || !entries.length}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          Client PDF
        </button>
        <p className="text-[11px] text-slate-400 mt-1.5 text-center">
          The same plan and schedule, ready to email.
        </p>
      </div>
    </div>
  );
}

/** The narrow-screen twin — a tray under the plan, same content. */
export function ClientScheduleTray({ entries, palette, pageNumber, selectedKey, onSelect, showSizes }) {
  const onPage = entries.filter(e => e.pageNumber === pageNumber);
  if (!onPage.length) return null;
  return (
    <div className="lg:hidden border-t border-slate-200 bg-white flex-shrink-0 max-h-[38vh] overflow-y-auto divide-y divide-slate-50">
      {onPage.map(e => (
        <button
          key={e.key}
          onClick={() => onSelect(selectedKey === e.key ? null : e.key)}
          className={`w-full text-left px-3 py-2.5 flex gap-2.5 items-center ${selectedKey === e.key ? 'bg-amber-50/70' : ''}`}
        >
          <span
            className="w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0"
            style={{ background: colourFor(palette, e.product) }}
          >
            {e.number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-800 truncate">{e.label}</span>
            <span className="block text-xs text-slate-500 truncate">
              {e.product || 'Product to be confirmed'}
              {showSizes && e.totalWidthMm ? ` · ${fmtMm(e.totalWidthMm)} × ${fmtMm(e.dropMm)}` : ''}
            </span>
          </span>
          {e.measured
            ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
            : <Ruler size={14} className="text-amber-500 flex-shrink-0" />}
        </button>
      ))}
    </div>
  );
}
