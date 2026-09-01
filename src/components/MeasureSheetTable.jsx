import { useState, useRef, useMemo, useCallback } from 'react';
import { Trash2, Copy } from 'lucide-react';
import { getMsOptions, MS_SPEC_FIELDS, getVisibleSpecKeys, makeProductSelectHandlers } from '../store/data';
import PricedItemPicker from './PricedItemPicker';
import CheckMeasureControl from './CheckMeasureControl';
import LinePhotos from './LinePhotos';

// Spreadsheet-style editor for measure-sheet line items. Edits the SAME sheet
// state (via setLineItem/removeLineItem) as the card layout, so the two stay in
// sync and validation still applies.
//
// Columns are PRUNED to only the specs the sheet's products actually use (union
// of each item's product-type specs, plus any spec that already holds a value),
// so a roller-blind-only sheet no longer carries curtain-only columns. That
// keeps the table narrow enough to avoid the old fixed 1900px sideways scroll.
//
// It behaves like a spreadsheet, because that's what people expect of a grid:
//   • click a cell to select it — the field stays live, so it's still one tap
//     then type, which is what matters on site
//   • shift+click / shift+↑↓ extends the selection
//   • drag the fill handle (bottom-right of the selection) to copy down or up
//   • ⌘/Ctrl+D fill down · ⌘/Ctrl+C copy · ⌘/Ctrl+V paste TSV straight out of
//     Excel (extra rows are appended rather than dropped)
//   • Delete clears a multi-cell selection · Enter/Tab/↑↓ move between cells

const cellInput  = 'w-full bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none focus:bg-amber-50 rounded-sm';
const cellSelect = `${cellInput} appearance-none cursor-pointer pr-1`;
const SEL_COLOR  = 'rgb(245 158 11)'; // amber-500 — the grid's selection outline

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

// Nearest ancestor that actually scrolls — the table sits in a page scroller
// inline, and in its own scroller when opened fullscreen.
const scrollerOf = (el) => {
  let n = el;
  while (n && n !== document.body) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
    n = n.parentElement;
  }
  return null;
};

function HCell({ children, min, highlight }) {
  return (
    <th style={{ minWidth: min }}
      className={`border-r border-slate-100 px-2 py-2 text-left text-xs font-semibold whitespace-nowrap ${
        highlight ? 'text-amber-700 bg-amber-50' : 'text-slate-500 font-medium'
      }`}>{children}</th>
  );
}

// A value filled or pasted in from another row may not be on this row's option
// list (different product type). Show it anyway rather than rendering a blank
// select — what you filled is what you get, same as a spreadsheet.
function Sel({ value, onChange, options }) {
  const extra = value && !options.includes(value) ? [value] : [];
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} className={cellSelect}>
      <option value=""></option>
      {[...options, ...extra].map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function MeasureSheetTable({
  lineItems, setLineItem, removeLineItem, productTypes, errors = {},
  onConfirmMeasured, onRevertToPlan, addLineItem, copyLineItem,
  // Photos deliberately sit OUTSIDE the `cols` grid model: fill-down, copy and
  // paste are all defined over text cells, and a photo is not something you
  // want dragged into the next four rows. It rides in the actions cell instead.
  sheetId = null, setLinePhotos = null,
}) {
  // Only worth a column when the sheet actually has plan-derived lines.
  const hasTakeoffLines = lineItems.some(li => li.source === 'takeoff');
  const ptFor = (item) => productTypes.find(p => p.id === item.productTypeId) || null;

  // Union of visible spec keys across all rows → the spec columns to render.
  const shown = new Set();
  lineItems.forEach(item => getVisibleSpecKeys(item, ptFor(item)).forEach(k => shown.add(k)));
  const specCols = MS_SPEC_FIELDS.filter(f => shown.has(f.key)); // canonical order
  const liningShown = shown.has('lining');
  const dropdownKeys = specCols.filter(f => f.key !== 'lining').map(f => f.key).join(',');

  // ── Column model ────────────────────────────────────────────────────────
  // One descriptor per selectable cell, in render order. Everything the grid
  // does — fill, copy, paste, navigation — works off this list, so a new
  // column is a one-line change instead of five.
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

  // ── Selection ───────────────────────────────────────────────────────────
  const [sel, setSel]       = useState(null); // {r, c, r2, c2} — r/c is the anchor
  const [fillRow, setFill]  = useState(null); // row the fill handle is hovering
  const [dragging, setDrag] = useState(false);
  const cellRefs  = useRef(new Map());
  const rootRef   = useRef(null);

  // A selection can outlive the rows it pointed at (someone deletes a line).
  // Clamped here at render rather than in an effect, so a stale selection never
  // costs a second render pass.
  const cur = sel && sel.r < rowCount && sel.r2 < rowCount && sel.c < colCount && sel.c2 < colCount ? sel : null;

  const focusCell = useCallback((r, c) => {
    const td = cellRefs.current.get(`${r}:${c}`);
    const el = td?.querySelector('input,select,button,textarea');
    if (el) {
      el.focus();
      if (el.tagName === 'INPUT' && typeof el.select === 'function') { try { el.select(); } catch { /* number inputs refuse */ } }
    }
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

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
  // the same as a mouse.
  const dragState = useRef({ block: null, row: null });
  const onHandleDown = (e) => {
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const block = norm(cur);
    dragState.current = { block, row: block.r2 };
    setDrag(true);
    setFill(block.r2);

    const scroller = scrollerOf(rootRef.current);
    const onMove = (ev) => {
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (ev.clientY > box.bottom - 40)   scroller.scrollTop += 16;
        else if (ev.clientY < box.top + 40) scroller.scrollTop -= 16;
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
  // These are plain functions, NOT components: a component declared inside the
  // render would get a fresh identity every pass, remounting every input and
  // losing focus on each keystroke.
  const n = cur ? norm(cur) : null;
  const inFillPreview = (r, c) => {
    if (fillRow === null || !n || c < n.c1 || c > n.c2) return false;
    return fillRow > n.r2 ? (r > n.r2 && r <= fillRow) : (r < n.r1 && r >= fillRow);
  };

  const control = (item, idx, col) => {
    if (col.type === 'product') {
      return (
        <div className="px-1">
          <PricedItemPicker
            value={item.productNameSnapshot}
            productTypes={productTypes}
            error={!!errors[`item_${idx}_productType`]}
            typesFirst
            placeholder="Select product type…"
            {...makeProductSelectHandlers(setLineItem, idx, productTypes)}
          />
        </div>
      );
    }
    if (col.type === 'select') {
      return <Sel value={item[col.field]} onChange={v => setLineItem(idx, col.field, v)}
        options={getMsOptions(col.optionKey, ptFor(item))} />;
    }
    if (col.type === 'bool') {
      return (
        <select value={item[col.field] ? 'Yes' : 'No'}
          onChange={e => setLineItem(idx, col.field, e.target.value === 'Yes')} className={cellSelect}>
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
          className={`${cellInput} no-spin text-right ${col.highlight ? 'font-semibold text-slate-900 bg-amber-50/50 focus:bg-amber-100' : ''}`} />
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
        className={`${cellInput} disabled:opacity-40 ${err ? 'ring-1 ring-red-300 rounded' : ''}`} />
    );
  };

  const gridCell = (item, r, c) => {
    const col      = cols[c];
    const selected = !!n && r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
    const anchor   = !!cur && cur.r === r && cur.c === c;
    const preview  = inFillPreview(r, c);
    const handle   = selected && r === n.r2 && c === n.c2 && !dragging;

    const shadow = [];
    if (selected) {
      if (r === n.r1) shadow.push(`inset 0 2px 0 0 ${SEL_COLOR}`);
      if (r === n.r2) shadow.push(`inset 0 -2px 0 0 ${SEL_COLOR}`);
      if (c === n.c1) shadow.push(`inset 2px 0 0 0 ${SEL_COLOR}`);
      if (c === n.c2) shadow.push(`inset -2px 0 0 0 ${SEL_COLOR}`);
    } else if (preview) {
      shadow.push('inset 0 0 0 1px rgb(245 158 11 / 0.5)');
    }

    return (
      <td key={col.key}
        ref={el => { if (el) cellRefs.current.set(`${r}:${c}`, el); else cellRefs.current.delete(`${r}:${c}`); }}
        className={`relative border-r border-slate-100 align-middle ${
          selected && !anchor ? 'bg-amber-50/50' : preview ? 'bg-amber-50/40' : ''
        }`}
        style={{ width: col.w, minWidth: col.min, boxShadow: shadow.join(', ') || undefined }}
        onMouseDown={e => { if (e.shiftKey) { e.preventDefault(); setSel(s => (s ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c })); } }}
        onFocusCapture={() => setSel(s => (s && s.r === r && s.c === c && s.r2 === r && s.c2 === c ? s : { r, c, r2: r, c2: c }))}
      >
        {control(item, r, col)}
        {handle && (
          <span onPointerDown={onHandleDown} title="Drag to copy down"
            className="absolute -bottom-1.5 -right-1.5 p-1.5 z-20 cursor-crosshair"
            style={{ touchAction: 'none' }}>
            <span className="block w-2.5 h-2.5 rounded-[2px] bg-amber-500 border border-white shadow-sm" />
          </span>
        )}
      </td>
    );
  };

  return (
    <div ref={rootRef} className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto" style={dragging ? { userSelect: 'none' } : undefined}
        onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste}>
        <table className="border-collapse w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <HCell min={34}>#</HCell>
              {cols.map(c => <HCell key={c.key} min={c.min} highlight={c.highlight}>{c.label}</HCell>)}
              {hasTakeoffLines && <HCell min={120}>Measure</HCell>}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lineItems.map((item, idx) => (
              <tr key={item.id} data-row={idx} className="hover:bg-slate-50/40">
                <td className="border-r border-slate-100 align-middle" style={{ minWidth: 34 }}>
                  <span className="px-2 text-xs text-slate-400 tabular-nums">{idx + 1}</span>
                </td>

                {cols.map((_, c) => gridCell(item, idx, c))}

                {hasTakeoffLines && (
                  <td className="border-r border-slate-100 align-middle" style={{ minWidth: 120 }}>
                    <div className="px-1.5">
                      <CheckMeasureControl item={item} compact
                        onConfirm={() => onConfirmMeasured?.(idx)}
                        onRevert={() => onRevertToPlan?.(idx)} />
                    </div>
                  </td>
                )}

                <td className="w-24 text-center whitespace-nowrap">
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
                  <button type="button" onClick={() => removeLineItem(idx)} disabled={lineItems.length <= 1} tabIndex={-1}
                    title="Remove line" className="text-slate-300 hover:text-red-500 disabled:opacity-30 p-1.5">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-400">
        Drag the corner handle to copy down · ⌘/Ctrl+D fill down · copy &amp; paste works with Excel ·
        Shift+click or Shift+↑↓ selects a range · Delete clears it
      </div>
    </div>
  );
}
