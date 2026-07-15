import { Trash2 } from 'lucide-react';
import { getMsOptions, MS_SPEC_FIELDS, getVisibleSpecKeys, makeProductSelectHandlers } from '../store/data';
import PricedItemPicker from './PricedItemPicker';

// Spreadsheet-style editor for measure-sheet line items. Edits the SAME sheet
// state (via setLineItem/removeLineItem) as the card layout, so the two stay in
// sync and validation still applies.
//
// Columns are PRUNED to only the specs the sheet's products actually use (union
// of each item's product-type specs, plus any spec that already holds a value),
// so a roller-blind-only sheet no longer carries curtain-only columns. That
// keeps the table narrow enough to avoid the old fixed 1900px sideways scroll.

const cellInput  = 'w-full bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none focus:bg-amber-50 rounded-sm';
const cellSelect = `${cellInput} appearance-none cursor-pointer pr-1`;

// Per-spec column min-widths (px) — mirrors the old fixed layout's sizing.
const SPEC_MIN = {
  control: 90, returnSide: 90, motorSide: 100, fixing: 100, heading: 130, hem: 100,
  trackColour: 110, baseBarColour: 130, operationType: 150, baseBarType: 130, chainColour: 110,
};

function Cell({ children, w, min }) {
  return <td className="border-r border-slate-100 align-middle" style={{ width: w, minWidth: min }}>{children}</td>;
}
function HCell({ children, min, highlight }) {
  return (
    <th style={{ minWidth: min }}
      className={`border-r border-slate-100 px-2 py-2 text-left text-xs font-semibold whitespace-nowrap ${
        highlight ? 'text-amber-700 bg-amber-50' : 'text-slate-500 font-medium'
      }`}>{children}</th>
  );
}
function Sel({ value, onChange, options, err }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      className={`${cellSelect} ${err ? 'ring-1 ring-red-300 rounded' : ''}`}>
      <option value=""></option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function MeasureSheetTable({ lineItems, setLineItem, removeLineItem, productTypes, errors = {} }) {
  const ptFor = (item) => productTypes.find(p => p.id === item.productTypeId) || null;

  // Union of visible spec keys across all rows → the spec columns to render.
  const shown = new Set();
  lineItems.forEach(item => getVisibleSpecKeys(item, ptFor(item)).forEach(k => shown.add(k)));
  const specCols = MS_SPEC_FIELDS.filter(f => shown.has(f.key)); // canonical order
  const liningShown = shown.has('lining');
  const dropdownCols = specCols.filter(f => f.key !== 'lining');

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="border-collapse w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <HCell min={34}>#</HCell>
            <HCell min={150}>Location</HCell>
            <HCell min={130}>Product</HCell>
            <HCell min={92} highlight>Width</HCell>
            <HCell min={92} highlight>Drop</HCell>
            <HCell min={56}>Qty</HCell>
            <HCell min={140}>Fabric</HCell>
            {dropdownCols.map(f => <HCell key={f.key} min={SPEC_MIN[f.key]}>{f.label}</HCell>)}
            {liningShown && <HCell min={80}>Lining</HCell>}
            {liningShown && <HCell min={140}>Lining Fabric</HCell>}
            <HCell min={150}>Notes</HCell>
            <th className="w-9" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lineItems.map((item, idx) => {
            const locErr  = !!errors[`item_${idx}_location`];
            const prodErr = !!errors[`item_${idx}_productType`];
            return (
              <tr key={item.id} className="hover:bg-slate-50/40">
                <Cell w={34}><span className="px-2 text-xs text-slate-400 tabular-nums">{idx + 1}</span></Cell>
                <Cell min={150}>
                  <input value={item.location || ''} onChange={e => setLineItem(idx, 'location', e.target.value)}
                    placeholder="Room" className={`${cellInput} ${locErr ? 'ring-1 ring-red-300 rounded' : ''}`} />
                </Cell>
                <Cell min={170}>
                  <div className="px-1">
                    <PricedItemPicker
                      value={item.productNameSnapshot}
                      productTypes={productTypes}
                      error={prodErr}
                      typesFirst
                      placeholder="Select product type…"
                      {...makeProductSelectHandlers(setLineItem, idx, productTypes)}
                    />
                  </div>
                </Cell>
                <Cell w={92} min={92}><input type="number" inputMode="numeric" min="0" value={item.widthMm ?? ''} onChange={e => setLineItem(idx, 'widthMm', e.target.value)} placeholder="mm" className={`${cellInput} text-right font-semibold text-slate-900 bg-amber-50/50 focus:bg-amber-100`} /></Cell>
                <Cell w={92} min={92}><input type="number" inputMode="numeric" min="0" value={item.dropMm ?? ''} onChange={e => setLineItem(idx, 'dropMm', e.target.value)} placeholder="mm" className={`${cellInput} text-right font-semibold text-slate-900 bg-amber-50/50 focus:bg-amber-100`} /></Cell>
                <Cell w={56} min={56}><input type="number" inputMode="numeric" min="0" value={item.quantity ?? ''} onChange={e => setLineItem(idx, 'quantity', e.target.value)} className={`${cellInput} text-right`} /></Cell>
                <Cell min={140}><input value={item.fabricColour || ''} onChange={e => setLineItem(idx, 'fabricColour', e.target.value)} placeholder="Fabric / colour" className={cellInput} /></Cell>

                {dropdownCols.map(f => (
                  <Cell key={f.key} min={SPEC_MIN[f.key]}>
                    <Sel value={item[f.itemField]} onChange={v => setLineItem(idx, f.itemField, v)} options={getMsOptions(f.optionKey)} />
                  </Cell>
                ))}

                {liningShown && (
                  <Cell min={80}>
                    <select value={item.attachedLining ? 'Yes' : 'No'} onChange={e => setLineItem(idx, 'attachedLining', e.target.value === 'Yes')}
                      className={cellSelect}>
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </Cell>
                )}
                {liningShown && (
                  <Cell min={140}><input value={item.liningFabricColour || ''} disabled={!item.attachedLining}
                    onChange={e => setLineItem(idx, 'liningFabricColour', e.target.value)}
                    placeholder={item.attachedLining ? 'Lining fabric' : '—'} className={`${cellInput} disabled:opacity-40`} /></Cell>
                )}

                <Cell min={150}><input value={item.notes || ''} onChange={e => setLineItem(idx, 'notes', e.target.value)} placeholder="Notes" className={cellInput} /></Cell>
                <td className="w-9 text-center">
                  <button type="button" onClick={() => removeLineItem(idx)} disabled={lineItems.length <= 1}
                    title="Remove line" className="text-slate-300 hover:text-red-500 disabled:opacity-30 p-1.5">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
