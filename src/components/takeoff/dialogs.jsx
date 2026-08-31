import { useEffect, useMemo, useState } from 'react';
import {
  Crosshair, X, Trash2, AlertTriangle, Copy, FileUp, CheckCircle2, DoorOpen, Ruler,
} from 'lucide-react';
import {
  PAPER_SIZES, SCALE_RATIOS, detectPaperSize, scaleFromPreset, nearestRatio,
  checkAgainstDoor, DOOR_WIDTHS,
} from '../../lib/planScale';

const fmtM = (mm) => (mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm)} mm`);

function Shell({ title, icon: Icon, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-lg' : 'max-w-sm'} max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            {Icon && <Icon size={16} className="text-amber-500" />} {title}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-5 pb-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex gap-2 p-5 pt-4">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Set the page scale.
 *
 * Two routes, and the preset one is the default because it's exact: a PDF page
 * is measured in points, so a drawing plotted at a stated ratio has a knowable
 * px-per-mm with nothing to click. The catch it handles — and the reason the
 * "drawn at" selector exists — is that architects issue A1 drawings as A3 PDFs
 * all day long, which silently doubles the ratio in the title block.
 */
export function ScaleDialog({
  baseSize, pageNumber, pageCount, existing, pendingLine, onCancel, onSave, onNeedLine,
}) {
  const detected = useMemo(() => detectPaperSize(baseSize), [baseSize]);
  const [tab, setTab] = useState(pendingLine ? 'line' : 'preset');
  const [ratio, setRatio] = useState(() => existing?.ratio || 100);
  const [customRatio, setCustomRatio] = useState('');
  const [drawnSheet, setDrawnSheet] = useState(() => existing?.drawnSheet || detected?.name || 'A1');
  const [knownMm, setKnownMm] = useState('');
  const [applyAll, setApplyAll] = useState(false);

  const activeRatio = customRatio ? Number(customRatio) : ratio;
  const preset = useMemo(
    () => scaleFromPreset({ baseSize, ratio: activeRatio, drawnSheetName: drawnSheet }),
    [baseSize, activeRatio, drawnSheet]
  );

  const linePxPerMm = pendingLine && Number(knownMm) > 0 ? pendingLine.px / Number(knownMm) : 0;
  const lineHint = linePxPerMm > 0 ? nearestRatio(linePxPerMm) : null;

  const chosen = tab === 'preset'
    ? { pxPerMm: preset.pxPerMm, ratio: preset.effectiveRatio, method: 'preset',
        scaleLabel: `1:${Math.round(preset.effectiveRatio)}`, drawnSheet, knownLengthMm: null }
    : { pxPerMm: linePxPerMm, ratio: linePxPerMm > 0 ? 72 / (25.4 * linePxPerMm) : 0, method: 'line',
        scaleLabel: lineHint ? `1:${lineHint}` : 'measured', drawnSheet: null,
        knownLengthMm: Number(knownMm) || null };

  const valid = chosen.pxPerMm > 0 && Number.isFinite(chosen.pxPerMm);

  return (
    <Shell title="Set scale" icon={Crosshair} onClose={onCancel} wide footer={
      <>
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button
          disabled={!valid}
          onClick={() => onSave({ ...chosen, applyAll })}
          className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
        >
          Set scale
        </button>
      </>
    }>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-4">
        {[['preset', 'From the sheet'], ['line', 'From a known length']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setTab(k); if (k === 'line' && !pendingLine) onNeedLine?.(); }}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === k ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'preset' ? (
        <div className="space-y-4">
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-3">
            This PDF page measures{' '}
            <strong className="text-slate-700">
              {Math.round(detected?.widthMm || 0)} × {Math.round(detected?.heightMm || 0)} mm
            </strong>
            {detected && (
              <> — {detected.exact ? 'exactly' : 'closest to'} <strong className="text-slate-700">{detected.name}</strong>.</>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Drawing scale (from the title block)</label>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5">
              {SCALE_RATIOS.map(r => (
                <button
                  key={r}
                  onClick={() => { setRatio(r); setCustomRatio(''); }}
                  className={`py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    !customRatio && ratio === r
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  1:{r}
                </button>
              ))}
            </div>
            <input
              type="number" inputMode="numeric" value={customRatio}
              onChange={e => setCustomRatio(e.target.value)}
              placeholder="or type another ratio, e.g. 150"
              className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Originally drawn at</label>
            <p className="text-[11px] text-slate-400 mb-1.5">
              An A1 drawing issued as an A3 PDF is still labelled 1:100 but is plotted at half size. Set this and the maths corrects itself.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PAPER_SIZES.slice(0, 5).map(p => (
                <button
                  key={p.name}
                  onClick={() => setDrawnSheet(p.name)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    drawnSheet === p.name
                      ? 'bg-slate-800 border-slate-800 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className={`rounded-lg p-3 text-xs border ${
            preset.sheetCoversMm > 0 && preset.sheetCoversMm < 500_000
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {preset.resized && (
              <p className="mb-1">
                Re-plotted {preset.drawnSheet?.name} → {preset.actualSheet?.name}, so the true scale is{' '}
                <strong>1:{Math.round(preset.effectiveRatio)}</strong>.
              </p>
            )}
            <p>
              At this scale the sheet covers <strong>{fmtM(preset.sheetCoversMm)}</strong> across.
              {' '}If that isn&rsquo;t roughly the width of the site, the scale is wrong.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!pendingLine ? (
            <div className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-4 text-center">
              Draw a line across something you know the length of — a door, a grid spacing, the scale bar — then come back here.
              <button onClick={onNeedLine} className="block mx-auto mt-2 text-amber-600 font-medium underline">Draw the line</button>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                The line you drew is {pendingLine.px.toFixed(1)} px on the page. What is it in real life?
              </p>
              <label className="text-xs font-medium text-slate-600">Known length (mm)</label>
              <input
                autoFocus type="number" inputMode="decimal" value={knownMm}
                onChange={e => setKnownMm(e.target.value)}
                placeholder="e.g. 1000"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
              <div className="flex flex-wrap gap-1.5">
                {DOOR_WIDTHS.map(w => (
                  <button key={w} onClick={() => setKnownMm(String(w))}
                    className="px-2.5 py-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                    {w} door
                  </button>
                ))}
                <button onClick={() => setKnownMm('1000')}
                  className="px-2.5 py-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                  1 m
                </button>
              </div>
              {linePxPerMm > 0 && (
                <p className="text-xs text-slate-500">
                  Resulting scale: 1&nbsp;mm = {linePxPerMm.toFixed(3)} px
                  {lineHint && <> — that&rsquo;s almost exactly <strong className="text-slate-700">1:{lineHint}</strong>.</>}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {pageCount > 1 && (
        <label className="flex items-start gap-2 mt-4 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} className="mt-0.5 accent-amber-500" />
          <span>
            Apply to all {pageCount} pages
            <span className="block text-slate-400">
              Plan sets are plotted at one scale — this saves calibrating each sheet. Detail sheets at a different scale can be re-set individually.
            </span>
          </span>
        </label>
      )}
      <div className="h-1" />
      <p className="text-[11px] text-slate-400">
        Page {pageNumber}{existing ? ` · currently 1 mm = ${existing.pxPerMm.toFixed(3)} px` : ' · no scale set'}
      </p>
    </Shell>
  );
}

/**
 * Verify a page's scale against a door leaf.
 *
 * Every dimension on a page shares one multiplier, so a wrong scale is invisible
 * — nothing looks off, the numbers are just all wrong together. Measuring
 * something whose real size is standard is the cheapest way to catch it, and
 * doors are on every plan.
 */
export function DoorCheckDialog({ measuredMm, onCancel, onAccept, onFix, onSetScale }) {
  const result = checkAgainstDoor(measuredMm);
  if (!result) return null;
  const good = result.ok;
  return (
    <Shell title="Scale check" icon={DoorOpen} onClose={onCancel} footer={
      <>
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Close</button>
        {!good && result.correctable && (
          <button
            onClick={() => onFix(result.correction)}
            className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
          >
            Correct the scale
          </button>
        )}
        {!good && !result.correctable && (
          <button onClick={onSetScale} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600">
            Set the scale again
          </button>
        )}
        {good && (
          <button onClick={onAccept} className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
            Looks right
          </button>
        )}
      </>
    }>
      <div className={`rounded-xl p-4 ${good ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className="flex items-center gap-2">
          {good
            ? <CheckCircle2 size={18} className="text-green-600" />
            : <AlertTriangle size={18} className="text-red-500" />}
          <p className={`text-sm font-semibold ${good ? 'text-green-800' : 'text-red-700'}`}>
            {good ? 'Scale looks correct' : 'Scale looks wrong'}
          </p>
        </div>
        <p className="text-sm text-slate-600 mt-2">
          You measured <strong>{Math.round(measuredMm)} mm</strong>. The closest standard door leaf is{' '}
          <strong>{result.standard} mm</strong> — {result.errorPercent.toFixed(1)}% out.
        </p>
        {!good && result.correctable && (
          <p className="text-xs text-slate-500 mt-2">
            Correcting will rescale this page by ×{result.correction.toFixed(3)} and update every measurement on it.
          </p>
        )}
        {!good && !result.correctable && (
          <p className="text-xs text-slate-500 mt-2">
            That&rsquo;s too far out to nudge — the door leaves are only ~6% apart, so guessing which one you measured
            would leave the page a few percent wrong instead of obviously wrong. Set the scale again from the title
            block or a known dimension.
          </p>
        )}
      </div>
    </Shell>
  );
}

/** Copy a page's takeoff onto another page — repeat unit types, mirrored plans. */
export function DuplicatePageDialog({ fromPage, pageCount, itemCount, onCancel, onConfirm }) {
  const [toPage, setToPage] = useState(() => Math.min(fromPage + 1, pageCount));
  const [prefix, setPrefix] = useState('');
  const [copyScale, setCopyScale] = useState(true);
  const valid = toPage >= 1 && toPage <= pageCount && toPage !== fromPage;

  return (
    <Shell title="Copy this page's takeoff" icon={Copy} onClose={onCancel} footer={
      <>
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button
          disabled={!valid}
          onClick={() => onConfirm({ toPage, prefix: prefix.trim(), copyScale })}
          className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
        >
          Copy {itemCount} item{itemCount === 1 ? '' : 's'}
        </button>
      </>
    }>
      <p className="text-xs text-slate-500 mb-4">
        Repeat unit types are drawn identically on each sheet. Copying the takeoff puts the same windows on another page in one tap — the points land in the same place, so you only need to nudge what actually differs.
      </p>
      <label className="text-xs font-medium text-slate-600">Copy to page</label>
      <input
        type="number" min={1} max={pageCount} value={toPage}
        onChange={e => setToPage(Number(e.target.value))}
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
      />
      <label className="text-xs font-medium text-slate-600 block mt-3">Label prefix (optional)</label>
      <input
        value={prefix} onChange={e => setPrefix(e.target.value)}
        placeholder="e.g. Unit 2 — "
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
      />
      <p className="text-[11px] text-slate-400 mt-1">
        Without a prefix the copies share their labels, and same-named windows merge into one measure-sheet row.
      </p>
      <label className="flex items-center gap-2 mt-3 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" checked={copyScale} onChange={e => setCopyScale(e.target.checked)} className="accent-amber-500" />
        Copy the page scale too
      </label>
    </Shell>
  );
}

/**
 * Replace the plan.
 *
 * Rev B lands mid-quote constantly. Wiping the takeoff every time is what made
 * people avoid uploading the new drawing at all — so carrying the markup across
 * is the default whenever the new PDF has the same page geometry, and the old
 * revision is kept rather than overwritten.
 */
export function ReplacePlanDialog({ fileName, compatible, measurementCount, onCancel, onConfirm }) {
  const [carry, setCarry] = useState(compatible);
  const [note, setNote] = useState('');
  return (
    <Shell title="New plan revision" icon={FileUp} onClose={onCancel} wide footer={
      <>
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => onConfirm({ carry, note: note.trim() })}
          className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
        >
          Upload revision
        </button>
      </>
    }>
      <p className="text-sm text-slate-600 mb-3">
        <strong className="text-slate-800">{fileName}</strong> will become the current plan. The revision it replaces is kept, not deleted.
      </p>

      <div className={`rounded-lg p-3 text-xs border mb-3 ${
        compatible ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}>
        {compatible
          ? 'The new PDF has the same page size and count, so the existing scale and measurements will land in the same place.'
          : 'The new PDF has a different page size or count. Measurements would land in the wrong spot, so they can’t be carried across automatically.'}
      </div>

      <label className={`flex items-start gap-2 text-xs cursor-pointer ${compatible ? 'text-slate-600' : 'text-slate-400'}`}>
        <input
          type="checkbox" checked={carry && compatible} disabled={!compatible}
          onChange={e => setCarry(e.target.checked)} className="mt-0.5 accent-amber-500"
        />
        <span>
          Carry across the scale and all {measurementCount} measurement{measurementCount === 1 ? '' : 's'}
          <span className="block text-slate-400">Check each one against the new drawing afterwards — that&rsquo;s what changed in the revision.</span>
        </span>
      </label>

      <label className="text-xs font-medium text-slate-600 block mt-3">What changed? (optional)</label>
      <input
        value={note} onChange={e => setNote(e.target.value)}
        placeholder="e.g. Rev C — bed 3 window widened"
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
      />
    </Shell>
  );
}

/** Revision history — what was superseded, when, and by whom. */
export function RevisionsDialog({ takeoff, onCancel, onRestore }) {
  const revisions = [...(takeoff.revisions || [])].reverse();
  return (
    <Shell title="Plan revisions" icon={FileUp} onClose={onCancel} wide footer={
      <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Close</button>
    }>
      <div className="divide-y divide-slate-100">
        <div className="py-3 flex items-start gap-3">
          <span className="px-2 py-0.5 rounded-md bg-green-100 text-green-700 text-[11px] font-semibold flex-shrink-0">Current</span>
          <div className="min-w-0">
            <p className="text-sm text-slate-800 truncate">{takeoff.fileName}</p>
            <p className="text-xs text-slate-400">
              {takeoff.pageCount} page{takeoff.pageCount === 1 ? '' : 's'}
              {takeoff.revisionUploadedAt && ` · ${new Date(takeoff.revisionUploadedAt).toLocaleString('en-AU')}`}
            </p>
          </div>
        </div>
        {revisions.map(r => (
          <div key={r.id} className="py-3 flex items-start gap-3">
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-semibold flex-shrink-0">
              r{r.revision}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-700 truncate">{r.fileName}</p>
              <p className="text-xs text-slate-400">
                {new Date(r.supersededAt || r.uploadedAt).toLocaleString('en-AU')}
                {r.uploadedBy && ` · ${r.uploadedBy}`}
              </p>
              {r.note && <p className="text-xs text-slate-500 mt-0.5 italic">{r.note}</p>}
            </div>
            <button
              onClick={() => onRestore(r)}
              className="text-xs text-amber-600 hover:underline flex-shrink-0"
            >
              Make current
            </button>
          </div>
        ))}
        {!revisions.length && (
          <p className="py-4 text-xs text-slate-400 text-center">No earlier revisions — this is the original plan.</p>
        )}
      </div>
    </Shell>
  );
}

export function ConfirmDeleteDialog({ measurements, pages, onCancel, onConfirm }) {
  const bits = [
    measurements ? `${measurements} measurement${measurements === 1 ? '' : 's'}` : null,
    pages ? `the page scale${pages === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800">Delete this plan?</h3>
            <p className="text-sm text-slate-500 mt-1">
              The plan PDF{bits.length ? `, along with ${bits.join(' and ')},` : ''}, every earlier revision and any site photos will be removed from this job.
              Lines already on the measure sheet stay. This can&rsquo;t be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Keep plan</button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600">Delete plan</button>
        </div>
      </div>
    </div>
  );
}

/** Offer the draughtsman's own printed number in place of a scaled reading. */
export function PrintedDimensionPrompt({ suggestion, measuredMm, onAccept, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 9000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  if (!suggestion) return null;
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-[92vw]">
      <Ruler size={16} className="text-amber-400 flex-shrink-0" />
      <div className="text-xs min-w-0">
        <p className="font-medium">
          The plan prints <strong className="text-amber-300">{suggestion.value} mm</strong> here
        </p>
        <p className="text-slate-400">
          You measured {Math.round(measuredMm)} mm — {suggestion.deltaPercent.toFixed(1)}% out
        </p>
      </div>
      <button onClick={onAccept} className="px-3 py-1.5 rounded-lg bg-amber-500 text-xs font-semibold hover:bg-amber-400 flex-shrink-0">
        Use it
      </button>
      <button onClick={onDismiss} className="text-slate-400 hover:text-white flex-shrink-0"><X size={15} /></button>
    </div>
  );
}
