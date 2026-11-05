import { useEffect, useRef, useState } from 'react';
import { X, BookOpen } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getPricedItems, savePricedItem } from '../store/data';
import { describeLine } from '../lib/describeLine';
import { duplicateLibraryName, libraryItemFromQuoteLine } from '../lib/quoteBuilderItems';

export default function QuoteLibraryDialog({ line, productTypes, wording, onClose, onSaved }) {
  const dialog = useRef(null);
  const [name, setName] = useState(describeLine(line, productTypes, wording));
  const [category, setCategory] = useState(productTypes.find(p => p.id === line.productTypeId)?.name || 'Custom');
  const [itemCode, setItemCode] = useState('');
  const [error, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  const submit = e => {
    e.preventDefault();
    if (saving.current) return;
    try {
      if (duplicateLibraryName(getPricedItems(), name)) throw new Error('An item with this name is already in the Price Library. Use a different name for this new item.');
      const item = libraryItemFromQuoteLine(line, { id: uuidv4(), name, category, itemCode, productTypes });
      saving.current = true;
      savePricedItem(item);
      onSaved(item);
    } catch (err) { saving.current = false; setError(err.message); }
  };
  return <dialog ref={dialog} className="quote-library-dialog" onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="quote-library-title">
    <form onSubmit={submit} className="p-6 space-y-4">
      <div className="flex justify-between gap-4"><div><h2 id="quote-library-title" className="font-semibold text-lg">Save to Price Library</h2><p className="text-sm text-slate-500 mt-1">Create a reusable copy for future quotes.</p></div><button type="button" aria-label="Close library dialog" onClick={onClose}><X size={18}/></button></div>
      <label className="block text-sm">Item name<input autoFocus required value={name} onChange={e => setName(e.target.value)} className="quote-field mt-1"/></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Category<input value={category} onChange={e => setCategory(e.target.value)} className="quote-field mt-1"/></label><label className="block text-sm">Item code (optional)<input value={itemCode} onChange={e => setItemCode(e.target.value)} className="quote-field mt-1"/></label></div>
      {line.description && <p className="text-sm text-slate-600 whitespace-pre-wrap">{line.description}</p>}
      <dl className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded text-sm"><dt>Material cost / each</dt><dd>${Number(line.unitCostPrice || 0).toFixed(2)}</dd><dt>Labour / each</dt><dd>${Number(line.labourCost || 0).toFixed(2)}</dd><dt>Margin</dt><dd>{line.marginPercent || 0}%</dd><dt>Selling price / each</dt><dd>{line.manualSellPrice === '' || line.manualSellPrice == null ? 'Calculated from costs' : `$${Number(line.manualSellPrice).toFixed(2)}`}</dd>{Number(line.pricePerSqm) > 0 && <><dt>Price / m²</dt><dd>${Number(line.pricePerSqm).toFixed(2)}</dd></>}</dl>
      <p className="text-xs text-slate-500">Includes the description, supplier and base pricing. Quote discounts, quantities, measurements and private notes stay on this quote. Existing library items are unchanged.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="quote-secondary" onClick={onClose}>Cancel</button><button type="submit" className="quote-primary"><BookOpen size={14}/> Save to Price Library</button></div>
    </form>
  </dialog>;
}
