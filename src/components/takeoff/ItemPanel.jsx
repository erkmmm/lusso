import { useEffect, useRef, useState } from 'react';
import {
  Trash2, ChevronDown, ChevronUp, Camera, Ruler, Plus, Loader2, X,
  AlertTriangle, MapPin, Hash, Spline, Waypoints, FlipHorizontal2,
} from 'lucide-react';
import { plausibility } from '../../lib/planScale';
import { signedPhotoUrl } from '../../lib/takeoffStorage';
import { fmtMoney } from '../../lib/planEstimate';

const fmtMm = (mm) => (mm == null || mm === '' ? '—' : `${Math.round(mm)} mm`);

/**
 * What a bay or a curve adds beyond a single number.
 *
 * Both exist because a straight line across the opening measures the CHORD.
 * Making a track to the chord makes it short, so the facets (bay) and the
 * radius (curve) have to stay visible right next to the total.
 */
function ShapeSummary({ m, onSetRadius, onFlip }) {
  if (!m) return null;
  if (m.kind === 'chain' && m.segments?.length > 1) {
    const short = m.chordMm ? Math.round(m.lengthMm - m.chordMm) : 0;
    return (
      <div className="mt-1.5 rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
          <Waypoints size={11} className="text-teal-600" />
          {m.segments.length}-facet bay
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {m.segments.map((seg, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[11px] tabular-nums text-slate-700">
              {i + 1}: {Math.round(seg)}
            </span>
          ))}
        </div>
        {short > 0 && (
          <p className="text-[11px] text-slate-400 mt-1">
            A straight line across it would have read {Math.round(m.chordMm)} mm — {short} mm short.
          </p>
        )}
      </div>
    );
  }
  if (m.kind === 'arc') {
    const short = m.chordMm ? Math.round(m.lengthMm - m.chordMm) : 0;
    const flat = !m.radiusMm || short <= 0;
    return (
      <div className="mt-1.5 rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
          <Spline size={11} className="text-teal-600" /> Curved
          {onFlip && !flat && (
            <button onClick={onFlip} className="ml-auto text-[11px] text-slate-400 hover:text-amber-600 flex items-center gap-0.5"
              title="Bow the other way">
              <FlipHorizontal2 size={11} /> flip
            </button>
          )}
        </div>

        {flat ? (
          <p className="text-[11px] text-amber-700 mt-1">
            Still straight — drag the round handle at its middle on the plan: out to bow it, sideways to shift where it curves. Or type the radius below.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1 mt-1 text-[11px] tabular-nums text-slate-700">
            <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200">arc {Math.round(m.lengthMm)}</span>
            <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200">chord {Math.round(m.chordMm)}</span>
            <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200">{Math.round(m.sweepDeg)}°</span>
          </div>
        )}

        {/* Typing the radius is the exact route — dragging is for matching the
            drawing by eye, but a supplier quotes a number. */}
        {onSetRadius && (
          <RadiusField
            key={Math.round(m.radiusMm || 0)}
            current={m.radiusMm ? String(Math.round(m.radiusMm)) : ''}
            radiusMm={m.radiusMm}
            onSetRadius={onSetRadius}
          />
        )}

        {short > 0 && (
          <p className="text-[11px] text-slate-400 mt-1">
            The radius is what the track is bent to; a straight measurement would have been {short} mm short.
          </p>
        )}
      </div>
    );
  }
  return null;
}

/**
 * Radius entry that commits on blur/Enter and reverts on Escape.
 * Keyed on the current radius by the caller, so dragging the bend handle
 * remounts this and the field follows the drag instead of going stale.
 */
function RadiusField({ current, radiusMm, onSetRadius }) {
  const [value, setValue] = useState(current);
  const commit = () => {
    const n = Number(value);
    if (!(n > 0) || n === Math.round(radiusMm || 0)) { setValue(current); return; }
    onSetRadius(n);
  };
  return (
    <label className="flex items-center gap-1.5 mt-1.5">
      <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap" title="Sets an even bow across the span">Radius (mm)</span>
      <input
        type="number" inputMode="numeric" value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setValue(current); e.currentTarget.blur(); }
        }}
        placeholder="e.g. 1800"
        className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-amber-400 bg-white"
      />
    </label>
  );
}

/**
 * Put the cursor in a label box when its measurement is picked on the plan
 * and has no name yet — so marking up a room is tap, type, tap, type.
 *
 * The panel is rendered twice (tray on a phone, side panel on a laptop) and
 * only one is ever visible; `focus()` on a display:none input is a silent
 * no-op, so the hidden twin can't steal the cursor from the visible one.
 */
function useLabelFocus(active, onFocused, selectAll = false) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    // A frame's delay lets the tray finish expanding, otherwise the browser
    // scrolls to an element that is still mid-layout.
    const id = requestAnimationFrame(() => {
      if (!el.isConnected || el.offsetParent === null) return;
      el.focus({ preventScroll: true });
      // A suggested name arrives selected, so the next keystroke replaces it
      // rather than appending to a room name that may well be the wrong one.
      if (selectAll && el.value) el.select();
      el.scrollIntoView({ block: 'nearest' });
      onFocused?.();
    });
    return () => cancelAnimationFrame(id);
  }, [active, onFocused, selectAll]);
  return ref;
}

const TAGS = ['Width', 'Drop', 'Height', 'Other'];
const TAG_STYLE = {
  Width:  'bg-blue-50 text-blue-600 border-blue-200',
  Drop:   'bg-purple-50 text-purple-600 border-purple-200',
  Height: 'bg-purple-50 text-purple-600 border-purple-200',
  Other:  'bg-slate-100 text-slate-500 border-slate-200',
};

/**
 * The takeoff's working list.
 *
 * Rendered twice: as a fixed side panel on a laptop, and as a collapsible tray
 * under the plan on anything narrower — the takeoff is done on a phone or iPad
 * as often as at a desk, and a panel that simply disappears there is a panel
 * that doesn't exist.
 */
export default function ItemPanel({
  layout = 'side', open = false, onToggle,
  pageNumber, items, measurements, markers, allCounts,
  selectedIds, onSelect, hasScale, onCalibrate,
  productTypes, roomSuggestions, estimate,
  onUpdateItem, onRemoveItem, onUpdateMeasurement, onRemoveMeasurement,
  onUpdateMarker, onRemoveMarker, onMeasureDrop, onAddPhoto, onRemovePhoto,
  onSetArcRadius, onFlipArc, focusLabelId, focusSelectsAll, onLabelFocused, photoBusyId,
}) {
  const sheet = layout === 'sheet';
  const loose = measurements.filter(m => !m.itemId);
  // Count BOTH kinds. Counting only window items told someone with a dozen
  // loose measurements that they had "0 total", which reads like data loss.
  const onPage = items.length + loose.length;
  const total = allCounts.items + allCounts.looseMeasurements;
  const noun = allCounts.items && !allCounts.looseMeasurements ? 'window' : 'mark';

  if (sheet && !open) {
    return (
      <div className="lg:hidden border-t border-slate-200 bg-white flex-shrink-0">
        <PanelHandle onPage={onPage} total={total} noun={noun} open={false} onToggle={onToggle} />
      </div>
    );
  }

  return (
    <div className={sheet
      ? 'lg:hidden border-t border-slate-200 bg-white flex flex-col min-h-0 flex-shrink-0 max-h-[55vh]'
      : 'w-80 border-l border-slate-200 bg-white flex-col min-h-0 hidden lg:flex'}>
      {sheet ? (
        <PanelHandle onPage={onPage} total={total} noun={noun} open onToggle={onToggle} />
      ) : (
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm">Takeoff</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {onPage} {noun}{onPage === 1 ? '' : 's'} on this page · {total} total
          </p>
        </div>
      )}

      {!hasScale && (
        <div className="m-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
          Set the scale on this page before measuring.
          <button onClick={onCalibrate} className="block mt-1.5 font-medium underline">Set scale now</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && loose.length === 0 && markers.length === 0 && (
          <p className="px-4 py-6 text-xs text-slate-400 text-center">
            Nothing on page {pageNumber} yet. Pick <strong>Window</strong> and drag across an opening.
          </p>
        )}

        {items.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            measurements={measurements.filter(m => m.itemId === item.id)}
            selected={selectedIds.has(item.id) || measurements.some(m => m.itemId === item.id && selectedIds.has(m.id))}
            productTypes={productTypes}
            roomSuggestions={roomSuggestions}
            onSelect={() => onSelect(item.id)}
            onUpdate={patch => onUpdateItem(item.id, patch)}
            onRemove={() => onRemoveItem(item.id)}
            onMeasureDrop={() => onMeasureDrop(item.id)}
            onAddPhoto={file => onAddPhoto(item.id, file)}
            onRemovePhoto={photo => onRemovePhoto(item.id, photo)}
            onSetArcRadius={onSetArcRadius}
            onFlipArc={onFlipArc}
            focusLabel={focusLabelId === item.id}
            focusSelectsAll={focusSelectsAll}
            onLabelFocused={onLabelFocused}
            photoBusy={photoBusyId === item.id}
          />
        ))}

        {loose.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Loose measurements
            </div>
            {loose.map(m => (
              <LooseRow
                key={m.id}
                m={m}
                selected={selectedIds.has(m.id)}
                onSelect={() => onSelect(m.id)}
                onUpdate={patch => onUpdateMeasurement(m.id, patch)}
                onRemove={() => onRemoveMeasurement(m.id)}
                onSetArcRadius={onSetArcRadius}
                onFlipArc={onFlipArc}
                focusLabel={focusLabelId === m.id}
                focusSelectsAll={focusSelectsAll}
                onLabelFocused={onLabelFocused}
              />
            ))}
          </>
        )}

        {markers.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              <Hash size={11} /> Counted · {markers.length} on this page
            </div>
            {markers.map(k => (
              <div key={k.id}
                className={`px-3 py-2 flex items-center gap-2 border-b border-slate-50 ${selectedIds.has(k.id) ? 'bg-amber-50/60' : ''}`}
                onClick={() => onSelect(k.id)}
              >
                <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                  {k.index}
                </span>
                <input
                  value={k.label || ''}
                  onChange={e => onUpdateMarker(k.id, { label: e.target.value })}
                  onClick={e => e.stopPropagation()}
                  placeholder="What is it?"
                  className="flex-1 min-w-0 text-sm bg-transparent border-b border-transparent focus:border-amber-400 outline-none text-slate-800 placeholder:text-slate-300"
                />
                <button onClick={e => { e.stopPropagation(); onRemoveMarker(k.id); }} className="text-slate-300 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <EstimateFooter estimate={estimate} />
    </div>
  );
}

function PanelHandle({ onPage, total, noun, open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="w-full flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-left border-b border-slate-100"
    >
      <h2 className="font-semibold text-slate-800 text-sm">Takeoff</h2>
      <span className="text-xs text-slate-400 truncate">{onPage} {noun}{onPage === 1 ? '' : 's'} on this page · {total} total</span>
      {open
        ? <ChevronDown size={16} className="ml-auto flex-shrink-0 text-slate-400" />
        : <ChevronUp   size={16} className="ml-auto flex-shrink-0 text-slate-400" />}
    </button>
  );
}

/** One window: its label, size, product and photos. */
function ItemRow({
  item, measurements, selected, productTypes, roomSuggestions,
  onSelect, onUpdate, onRemove, onMeasureDrop, onAddPhoto, onRemovePhoto,
  onSetArcRadius, onFlipArc, focusLabel, focusSelectsAll, onLabelFocused, photoBusy,
}) {
  const [expanded, setExpanded] = useState(false);
  const labelRef = useLabelFocus(focusLabel, onLabelFocused, focusSelectsAll);
  const width = [...measurements].reverse().find(m => m.tag === 'Width');
  const drop  = [...measurements].reverse().find(m => m.tag === 'Drop' || m.tag === 'Height');
  const dropMm = item.dropMm ?? (drop ? Math.round(drop.lengthMm) : '');
  const widthFlag = width ? plausibility('Width', width.lengthMm) : 'ok';
  const dropFlag = dropMm ? plausibility('Drop', dropMm) : 'ok';
  const open = expanded || selected;

  return (
    <div className={`border-b border-slate-50 ${selected ? 'bg-amber-50/50' : ''}`}>
      <div className="px-3 py-2.5" onClick={onSelect}>
        <div className="flex items-center gap-2">
          <input
            ref={labelRef}
            value={item.label || ''}
            onChange={e => onUpdate({ label: e.target.value })}
            onClick={e => e.stopPropagation()}
            placeholder="Room / window"
            className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-transparent focus:border-amber-400 outline-none text-slate-800 placeholder:text-slate-300"
          />
          <button
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            className="text-slate-300 hover:text-slate-600"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button onClick={e => { e.stopPropagation(); onRemove(); }} className="text-slate-300 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-1.5 text-xs">
          <span className={`tabular-nums font-semibold ${widthFlag === 'ok' ? 'text-slate-600' : 'text-amber-600'}`}>
            W {fmtMm(width?.lengthMm)}
          </span>
          <span className="text-slate-300">×</span>
          <span className={`tabular-nums font-semibold ${!dropMm ? 'text-slate-300' : dropFlag === 'ok' ? 'text-slate-600' : 'text-amber-600'}`}>
            D {fmtMm(dropMm)}
          </span>
          {(item.quantity || 1) > 1 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">×{item.quantity}</span>
          )}
          {item.productNameSnapshot && (
            <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100 truncate max-w-[8rem]">
              {item.productNameSnapshot}
            </span>
          )}
          {(item.photos || []).length > 0 && (
            <span className="flex items-center gap-0.5 text-slate-400"><Camera size={11} />{item.photos.length}</span>
          )}
          {width?.kind === 'chain' && width.segments?.length > 1 && (
            <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100 flex items-center gap-1">
              <Waypoints size={10} /> {width.segments.length}
            </span>
          )}
          {width?.kind === 'arc' && (
            <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100 flex items-center gap-1">
              <Spline size={10} /> R{Math.round(width.radiusMm || 0)}
            </span>
          )}
          {!dropMm && <span className="ml-auto text-amber-600 flex items-center gap-1"><AlertTriangle size={11} /> no drop</span>}
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2.5" onClick={e => e.stopPropagation()}>
          {roomSuggestions?.length > 0 && !item.label && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[11px] text-slate-400 flex items-center gap-1"><MapPin size={10} /> nearby:</span>
              {roomSuggestions.map(s => (
                <button key={s.str} onClick={() => onUpdate({ label: s.str })}
                  className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] hover:bg-slate-200">
                  {s.str}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Drop (mm)</span>
              <div className="flex gap-1 mt-0.5">
                <input
                  type="number" inputMode="numeric"
                  value={item.dropMm ?? (drop ? Math.round(drop.lengthMm) : '')}
                  onChange={e => onUpdate({ dropMm: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="typed on site"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-amber-400"
                />
                <button
                  onClick={onMeasureDrop}
                  title="Measure the drop on an elevation sheet"
                  className="px-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex-shrink-0"
                >
                  <Ruler size={14} />
                </button>
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Quantity</span>
              <input
                type="number" min={1} inputMode="numeric"
                value={item.quantity || 1}
                onChange={e => onUpdate({ quantity: Math.max(1, Number(e.target.value) || 1) })}
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Product</span>
            <select
              value={item.productTypeId || ''}
              onChange={e => {
                const pt = productTypes.find(p => p.id === e.target.value);
                onUpdate({ productTypeId: pt?.id || '', productNameSnapshot: pt?.name || '' });
              }}
              className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-amber-400 bg-white"
            >
              <option value="">Not decided yet</option>
              {productTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Fixing</span>
            <select
              value={item.fixing || ''}
              onChange={e => onUpdate({ fixing: e.target.value })}
              className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-amber-400 bg-white"
            >
              <option value="">—</option>
              {['Ceiling', 'Face', 'Reveal'].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Notes</span>
            <input
              value={item.notes || ''}
              onChange={e => onUpdate({ notes: e.target.value })}
              placeholder="e.g. tight reveal, check bulkhead"
              className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-amber-400"
            />
          </label>

          <ShapeSummary
            m={width}
            onSetRadius={width?.kind === 'arc' ? (r => onSetArcRadius(width.id, r)) : null}
            onFlip={width?.kind === 'arc' ? (() => onFlipArc(width.id)) : null}
          />

          {/* A bay is normally one blind per facet, so this decides whether the
              window becomes one wide sheet row or one row per facet. */}
          {width?.kind === 'chain' && width.segments?.length > 1 && (
            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={item.splitSegments !== false}
                onChange={e => onUpdate({ splitSegments: e.target.checked })}
                className="mt-0.5 accent-amber-500"
              />
              <span>
                One blind per facet
                <span className="block text-slate-400">
                  {item.splitSegments !== false
                    ? `${width.segments.length} separate rows on the measure sheet`
                    : `One row, ${Math.round(width.lengthMm)} mm wide — for a single curved or bent track`}
                </span>
              </span>
            </label>
          )}

          <PhotoStrip
            photos={item.photos || []}
            busy={photoBusy}
            onAdd={onAddPhoto}
            onRemove={onRemovePhoto}
          />
        </div>
      )}
    </div>
  );
}

/** A measurement not attached to a window — the original flat behaviour. */
function LooseRow({ m, selected, onSelect, onUpdate, onRemove, onSetArcRadius, onFlipArc, focusLabel, focusSelectsAll, onLabelFocused }) {
  const flag = plausibility(m.tag, m.lengthMm);
  const labelRef = useLabelFocus(focusLabel, onLabelFocused, focusSelectsAll);
  return (
    <div className={`px-3 py-2.5 border-b border-slate-50 ${selected ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <input
          ref={labelRef}
          value={m.label || ''}
          onChange={e => onUpdate({ label: e.target.value })}
          onClick={e => e.stopPropagation()}
          placeholder="Label (e.g. Bed 1 window)"
          className="flex-1 min-w-0 text-sm bg-transparent border-b border-transparent focus:border-amber-400 outline-none text-slate-800 placeholder:text-slate-300"
        />
        <button onClick={e => { e.stopPropagation(); onRemove(); }} className="text-slate-300 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <select
          value={m.tag}
          onChange={e => onUpdate({ tag: e.target.value })}
          onClick={e => e.stopPropagation()}
          className={`text-xs font-medium rounded border px-1.5 py-0.5 outline-none cursor-pointer ${TAG_STYLE[m.tag] || TAG_STYLE.Other}`}
        >
          {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {flag !== 'ok' && (
          <span className={`text-[11px] flex items-center gap-1 ${flag === 'hard' ? 'text-red-500' : 'text-amber-600'}`}>
            <AlertTriangle size={11} /> {flag === 'hard' ? 'check the scale' : 'unusual'}
          </span>
        )}
        <span className="text-sm font-semibold text-slate-700 tabular-nums ml-auto">{fmtMm(m.lengthMm)}</span>
      </div>
      {selected && (
        <ShapeSummary
          m={m}
          onSetRadius={m.kind === 'arc' ? (r => onSetArcRadius(m.id, r)) : null}
          onFlip={m.kind === 'arc' ? (() => onFlipArc(m.id)) : null}
        />
      )}
    </div>
  );
}

function PhotoStrip({ photos, busy, onAdd, onRemove }) {
  return (
    <div>
      <span className="text-[11px] font-medium text-slate-500">Photos</span>
      <div className="flex gap-1.5 mt-1 flex-wrap">
        {photos.map(p => <PhotoThumb key={p.id} photo={p} onRemove={() => onRemove(p)} />)}
        <label className="w-14 h-14 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/40 text-slate-400">
          {busy ? <Loader2 size={16} className="animate-spin text-amber-500" /> : <Plus size={16} />}
          <input
            type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAdd(f); }}
          />
        </label>
      </div>
    </div>
  );
}

function PhotoThumb({ photo, onRemove }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    signedPhotoUrl(photo.path).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [photo.path]);
  return (
    <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-slate-100 group">
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"><Camera size={14} className="text-slate-300" /></div>}
      <button
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100"
        aria-label="Remove photo"
      >
        <X size={10} />
      </button>
    </div>
  );
}

/**
 * The running budget number.
 *
 * Deliberately a RANGE from the business's own quote history rather than a
 * single figure — a takeoff has no fabric, control or supplier, so a precise
 * number here would be a lie that someone eventually quotes off.
 */
function EstimateFooter({ estimate }) {
  if (!estimate) return null;
  if (!estimate.hasRates) {
    return (
      <div className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-400">
        Windows flow into this job&rsquo;s measure sheet automatically.
      </div>
    );
  }
  return (
    <div className="px-3 py-2.5 border-t border-slate-100 bg-slate-50/70">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Budget</span>
        <span className="ml-auto text-sm font-semibold text-slate-800 tabular-nums">
          {estimate.mid > 0 ? `${fmtMoney(estimate.low)} – ${fmtMoney(estimate.high)}` : '—'}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mt-0.5">
        {estimate.pricedCount} priced from past quotes
        {estimate.unpricedCount > 0 && ` · ${estimate.unpricedCount} need a product type`}
        {estimate.pricedCount > 0 && ' · excludes GST, fabric and install'}
      </p>
    </div>
  );
}
