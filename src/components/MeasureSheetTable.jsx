import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { Trash2, Copy, Pin, PinOff, Rows3, Rows4 } from 'lucide-react';
import { getMsOptions, MS_SPEC_FIELDS, getVisibleSpecKeys, makeProductSelectHandlers } from '../store/data';
import PricedItemPicker from './PricedItemPicker';
import CheckMeasureControl from './CheckMeasureControl';
import LinePhotos from './LinePhotos';
import LineLimitWarnings from './LineLimitWarnings';

// Spreadsheet-style editor for measure-sheet line items. Edits the SAME sheet
// state (via setLineItem/removeLineItem) as the card layout, so the two stay in
// sync and validation still applies.
//
// Columns are PRUNED to only the specs the sheet's products actually use (union
// of each item's product-type specs, plus any spec that already holds a value),
// so a roller-blind-only sheet no longer carries curtain-only columns. That
// keeps the table narrow enough to avoid the old fixed 1900px sideways scroll.
//
// ── Scrolling ───────────────────────────────────────────────────────────────
// ONE scroll container, both axes (`.ms-scroll`). This used to be an
// `overflow-x-auto` div nested inside whatever page or pane scrolled
// vertically, which meant:
//   • a sideways swipe landed in whichever box caught it first, so the grid
//     drifted, bounced, or refused to move depending on where your thumb was
//   • `position: sticky` could not work at all — the vertical and horizontal
//     axes belonged to two different scrollers, so neither the header row nor
//     the room name could be pinned
// With a single scroller both are just sticky cells: the header row pins to the
// top, and `#` + Location pin to the left so the room you're measuring stays on
// screen however far right you scroll. On a wide screen the actions column pins
// to the right as well, so delete/photos never need a full scroll to reach.
//
// ── Spreadsheet behaviour ───────────────────────────────────────────────────
//   • click a cell to select it — the field stays live, so it's still one tap
//     then type, which is what matters on site
//   • shift+click / shift+↑↓ extends the selection
//   • drag the fill handle (bottom-right of the selection) to copy down or up
//   • ⌘/Ctrl+D fill down · ⌘/Ctrl+C copy · ⌘/Ctrl+V paste TSV straight out of
//     Excel (extra rows are appended rather than dropped)
//   • Delete clears a multi-cell selection · Enter/Tab/↑↓ move between cells

const SEL_COLOR = 'rgb(245 158 11)'; // amber-500 — the grid's selection outline

// Pinned-column geometry. Fixed numbers because `left:` offsets have to be
// known up front, and the row-number column has to be the same width in the
// header as in the body or the pinned block shears when you scroll.
const NUM_W   = 34;
const LOC_W   = 150;   // roomy enough for "Master Bedroom"
const LOC_W_S = 116;   // phones — a pinned 184px block on a 390px screen leaves nothing to scroll
const ACT_W   = 96;

// Pin the actions column only when there's width to spare. On a phone, pinning
// both ends would leave a ~110px scrolling window, which is worse than the
// problem it solves.
const PIN_RIGHT_MIN = 700;

const cellPad = (d) => (d === 'comfortable' ? 'py-3' : 'py-1.5');
const inputCls = (d) =>
  `ms-cell-input w-full bg-transparent px-2 ${cellPad(d)} text-sm text-slate-800 outline-none focus:bg-amber-50 rounded-sm`;
const selectCls = (d) => `${inputCls(d)} appearance-none cursor-pointer pr-1`;

// Per-spec column min-widths (px) — mirrors the old fixed layout's sizing.
const SPEC_MIN = {
  control: 90, returnSide: 90, motorSide: 100, fixing: 100, heading: 130, hem: 100,
  trackColour: 110, baseBarColour: 130, operationType: 150, baseBarType: 130, chainColour: 110,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const norm  = (s) => ({
  r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2),
  c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2),
});
const isOneCell = (n) => n.r1 === n.r2 && n.c1 === n.c2;

// Pinned cells must be opaque or the row scrolls visibly underneath them, so
// they can't use the translucent tints the scrolling cells do.
const pinnedBg = ({ breach, selected, active }) =>
  breach === 'error'     ? 'bg-red-50'
  : breach === 'warning' ? 'bg-amber-100'
  : selected             ? 'bg-amber-50'
  : active               ? 'bg-slate-50'
  : 'bg-white';

function HCell({ children, min, width, highlight, stickyLeft, stickyRight, pinEdge }) {
  const style = { minWidth: min, width };
  if (stickyLeft !== undefined)  style.left  = stickyLeft;
  if (stickyRight !== undefined) style.right = stickyRight;
  const pinned = stickyLeft !== undefined || stickyRight !== undefined;
  return (
    <th style={style}
      className={`sticky top-0 z-20 border-r border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold whitespace-nowrap ${
        pinned ? 'z-30 bg-slate-50' : 'bg-slate-50'
      } ${pinEdge ? 'ms-pin-edge' : ''} ${
        highlight ? 'text-amber-700' : 'text-slate-500 font-medium'
      }`}>{children}</th>
  );
}

// A value filled or pasted in from another row may not be on this row's option
// list (different product type). Show it anyway rather than rendering a blank
// select — what you filled is what you get, same as a spreadsheet.
function Sel({ value, onChange, options, density }) {
  const extra = value && !options.includes(value) ? [value] : [];
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} className={selectCls(density)}>
      <option value=""></option>
      {[...options, ...extra].map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ── One row, memoised ───────────────────────────────────────────────────────
// Typing in a cell changes exactly one line item, but the table used to render
// every row on every keystroke — on a 20-line sheet that's ~300 inputs and
// selects rebuilt per character, which is most of why the grid felt sluggish on
// an iPad. So the row is its own memoised component and everything it receives
// is either a primitive or a stable reference:
//
//   • the handlers are useCallback'd here AND in the parent page
//   • the option lists come back from getMsOptions() as cached arrays
//   • the selection arrives pre-reduced to per-row numbers (which columns are
//     selected on THIS row), never the whole {r,c,r2,c2} object — a selection
//     that moves within one row must not invalidate the other nineteen.
const Row = memo(function Row({
  item, idx, cols, productTypes, errors, issues,
  selC1, selC2, selTop, selBottom, anchorCol, handleCol, previewC1, previewC2, active,
  hasTakeoffLines, sheetId, canRemove, density, pinned, locW, pinRight,
  setLineItem, removeLineItem, copyLineItem, setLinePhotos,
  onConfirmMeasured, onRevertToPlan, onOpenLimitDoc,
  cellRefs, onCellMouseDown, onCellFocus, onHandleDown,
}) {
  // Worst severity per measured field, so the offending cell can say so itself.
  const issueBy = {};
  for (const r of issues || []) {
    if (r.field !== 'width' && r.field !== 'drop') continue;
    const k = r.field === 'width' ? 'widthMm' : 'dropMm';
    if (r.severity === 'error' || !issueBy[k]) issueBy[k] = r.severity;
  }
  const pt = productTypes.find(p => p.id === item.productTypeId) || null;
  const productHandlers = makeProductSelectHandlers(setLineItem, idx, productTypes);

  const control = (col) => {
    if (col.type === 'product') {
      return (
        <div className="px-1">
          <PricedItemPicker
            value={item.productNameSnapshot}
            productTypes={productTypes}
            error={!!errors[`item_${idx}_productType`]}
            typesFirst
            placeholder="Select product type…"
            {...productHandlers}
          />
        </div>
      );
    }
    if (col.type === 'select') {
      return <Sel value={item[col.field]} onChange={v => setLineItem(idx, col.field, v)}
        options={getMsOptions(col.optionKey, pt)} density={density} />;
    }
    if (col.type === 'bool') {
      return (
        <select value={item[col.field] ? 'Yes' : 'No'}
          onChange={e => setLineItem(idx, col.field, e.target.value === 'Yes')} className={selectCls(density)}>
          <option value="No">No</option>
          <option value="Yes">Yes</option>
        </select>
      );
    }
    if (col.type === 'number') {
      return (
        <input type="number" inputMode="numeric" min="0" value={item[col.field] ?? ''}
          onChange={e => setLineItem(idx, col.field, e.target.value)}
          placeholder={col.key === 'quantity' ? '' : 'mm'}
          className={`${inputCls(density)} no-spin text-right ${col.highlight ? 'font-semibold text-slate-900 bg-amber-50/50 focus:bg-amber-100' : ''}`} />
      );
    }
    const err      = col.key === 'location' && !!errors[`item_${idx}_location`];
    const disabled = col.key === 'liningFabric' && !item.attachedLining;
    const ph = {
      location: 'Room', fabric: 'Fabric / colour', notes: 'Notes',
      liningFabric: item.attachedLining ? 'Lining fabric' : '—',
    }[col.key] || '';
    return (
      <input value={item[col.field] || ''} disabled={disabled} placeholder={ph}
        onChange={e => setLineItem(idx, col.field, e.target.value)}
        className={`${inputCls(density)} disabled:opacity-40 ${err ? 'ring-1 ring-red-300 rounded' : ''}`} />
    );
  };

  const gridCell = (c) => {
    const col      = cols[c];
    const breach   = issueBy[col.key];
    const selected = selC1 >= 0 && c >= selC1 && c <= selC2;
    const anchor   = c === anchorCol;
    const preview  = previewC1 >= 0 && c >= previewC1 && c <= previewC2;
    // Column 0 is Location — pinned alongside the row number.
    const isPinned = pinned && c === 0;

    const shadow = [];
    if (selected) {
      if (selTop)      shadow.push(`inset 0 2px 0 0 ${SEL_COLOR}`);
      if (selBottom)   shadow.push(`inset 0 -2px 0 0 ${SEL_COLOR}`);
      if (c === selC1) shadow.push(`inset 2px 0 0 0 ${SEL_COLOR}`);
      if (c === selC2) shadow.push(`inset -2px 0 0 0 ${SEL_COLOR}`);
    } else if (preview) {
      shadow.push('inset 0 0 0 1px rgb(245 158 11 / 0.5)');
    }

    const tone = isPinned
      ? pinnedBg({ breach, selected, active })
      : breach === 'error' ? 'bg-red-50'
      : breach === 'warning' ? 'bg-amber-100/60'
      : selected && !anchor ? 'bg-amber-50/50'
      : preview ? 'bg-amber-50/40'
      : active ? 'bg-slate-50/60'
      : '';

    const style = { width: col.w, minWidth: col.min, boxShadow: shadow.join(', ') || undefined };
    if (isPinned) { style.left = NUM_W; style.width = locW; style.minWidth = locW; }

    return (
      <td key={col.key}
        ref={el => { if (el) cellRefs.current.set(`${idx}:${c}`, el); else cellRefs.current.delete(`${idx}:${c}`); }}
        className={`relative border-r border-b border-slate-100 align-middle ${tone} ${
          isPinned ? 'sticky z-10 ms-pin-edge' : ''
        }`}
        style={style}
        onMouseDown={e => onCellMouseDown(e, idx, c)}
        onFocusCapture={() => onCellFocus(idx, c)}
      >
        {control(col)}
        {c === handleCol && (
          <span onPointerDown={onHandleDown} title="Drag to copy down"
            className="absolute -bottom-1.5 -right-1.5 p-2 z-20 cursor-crosshair"
            style={{ touchAction: 'none' }}>
            <span className="block w-3 h-3 rounded-[2px] bg-amber-500 border border-white shadow-sm" />
          </span>
        )}
      </td>
    );
  };

  const rowBg = active ? 'bg-slate-50/60' : '';

  return (
    <tr data-row={idx} className={`group ${rowBg}`}>
      <td className={`border-r border-b border-slate-100 align-middle text-center ${
            pinned ? 'sticky left-0 z-10' : ''
          } ${pinned ? pinnedBg({ selected: selC1 >= 0, active }) : ''}`}
        style={{ width: NUM_W, minWidth: NUM_W }}>
        <span className={`text-xs tabular-nums ${active ? 'font-bold text-amber-600' : 'text-slate-400'}`}>{idx + 1}</span>
      </td>

      {cols.map((_, c) => gridCell(c))}

      {hasTakeoffLines && (
        <td className="border-r border-b border-slate-100 align-middle" style={{ minWidth: 120 }}>
          <div className="px-1.5">
            <CheckMeasureControl item={item} compact
              onConfirm={() => onConfirmMeasured?.(idx)}
              onRevert={() => onRevertToPlan?.(idx)} />
          </div>
        </td>
      )}

      <td className={`border-b border-slate-100 text-center whitespace-nowrap ${
            pinRight ? 'sticky right-0 z-10 border-l border-slate-200' : ''
          } ${pinRight ? pinnedBg({ active }) : ''}`}
        style={{ width: ACT_W, minWidth: ACT_W }}>
        {issues?.length > 0 && (
          <span className="inline-block mr-0.5 align-middle"
            onClick={() => onOpenLimitDoc?.(issues[0].source?.id)} role="presentation">
            <LineLimitWarnings compact results={issues} />
          </span>
        )}
        {setLinePhotos && (
          <LinePhotos
            compact
            sheetId={sheetId}
            item={item}
            onChange={(paths) => setLinePhotos(item.id, paths)}
          />
        )}
        {copyLineItem && (
          <button type="button" onClick={() => copyLineItem(idx)} tabIndex={-1}
            title="Duplicate line" className="text-slate-300 hover:text-amber-500 p-1.5">
            <Copy size={14} />
          </button>
        )}
        <button type="button" onClick={() => removeLineItem(idx)} disabled={!canRemove} tabIndex={-1}
          title="Remove line" className="text-slate-300 hover:text-red-500 disabled:opacity-30 p-1.5">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
});

export default function MeasureSheetTable({
  lineItems, setLineItem, removeLineItem, productTypes, errors = {},
  onConfirmMeasured, onRevertToPlan, addLineItem, copyLineItem,
  // Spec-sheet breaches per line id — see src/lib/productLimits.js.
  limitIssues = {}, onOpenLimitDoc = null,
  // Photos deliberately sit OUTSIDE the `cols` grid model: fill-down, copy and
  // paste are all defined over text cells, and a photo is not something you
  // want dragged into the next four rows. It rides in the actions cell instead.
  sheetId = null, setLinePhotos = null,
  // `fill` = the grid owns the height it's given (fullscreen pane). Otherwise
  // it caps itself so the pinned header still has something to pin against
  // while the page scrolls around it.
  fill = false,
}) {
  // Which columns the sheet needs. Depends only on the line items, so it is
  // recomputed when they change — not when the selection moves.
  const { hasTakeoffLines, liningShown, dropdownKeys } = useMemo(() => {
    const ptFor = (item) => productTypes.find(p => p.id === item.productTypeId) || null;
    // Union of visible spec keys across all rows → the spec columns to render.
    const shown = new Set();
    lineItems.forEach(item => getVisibleSpecKeys(item, ptFor(item)).forEach(k => shown.add(k)));
    const specCols = MS_SPEC_FIELDS.filter(f => shown.has(f.key)); // canonical order
    return {
      // Only worth a column when the sheet actually has plan-derived lines.
      hasTakeoffLines: lineItems.some(li => li.source === 'takeoff'),
      liningShown: shown.has('lining'),
      dropdownKeys: specCols.filter(f => f.key !== 'lining').map(f => f.key).join(','),
    };
  }, [lineItems, productTypes]);

  // ── Column model ────────────────────────────────────────────────────────
  // One descriptor per selectable cell, in render order. Everything the grid
  // does — fill, copy, paste, navigation — works off this list, so a new
  // column is a one-line change instead of five.
  //
  // Location MUST stay index 0: it's the column that pins to the left, because
  // it's the one you need on screen while you read a width off the far right.
  const cols = useMemo(() => {
    const dropdownCols = MS_SPEC_FIELDS.filter(f => dropdownKeys.split(',').includes(f.key));
    const list = [
      { key: 'location', label: 'Location', min: 150, type: 'text',    field: 'location' },
      { key: 'product',  label: 'Product',  min: 170, type: 'product' },
      { key: 'widthMm',  label: 'Width', min: 92, w: 92, type: 'number', field: 'widthMm', highlight: true },
      { key: 'dropMm',   label: 'Drop',  min: 92, w: 92, type: 'number', field: 'dropMm',  highlight: true },
      { key: 'quantity', label: 'Qty',   min: 56, w: 56, type: 'number', field: 'quantity' },
      { key: 'fabric',   label: 'Fabric', min: 140, type: 'text', field: 'fabricColour' },
      ...dropdownCols.map(f => ({
        key: f.key, label: f.label, min: SPEC_MIN[f.key], type: 'select',
        field: f.itemField, optionKey: f.optionKey,
      })),
    ];
    if (liningShown) {
      list.push({ key: 'lining',       label: 'Lining',        min: 80,  type: 'bool', field: 'attachedLining' });
      list.push({ key: 'liningFabric', label: 'Lining Fabric', min: 140, type: 'text', field: 'liningFabricColour' });
    }
    list.push({ key: 'notes', label: 'Notes', min: 150, type: 'text', field: 'notes' });
    return list;
  }, [dropdownKeys, liningShown]);

  const rowCount = lineItems.length;
  const colCount = cols.length;

  // ── Viewport-dependent layout ───────────────────────────────────────────
  // The pinned block has to shrink on a phone and the right-hand actions
  // column only earns a pin on a wide screen, so the grid needs to know how
  // much room it has. Width only — this never re-renders on scroll.
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  const locW = vw < 480 ? LOC_W_S : LOC_W;

  // ── Preferences ─────────────────────────────────────────────────────────
  // Pinning is on by default — losing the room name is the thing people
  // actually complain about — but it's a toggle, because on a narrow screen
  // you sometimes want every pixel for the measurements.
  const [pinned, setPinned] = useState(() => localStorage.getItem('lusso_ms_pin') !== '0');
  // Row height. A 30px row is fine with a mouse and far too tight with a
  // finger on a ladder, so touch devices start roomy.
  const [density, setDensity] = useState(() => {
    const saved = localStorage.getItem('lusso_ms_density');
    if (saved === 'compact' || saved === 'comfortable') return saved;
    return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
      ? 'comfortable' : 'compact';
  });
  const togglePin = () => setPinned(p => { localStorage.setItem('lusso_ms_pin', p ? '0' : '1'); return !p; });
  const toggleDensity = () => setDensity(d => {
    const next = d === 'compact' ? 'comfortable' : 'compact';
    localStorage.setItem('lusso_ms_density', next);
    return next;
  });

  const pinRight = pinned && vw >= PIN_RIGHT_MIN;

  // ── Selection ───────────────────────────────────────────────────────────
  const [sel, setSel]       = useState(null); // {r, c, r2, c2} — r/c is the anchor
  const [fillRow, setFill]  = useState(null); // row the fill handle is hovering
  const [dragging, setDrag] = useState(false);
  const cellRefs  = useRef(new Map());
  const scrollRef = useRef(null);
  const theadRef  = useRef(null);

  // A selection can outlive the rows it pointed at (someone deletes a line).
  // Clamped here at render rather than in an effect, so a stale selection never
  // costs a second render pass.
  const cur = sel && sel.r < rowCount && sel.r2 < rowCount && sel.c < colCount && sel.c2 < colCount ? sel : null;

  // ── Keeping a cell visible ──────────────────────────────────────────────
  // scrollIntoView({inline:'nearest'}) parks the cell at the scroller's edge,
  // which with pinned columns means underneath them — you tab right and the
  // cell you're typing in is hidden behind the room name. So the reveal is done
  // by hand against the pinned insets and the sticky header's height.
  const revealCell = useCallback((td) => {
    const sc = scrollRef.current;
    if (!sc || !td) return;
    const padL = pinned ? NUM_W + locW : 0;
    const padR = pinRight ? ACT_W : 0;
    const padT = theadRef.current?.getBoundingClientRect().height || 0;
    const s = sc.getBoundingClientRect();
    const t = td.getBoundingClientRect();

    const overL = (s.left + padL) - t.left;
    const overR = t.right - (s.right - padR);
    if (overL > 0)      sc.scrollLeft -= overL + 8;
    else if (overR > 0) sc.scrollLeft += overR + 8;

    const overT = (s.top + padT) - t.top;
    const overB = t.bottom - s.bottom;
    if (overT > 0)      sc.scrollTop -= overT + 4;
    else if (overB > 0) sc.scrollTop += overB + 4;
  }, [pinned, locW, pinRight]);

  const focusCell = useCallback((r, c) => {
    const td = cellRefs.current.get(`${r}:${c}`);
    const el = td?.querySelector('input,select,button,textarea');
    if (el) {
      el.focus({ preventScroll: true });
      if (el.tagName === 'INPUT' && typeof el.select === 'function') { try { el.select(); } catch { /* number inputs refuse */ } }
    }
    revealCell(td);
  }, [revealCell]);

  const goTo = (r, c) => {
    const rr = clamp(r, 0, rowCount - 1);
    const cc = clamp(c, 0, colCount - 1);
    setSel({ r: rr, c: cc, r2: rr, c2: cc });
    requestAnimationFrame(() => focusCell(rr, cc));
  };

  // Tab wraps to the next/previous row, like a spreadsheet.
  const moveH = (dir) => {
    if (!cur) return;
    let r = cur.r, c = cur.c + dir;
    if (c >= colCount) { c = 0; r = Math.min(r + 1, rowCount - 1); }
    if (c < 0)         { c = colCount - 1; r = Math.max(r - 1, 0); }
    goTo(r, c);
  };

  // A cell focused by tapping it can still be sitting under a pinned column
  // (the browser's own focus scroll doesn't know they're there), so nudge it
  // clear on focus too.
  const nudgeIntoView = useCallback((r, c) => {
    const td = cellRefs.current.get(`${r}:${c}`);
    if (td) requestAnimationFrame(() => revealCell(td));
  }, [revealCell]);

  // Pinned-edge shadow. Toggled on the DOM directly: a scroll handler that set
  // React state would re-render the grid on every frame of a sideways swipe.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const on = () => sc.classList.toggle('ms-scrolled-x', sc.scrollLeft > 2);
    on();
    sc.addEventListener('scroll', on, { passive: true });
    return () => sc.removeEventListener('scroll', on);
  }, [pinned]);

  // ── Reading / writing a cell ────────────────────────────────────────────
  const readCell = (item, col) => {
    if (!item) return col.type === 'bool' ? false : '';
    if (col.type === 'product') return {
      pricedItemId:        item.pricedItemId ?? null,
      productNameSnapshot: item.productNameSnapshot ?? '',
      productTypeId:       item.productTypeId ?? '',
    };
    if (col.type === 'bool') return !!item[col.field];
    return item[col.field] ?? '';
  };

  const cellText = (item, col) => {
    const v = readCell(item, col);
    if (col.type === 'product') return v.productNameSnapshot || '';
    if (col.type === 'bool')    return v ? 'Yes' : 'No';
    return v === null || v === undefined ? '' : String(v);
  };

  const writeCell = (r, col, value) => {
    if (col.type === 'product') {
      setLineItem(r, 'pricedItemId',        value?.pricedItemId ?? null);
      setLineItem(r, 'productNameSnapshot', value?.productNameSnapshot ?? '');
      setLineItem(r, 'productTypeId',       value?.productTypeId ?? '');
      return;
    }
    setLineItem(r, col.field, value);
  };

  // Text in (from a paste) → the shape the field actually stores.
  const writeText = (r, col, txt) => {
    const t = (txt ?? '').trim();
    if (col.type === 'number')  return writeCell(r, col, t.replace(/[^0-9.]/g, ''));
    if (col.type === 'bool')    return writeCell(r, col, /^(y|yes|true|1)$/i.test(t));
    if (col.type === 'product') {
      if (!t) return writeCell(r, col, null);
      const pt = productTypes.find(p => (p.name || '').toLowerCase() === t.toLowerCase());
      return writeCell(r, col, { pricedItemId: null, productNameSnapshot: t, productTypeId: pt?.id || '' });
    }
    return writeCell(r, col, t);
  };

  const clearCell = (r, col) => {
    if (col.type === 'product') return writeCell(r, col, null);
    if (col.type === 'bool')    return writeCell(r, col, false);
    writeCell(r, col, '');
  };

  // ── Fill (drag handle / ⌘D) ─────────────────────────────────────────────
  // Excel's rules: a single source cell copies; a multi-cell source repeats its
  // pattern; two or more numbers with a constant step extrapolate the series.
  const seriesStep = (vals) => {
    if (vals.length < 2) return null;
    const nums = vals.map(v => {
      const s = String(v ?? '').trim();
      return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
    });
    if (nums.some(x => x === null)) return null;
    const d = nums[1] - nums[0];
    if (d === 0) return null;
    for (let i = 2; i < nums.length; i++) if (nums[i] - nums[i - 1] !== d) return null;
    return { d, first: nums[0], last: nums[nums.length - 1] };
  };

  const fillFrom = (block, targetRow) => {
    const height = block.r2 - block.r1 + 1;
    const down   = targetRow > block.r2;
    const rows   = [];
    if (down) for (let r = block.r2 + 1; r <= targetRow; r++) rows.push(r);
    else      for (let r = block.r1 - 1; r >= targetRow; r--) rows.push(r);
    if (!rows.length) return;

    for (let c = block.c1; c <= block.c2; c++) {
      const col = cols[c];
      const src = [];
      for (let r = block.r1; r <= block.r2; r++) src.push(readCell(lineItems[r], col));
      let step = col.type === 'number' ? seriesStep(src) : null;
      // A series is only sensible while it stays positive — nobody wants a
      // -600mm drop because two seed cells happened to descend.
      if (step) {
        const end = down ? step.last + step.d * rows.length : step.first - step.d * rows.length;
        if (end <= 0) step = null;
      }

      rows.forEach((r, i) => {
        const k = i + 1; // 1-based distance from the source block
        if (step) {
          writeCell(r, col, String(down ? step.last + step.d * k : step.first - step.d * k));
        } else {
          const pos = down ? (height - 1 + k) % height : ((-k % height) + height) % height;
          writeCell(r, col, src[pos]);
        }
      });
    }
  };

  const fillDown = () => {
    if (!cur) return;
    const n = norm(cur);
    if (n.r1 !== n.r2) fillFrom({ ...n, r2: n.r1 }, n.r2);                     // top row → the rest
    else if (n.r1 > 0) fillFrom({ ...n, r1: n.r1 - 1, r2: n.r1 - 1 }, n.r1);   // row above → here
  };

  // Pointer drag on the handle — pointer events, so a finger on the iPad works
  // the same as a mouse. Autoscrolls in both axes now that the grid is a single
  // scroller: dragging a fill down a 30-line sheet shouldn't stop at the fold.
  const dragState = useRef({ block: null, row: null });
  const onHandleDown = (e) => {
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const block = norm(cur);
    dragState.current = { block, row: block.r2 };
    setDrag(true);
    setFill(block.r2);

    const sc = scrollRef.current;
    const onMove = (ev) => {
      if (sc) {
        const box = sc.getBoundingClientRect();
        if (ev.clientY > box.bottom - 48)      sc.scrollTop += 18;
        else if (ev.clientY < box.top + 48)    sc.scrollTop -= 18;
        if (ev.clientX > box.right - 48)       sc.scrollLeft += 18;
        else if (ev.clientX < box.left + 48)   sc.scrollLeft -= 18;
      }
      const tr = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('tr[data-row]');
      if (!tr) return;
      const r = clamp(Number(tr.dataset.row), 0, rowCount - 1);
      dragState.current.row = r;
      setFill(r);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(false);
      setFill(null);
      const { block: b, row } = dragState.current;
      if (b && row !== null && (row > b.r2 || row < b.r1)) {
        fillFrom(b, row);
        setSel({ r: Math.min(b.r1, row), c: b.c1, r2: Math.max(b.r2, row), c2: b.c2 });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ── Clipboard ───────────────────────────────────────────────────────────
  const onCopy = (e) => {
    if (!cur) return;
    const n = norm(cur);
    if (isOneCell(n)) return; // let the focused field copy its own text
    const tsv = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const row = [];
      for (let c = n.c1; c <= n.c2; c++) row.push(cellText(lineItems[r], cols[c]));
      tsv.push(row.join('\t'));
    }
    e.clipboardData.setData('text/plain', tsv.join('\n'));
    e.preventDefault();
  };

  const onPaste = (e) => {
    if (!cur) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    const grid = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
    if (grid.length === 1 && grid[0].length === 1) return; // a plain value → native paste into the field
    e.preventDefault();

    const n = norm(cur);
    // Pasting 20 rows out of Excel into a 3-line sheet should give 20 lines.
    const need = addLineItem ? Math.max(0, n.r1 + grid.length - rowCount) : 0;
    for (let i = 0; i < need; i++) addLineItem();
    const maxRow = rowCount + need - 1;

    grid.forEach((cells, ri) => {
      const r = n.r1 + ri;
      if (r > maxRow) return;
      cells.forEach((txt, ci) => {
        const c = n.c1 + ci;
        if (c >= colCount) return;
        writeText(r, cols[c], txt);
      });
    });
    setSel({
      r: n.r1, c: n.c1,
      r2: Math.min(n.r1 + grid.length - 1, maxRow),
      c2: Math.min(n.c1 + grid[0].length - 1, colCount - 1),
    });
  };

  // ── Keyboard ────────────────────────────────────────────────────────────
  const onKeyDown = (e) => {
    if (!cur) return;
    const n    = norm(cur);
    const meta = e.metaKey || e.ctrlKey;
    const tag  = e.target.tagName;

    if (meta && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); fillDown(); return; }
    if (e.key === 'Escape') { setSel(s => (s ? { ...s, r2: s.r, c2: s.c } : s)); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isOneCell(n)) {
      e.preventDefault();
      for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) clearCell(r, cols[c]);
      return;
    }
    if (e.key === 'Enter' && tag !== 'BUTTON') { e.preventDefault(); goTo(cur.r + (e.shiftKey ? -1 : 1), cur.c); return; }
    if (e.key === 'Tab') { e.preventDefault(); moveH(e.shiftKey ? -1 : 1); return; }
    // ↑/↓ navigate rows — except on a <select>, where they're how you pick.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tag !== 'SELECT') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      e.preventDefault();
      if (e.shiftKey) setSel(s => (s ? { ...s, r2: clamp(s.r2 + d, 0, rowCount - 1) } : s));
      else goTo(cur.r + d, cur.c);
    }
  };

  // ── Rendering ───────────────────────────────────────────────────────────
  const n = cur ? norm(cur) : null;

  // Cell-level interaction handlers, hoisted out of the row so their identity is
  // stable and the memoised rows aren't invalidated by them.
  const onCellMouseDown = useCallback((e, r, c) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    setSel(s => (s ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c }));
  }, []);
  const onCellFocus = useCallback((r, c) => {
    setSel(s => (s && s.r === r && s.c === c && s.r2 === r && s.c2 === c ? s : { r, c, r2: r, c2: c }));
    nudgeIntoView(r, c);
  }, [nudgeIntoView]);

  // onHandleDown closes over the current selection and the whole fill machinery,
  // so it can't be useCallback'd directly without going stale. Latest-ref it:
  // the rows get one identity for the life of the table, the pointer handler
  // always runs the current logic.
  const handleDownRef = useRef(onHandleDown);
  useEffect(() => { handleDownRef.current = onHandleDown; });
  const stableHandleDown = useCallback((e) => handleDownRef.current(e), []);

  // Per-row slice of the selection / fill preview, reduced to numbers. -1 means
  // "nothing on this row", which keeps the memo comparison cheap and stops a
  // selection change in one row from re-rendering every other row.
  const rowSel = (r) => {
    const selected = !!n && r >= n.r1 && r <= n.r2;
    const inPreview = fillRow !== null && !!n &&
      (fillRow > n.r2 ? (r > n.r2 && r <= fillRow) : (r < n.r1 && r >= fillRow));
    return {
      selC1:      selected ? n.c1 : -1,
      selC2:      selected ? n.c2 : -1,
      selTop:     selected && r === n.r1,
      selBottom:  selected && r === n.r2,
      anchorCol:  cur && cur.r === r ? cur.c : -1,
      handleCol:  selected && r === n.r2 && !dragging ? n.c2 : -1,
      previewC1:  inPreview ? n.c1 : -1,
      previewC2:  inPreview ? n.c2 : -1,
      // Whole-row tint for the row you're on. On a grid wider than the screen
      // this is what stops you reading line 7's width onto line 8.
      active:     !!cur && cur.r === r,
    };
  };

  const ctrlBtn = 'flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border transition-colors';

  return (
    <div className={`border border-slate-200 bg-white ${
      fill ? 'flex flex-col min-h-0 flex-1 rounded-none border-x-0' : 'rounded-xl'
    }`}>
      {/* Grid controls. In the table itself rather than the page around it, so
          they're the same in the inline grid and the fullscreen one. */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-slate-200 bg-slate-50/80 flex-shrink-0">
        <button type="button" onClick={togglePin}
          title={pinned ? 'Unpin the room name' : 'Keep the room name on screen'}
          className={`${ctrlBtn} ${pinned
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-slate-200 text-slate-500 hover:bg-white'}`}>
          {pinned ? <Pin size={12} /> : <PinOff size={12} />}
          <span className="hidden sm:inline">{pinned ? 'Room pinned' : 'Room unpinned'}</span>
          <span className="sm:hidden">Room</span>
        </button>
        <button type="button" onClick={toggleDensity}
          title={density === 'compact' ? 'Taller rows — easier to tap' : 'Shorter rows — more on screen'}
          className={`${ctrlBtn} border-slate-200 text-slate-500 hover:bg-white`}>
          {density === 'compact' ? <Rows4 size={12} /> : <Rows3 size={12} />}
          <span className="hidden sm:inline">{density === 'compact' ? 'Compact' : 'Comfortable'}</span>
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-slate-400 tabular-nums">
          {rowCount} line{rowCount !== 1 ? 's' : ''}
          {cur ? <span className="text-amber-600 font-medium"> · row {cur.r + 1}</span> : null}
        </span>
      </div>

      <div ref={scrollRef}
        className={`ms-scroll ${fill ? 'flex-1 min-h-0' : ''}`}
        style={{
          ...(fill ? {} : { maxHeight: 'min(68vh, 620px)' }),
          ...(dragging ? { userSelect: 'none' } : {}),
        }}
        onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste}>
        <table className="border-separate border-spacing-0 w-full">
          <thead ref={theadRef}>
            <tr>
              <HCell min={NUM_W} width={NUM_W} stickyLeft={pinned ? 0 : undefined}>#</HCell>
              {cols.map((c, i) => (
                <HCell key={c.key}
                  min={pinned && i === 0 ? locW : c.min}
                  width={pinned && i === 0 ? locW : c.w}
                  highlight={c.highlight}
                  stickyLeft={pinned && i === 0 ? NUM_W : undefined}
                  pinEdge={pinned && i === 0}>
                  {c.label}
                </HCell>
              ))}
              {hasTakeoffLines && <HCell min={120}>Measure</HCell>}
              <HCell min={ACT_W} width={ACT_W} stickyRight={pinRight ? 0 : undefined} />
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <Row
                key={item.id}
                item={item} idx={idx} cols={cols} productTypes={productTypes} errors={errors}
                issues={limitIssues[item.id]}
                onOpenLimitDoc={onOpenLimitDoc}
                {...rowSel(idx)}
                hasTakeoffLines={hasTakeoffLines}
                sheetId={sheetId}
                canRemove={rowCount > 1}
                density={density}
                pinned={pinned}
                locW={locW}
                pinRight={pinRight}
                setLineItem={setLineItem}
                removeLineItem={removeLineItem}
                copyLineItem={copyLineItem}
                setLinePhotos={setLinePhotos}
                onConfirmMeasured={onConfirmMeasured}
                onRevertToPlan={onRevertToPlan}
                cellRefs={cellRefs}
                onCellMouseDown={onCellMouseDown}
                onCellFocus={onCellFocus}
                onHandleDown={stableHandleDown}
              />
            ))}
          </tbody>
        </table>
      </div>

      {addLineItem && (
        <button type="button" onClick={addLineItem}
          className="w-full flex items-center justify-center gap-1.5 border-t border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-500 hover:bg-amber-50 hover:text-amber-700 transition-colors flex-shrink-0">
          + Add line
        </button>
      )}

      {/* Keyboard hints are for a keyboard. They're also 28px of a 375px-tall
          landscape phone, which is most of a row — so a short viewport doesn't
          get them whatever its width. */}
      <div className="hidden sm:block [@media(max-height:560px)]:hidden border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-400 flex-shrink-0">
        Drag the corner handle to copy down · ⌘/Ctrl+D fill down · copy &amp; paste works with Excel ·
        Shift+click or Shift+↑↓ selects a range · Delete clears it
      </div>
    </div>
  );
}
