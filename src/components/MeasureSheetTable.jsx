import { Trash2 } from 'lucide-react';
import { getMsOptions } from '../store/data';

// Spreadsheet-style editor for measure-sheet line items. Edits the SAME sheet
// state (via setLineItem/removeLineItem) as the card layout, so the two stay in
// sync and validation still applies. Horizontally scrollable for narrow screens.
// Carries the FULL set of spec fields so nothing is missing versus card view.

const cellInput  = 'w-full bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none focus:bg-amber-50 rounded-sm';
const cellSelect = `${cellInput} appearance-none cursor-pointer pr-1`;

function Cell({ children, w, min }) {
  return <td className="border-r border-slate-100 align-middle" style={{ width: w, minWidth: min }}>{children}</td>;
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

const HEADERS = [
  '#', 'Location', 'Product', 'W', 'D', 'Qty', 'Fabric',
  'Control', 'Return', 'Motor Side', 'Fixing', 'Heading', 'Hem',
  'Track Colour', 'Bottom Rail Colour', 'Operation Type', 'Bottom Rail Type',
  'Chain Colour', 'Lining', 'Lining Fabric', 'Notes', '',
];

export default function MeasureSheetTable({ lineItems, setLineItem, removeLineItem, productTypes, errors = {} }) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="border-collapse" style={{ minWidth: 1900, width: '100%' }}>
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {HEADERS.map((h, i) => (
              <th key={i} className="border-r border-slate-100 px-2 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap">{h}</th>
            ))}
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
                <Cell min={130}>
                  <select value={item.productTypeId || ''}
                    onChange={e => {
                      const pt = productTypes.find(p => p.id === e.target.value);
                      setLineItem(idx, 'productTypeId', pt?.id || '');
                      setLineItem(idx, 'productNameSnapshot', pt?.name || '');
                    }}
                    className={`${cellSelect} ${prodErr ? 'ring-1 ring-red-300 rounded' : ''}`}>
                    <option value="">{item.productNameSnapshot || ''}</option>
                    {productTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Cell>
                <Cell w={64}><input type="number" inputMode="numeric" min="0" value={item.widthMm ?? ''} onChange={e => setLineItem(idx, 'widthMm', e.target.value)} className={`${cellInput} text-right`} /></Cell>
                <Cell w={64}><input type="number" inputMode="numeric" min="0" value={item.dropMm ?? ''} onChange={e => setLineItem(idx, 'dropMm', e.target.value)} className={`${cellInput} text-right`} /></Cell>
                <Cell w={52}><input type="number" inputMode="numeric" min="0" value={item.quantity ?? ''} onChange={e => setLineItem(idx, 'quantity', e.target.value)} className={`${cellInput} text-right`} /></Cell>
                <Cell min={140}><input value={item.fabricColour || ''} onChange={e => setLineItem(idx, 'fabricColour', e.target.value)} placeholder="Fabric / colour" className={cellInput} /></Cell>
                <Cell min={90}><Sel value={item.control} onChange={v => setLineItem(idx, 'control', v)} options={getMsOptions('control')} /></Cell>
                <Cell min={90}><Sel value={item.returnSide} onChange={v => setLineItem(idx, 'returnSide', v)} options={getMsOptions('returnSide')} /></Cell>
                <Cell min={100}><Sel value={item.motorSide} onChange={v => setLineItem(idx, 'motorSide', v)} options={getMsOptions('motorSide')} /></Cell>
                <Cell min={100}><Sel value={item.fixing} onChange={v => setLineItem(idx, 'fixing', v)} options={getMsOptions('fixing')} /></Cell>
                <Cell min={130}><Sel value={item.heading} onChange={v => setLineItem(idx, 'heading', v)} options={getMsOptions('heading')} /></Cell>
                <Cell min={100}><Sel value={item.hem} onChange={v => setLineItem(idx, 'hem', v)} options={getMsOptions('hem')} /></Cell>
                <Cell min={110}><Sel value={item.trackColour} onChange={v => setLineItem(idx, 'trackColour', v)} options={getMsOptions('trackColour')} /></Cell>
                <Cell min={130}><Sel value={item.baseBarColour} onChange={v => setLineItem(idx, 'baseBarColour', v)} options={getMsOptions('baseBarColour')} /></Cell>
                <Cell min={150}><Sel value={item.trackType} onChange={v => setLineItem(idx, 'trackType', v)} options={getMsOptions('operationType')} /></Cell>
                <Cell min={130}><Sel value={item.baseBarType} onChange={v => setLineItem(idx, 'baseBarType', v)} options={getMsOptions('baseBarType')} /></Cell>
                <Cell min={110}><Sel value={item.chainColour} onChange={v => setLineItem(idx, 'chainColour', v)} options={getMsOptions('chainColour')} /></Cell>
                <Cell min={80}>
                  <select value={item.attachedLining ? 'Yes' : 'No'} onChange={e => setLineItem(idx, 'attachedLining', e.target.value === 'Yes')}
                    className={cellSelect}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </Cell>
                <Cell min={140}><input value={item.liningFabricColour || ''} disabled={!item.attachedLining}
                  onChange={e => setLineItem(idx, 'liningFabricColour', e.target.value)}
                  placeholder={item.attachedLining ? 'Lining fabric' : '—'} className={`${cellInput} disabled:opacity-40`} /></Cell>
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
