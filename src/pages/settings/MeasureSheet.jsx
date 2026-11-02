// ─── Measure Sheet dropdown options ───────────────────────────────────────────
// Additions to the measure-sheet dropdowns — new track types and the like.
// Stored in `measure_sheet_options`, which syncs, so an addition shows up for
// the whole team. Distinct from Product types → Edit, which overrides a single
// type's list rather than adding to everyone's.
import { useState } from 'react';
import { ClipboardList, Plus, X, CheckSquare, Square } from 'lucide-react';
import { useDataRefresh } from '../../hooks/useDataRefresh';
import {
  MS_OPTION_FIELDS, getMsCustomOptions, addMsOption, deleteMsOption, setMsOptionScope,
  getActiveProductTypes, hasTypeOptionOverride,
} from '../../store/data';
import { toast } from '../../components/ToastContainer';
import SettingsCard from './SettingsCard';

export default function MeasureSheet() {
  useDataRefresh();
  const [drafts, setDrafts] = useState({});
  const [scopeFor, setScopeFor] = useState(null);   // option id whose picker is open
  const custom = getMsCustomOptions();
  const productTypes = getActiveProductTypes();

  const add = (fieldKey) => {
    const v = (drafts[fieldKey] || '').trim();
    if (!v) return;
    const row = addMsOption(fieldKey, v);   // [] = offered on every product type
    if (!row) { toast('That option already exists.', 'info'); return; }
    setDrafts(d => ({ ...d, [fieldKey]: '' }));
    toast('Option added.');
  };

  const toggleScope = (option, typeId) => {
    const ids = Array.isArray(option.productTypeIds) ? option.productTypeIds : [];
    const next = ids.includes(typeId) ? ids.filter(i => i !== typeId) : [...ids, typeId];
    setMsOptionScope(option.id, next);
  };

  const scopeLabel = (option) => {
    const ids = Array.isArray(option.productTypeIds) ? option.productTypeIds : [];
    if (!ids.length) return 'All products';
    const names = ids.map(i => productTypes.find(p => p.id === i)?.name).filter(Boolean);
    return names.length <= 2 ? names.join(', ') : `${names.length} products`;
  };

  return (
    <SettingsCard
      id="measure-sheet-options"
      icon={ClipboardList}
      title="Measure sheet options"
      description="Add options to the measure-sheet dropdowns (e.g. new track types). Built-in options stay. An addition is offered on every product by default — narrow it when it only belongs to some, like a curtain track."
      scope="team"
      save={{ kind: 'auto' }}
    >
      <div className="space-y-4">
        {MS_OPTION_FIELDS.map(f => {
          const mine = custom.filter(o => o.field === f.key);
          return (
            <div key={f.key} className="border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-700 mb-2">{f.label}</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {f.defaults.map(v => (
                  <span key={v} className="text-xs bg-slate-100 text-slate-500 rounded-full px-2.5 py-1">{v}</span>
                ))}
                {mine.map(o => (
                  <span key={o.id} className="relative text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full pl-2.5 pr-1 py-1 flex items-center gap-1">
                    {o.value}
                    {/* Which products offer it. A product type whose own option
                        list overrides this field (Curtain and Roller Blind both
                        override Operation Type) still shows the addition —
                        scoping is how you keep a curtain track off a blind. */}
                    <button type="button" onClick={() => setScopeFor(scopeFor === o.id ? null : o.id)}
                      title="Choose which products offer this option"
                      className="text-[10px] font-medium text-amber-600/80 hover:text-amber-800 underline decoration-dotted underline-offset-2">
                      {scopeLabel(o)}
                    </button>
                    <button type="button" onClick={() => { deleteMsOption(o.id); toast('Option removed.', 'info'); }}
                      title="Remove option" className="text-amber-400 hover:text-red-500 relative before:absolute before:content-[''] before:-inset-[16px]"><X size={12} /></button>

                    {scopeFor === o.id && (
                      <>
                        <span className="fixed inset-0 z-30" role="presentation" onClick={() => setScopeFor(null)} />
                        <div className="absolute z-40 top-full left-0 mt-1 w-56 bg-white rounded-xl border border-slate-200 shadow-xl p-2 text-slate-700">
                          <p className="px-2 py-1 text-[11px] text-slate-400">Offered on</p>
                          <button type="button"
                            onClick={() => { setMsOptionScope(o.id, []); setScopeFor(null); }}
                            className={`w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-slate-50 ${
                              !(o.productTypeIds || []).length ? 'font-semibold text-amber-700' : ''
                            }`}>
                            All products
                          </button>
                          <div className="max-h-48 overflow-y-auto mt-1 border-t border-slate-100 pt-1">
                            {productTypes.map(pt => {
                              const on = (o.productTypeIds || []).includes(pt.id);
                              return (
                                <button key={pt.id} type="button"
                                  onClick={() => toggleScope(o, pt.id)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-slate-50">
                                  {on ? <CheckSquare size={13} className="text-amber-500 flex-shrink-0" />
                                      : <Square size={13} className="text-slate-300 flex-shrink-0" />}
                                  <span className="truncate">{pt.name}</span>
                                  {hasTypeOptionOverride(pt, f.key) && (
                                    <span className="ml-auto text-[9px] text-slate-400 flex-shrink-0">own list</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </span>
                ))}
                {f.defaults.length === 0 && mine.length === 0 && <span className="text-xs text-slate-400">No options yet.</span>}
              </div>
              <div className="flex gap-2">
                <input value={drafts[f.key] || ''} onChange={e => setDrafts(d => ({ ...d, [f.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(f.key); } }}
                  placeholder={`Add a ${f.label.toLowerCase()} option`}
                  className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button type="button" onClick={() => add(f.key)}
                  className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white flex-shrink-0">
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}
