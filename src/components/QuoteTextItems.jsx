import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { moveQuoteText } from '../lib/quoteBuilderItems';

export function QuoteTextItems({ items = [], onChange }) {
  const patch = (id, field, value) => onChange(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  return <div className="quote-text-items space-y-5">
    {items.map((item, index) => <section key={item.id} className="quote-text-block">
      <div className="flex justify-end gap-1 mb-2">
        <span className="text-xs text-slate-500 mr-auto">Shown below “Your options” on the customer quote</span>
        <button type="button" className="quote-icon" disabled={index === 0} aria-label="Move text item up" onClick={() => onChange(moveQuoteText(items, item.id, -1))}><ArrowUp size={14}/></button>
        <button type="button" className="quote-icon" disabled={index === items.length - 1} aria-label="Move text item down" onClick={() => onChange(moveQuoteText(items, item.id, 1))}><ArrowDown size={14}/></button>
        <button type="button" className="quote-icon" aria-label="Delete text item" onClick={() => onChange(items.filter(t => t.id !== item.id))}><Trash2 size={14}/></button>
      </div>
      <input className="quote-text-heading" aria-label="Text item heading" placeholder="Text heading" value={item.heading || ''} onChange={e => patch(item.id, 'heading', e.target.value)}/>
      <textarea className="quote-text-body" aria-label="Text item description" placeholder="Description, ordering instructions or additional information…" rows={3} value={item.body || ''} onChange={e => patch(item.id, 'body', e.target.value)}/>
    </section>)}
  </div>;
}

export function AddQuoteText({ items = [], onChange }) {
  return <button type="button" className="quote-secondary" onClick={() => onChange([...items, { id: uuidv4(), heading: '', body: '' }])}><Plus size={13}/> Text Item</button>;
}
