import { useState } from 'react';
import QuoteGaps from './QuoteGaps';
import { getProductTypes, getMeasureSheet, saveMeasureSheet } from '../store/data';
import { flushPending } from '../store/db';
import { supabase } from '../lib/supabase';
import { sheetGaps, gapId, gapTotals } from '../lib/sheetGaps';
import { resolveMeasureEntry } from '../lib/measureMath';

const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

// Imported plan rows can name a product without carrying its library ID.
// Resolve that name for field selection only; never rewrite the saved product.
function productLines(items, types) {
  return items.map(item => {
    if (item.productTypeId) return item;
    const name = String(item.productNameSnapshot || item.productType || '').trim().toLowerCase();
    const type = types.find(p => String(p.name).trim().toLowerCase() === name);
    return { ...item, productTypeId: type?.id || `assistant-${name}` };
  });
}
function requirements(items, types, sheetId) {
  const normalized = productLines(items, types);
  const inferred = normalized.filter(i => !types.some(t => t.id === i.productTypeId)).map(i => ({
    id: i.productTypeId, name: i.productNameSnapshot || i.productType,
    slug: String(i.productNameSnapshot || i.productType || '').toLowerCase().replace(/\s+/g, '-'),
  }));
  const allTypes = [...types, ...inferred];
  // Supplier pricing does not require a second local fabric/making calculation.
  const base = sheetGaps(normalized, { productTypes: allTypes, measureSheetId: sheetId });
  return normalized.map((item, index) => {
    const gaps = (base.find(l => l.id === item.id)?.gaps || []).filter(g => !g.key.startsWith('calc:'));
    const add = (field, label, options) => {
      if (String(item[field] ?? '').trim()) return;
      gaps.push({ key: field, field, label, what: `Choose ${label.toLowerCase()}`, severity: 'order', editor: options ? 'select' : 'text', options });
    };
    if (/curtain/i.test(item.productNameSnapshot || item.productType || '')) {
      add('curtainLayers', 'Curtain layers', ['Sheer only', 'Blockout only', 'Separate sheer and blockout', 'Curtain with attached lining']);
      add('trackArrangement', 'Track arrangement', ['Single track', 'Double tracks with dual brackets', 'Two separate tracks', 'Existing track — fabric only']);
      if (/separate|attached/i.test(item.curtainLayers || '')) add('liningFabricColour', 'Blockout / lining fabric and colour');
    }
    if (/roman/i.test(item.productNameSnapshot || item.productType || '')) {
      add('liningRequirement', 'Roman lining', ['Unlined', 'Lined']);
      if (item.liningRequirement === 'Lined') add('liningFabricColour', 'Lining fabric and colour');
      add('supplier', 'Supplier', ['FHA', 'Other — specify in notes']);
    }
    return { id: item.id, index, item, gaps };
  }).filter(l => l.gaps.length);
}

export default function AssistantSheetGaps({ sheet, onSaved, onEditing }) {
  const [base, setBase] = useState(sheet);
  const [fills, setFills] = useState({});
  const [dismissed, setDismissed] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const types = getProductTypes();
  const items = base.lineItems || [];
  const gaps = requirements(items, types, base.id);
  const patched = items.map(i => ({ ...i, ...fills[i.id] }));
  const remaining = requirements(patched, types, base.id);
  // Keep existing rows in place while typing. Newly dependent fields appear below them.
  const lines = gaps.map(l => ({ ...l, gaps: [...l.gaps, ...(remaining.find(n => n.id === l.id)?.gaps || []).filter(g => !l.gaps.some(old => old.key === g.key))] }));
  const resolved = new Set();
  lines.forEach(l => l.gaps.forEach(g => {
    if (!remaining.find(n => n.id === l.id)?.gaps.some(n => n.key === g.key)) resolved.add(gapId(l.id, g.key));
  }));
  const totals = gapTotals(lines, dismissed, resolved);
  const changed = Object.keys(fills).length > 0 || dismissed.size > 0;
  const setFill = (id, field, value) => { setFills(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } })); setMessage(''); onEditing(true); };
  const dismiss = ids => { setDismissed(prev => new Set([...prev, ...ids])); onEditing(true); };
  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const latest = getMeasureSheet(base.id);
      if (Date.parse(latest?.updatedAt) > Date.parse(base.updatedAt)) throw new Error('This sheet changed elsewhere. Reload this page before saving your answers.');
      const remote = await supabase.from('measure_sheets').select('updated_at').eq('id', base.id).single();
      if (remote.error) throw new Error('The online sheet could not be checked. Check the connection before saving.');
      if (Date.parse(remote.data.updated_at) > Date.parse(base.updatedAt)) throw new Error('The online sheet changed elsewhere. Reload before saving your answers.');
      const next = patched.map(i => ({ ...i, quoteGapsDismissed: [...new Set([...(i.quoteGapsDismissed || []), ...[...dismissed].filter(k => k.startsWith(`${i.id}::`)).map(k => k.split('::')[1])])] }));
      const saved = saveMeasureSheet({ ...base, lineItems: next }, { baseUpdatedAt: base.updatedAt });
      if (saved?.__conflict) throw new Error('This sheet changed elsewhere. Reload before saving.');
      setBase(saved);
      await flushPending();
      const { data, error: dbError } = await supabase.from('measure_sheets').select('updated_at,line_items').eq('id', base.id).single();
      if (dbError || Date.parse(data?.updated_at) !== Date.parse(saved.updatedAt) || canonical(data.line_items) !== canonical(saved.lineItems)) {
        throw new Error('Your answers are saved on this Mac, but the online save is not confirmed yet. Check the connection and save again before continuing.');
      }
      setBase(saved); setFills({}); setDismissed(new Set());
      setMessage('Answers saved to the measure sheet. You can continue quoting when ready.');
      onEditing(false);
      onSaved({ ...saved, updatedAt: data.updated_at });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <section className="space-y-3">
    <p className="text-sm text-slate-600">Fill in the missing details below, just like creating a quote. Drops must be finished make sizes; plan ceiling heights still need track deductions and floor clearance confirmed. Dismissing a field does not approve an unknown supplier specification.</p>
    <QuoteGaps lines={lines} totals={totals} resolvedIds={resolved} dismissed={dismissed}
      answeredText="All answered. Save these answers to the measure sheet below."
      getValue={(id, field) => Object.hasOwn(fills[id] || {}, field) ? fills[id][field] : items.find(i => i.id === id)?.[field] ?? ''}
      onChange={setFill} onCommitMeasure={(id, field, raw) => { const n = resolveMeasureEntry(raw); setFill(id, field, n ? n.value : raw); }}
      onDismiss={id => dismiss([id])} onRestore={id => setDismissed(prev => { const next = new Set(prev); next.delete(id); return next; })}
      onDismissLine={id => dismiss(lines.find(l => l.id === id).gaps.map(g => gapId(id, g.key)))}
      onDismissAll={() => dismiss(lines.flatMap(l => l.gaps.map(g => gapId(l.id, g.key))))} productTypes={types} />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    <button type="button" disabled={saving || !changed} onClick={save} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving answers…' : 'Save answers to measure sheet'}</button>
  </section>;
}
