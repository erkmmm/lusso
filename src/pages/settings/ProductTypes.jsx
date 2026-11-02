// ─── Product types ────────────────────────────────────────────────────────────
// The types the measure sheet offers, the specs each one shows, and the
// per-type dropdown overrides. All of it goes to `product_types`, which syncs,
// so every edit here lands on the whole team's measure sheets.
import { useState } from 'react';
import {
  Tag, Plus, Save, X, Check, Edit3, ChevronUp, ChevronDown,
  ToggleLeft, ToggleRight, GripVertical,
} from 'lucide-react';
import { useDataRefresh } from '../../hooks/useDataRefresh';
import {
  getProductTypes, saveProductType, addProductType, reorderProductType,
  MS_SPEC_FIELDS, getTypeSpecKeys, getMsOptions,
} from '../../store/data';
import { OPTION_FAMILIES, familyMapFor, hasBuiltInFamilies } from '../../lib/optionFamilies';
import SettingsCard from './SettingsCard';

// ─── Spec order editor ────────────────────────────────────────────────────────
//
// The spec order used to be ignored: whatever you picked here was re-sorted
// into one global sequence, so a curtain and a roller blind were stuck with the
// same arrangement. The stored order is authoritative now, which only helps if
// it can actually be set — hence this.
//
// Drag to reorder, with up/down buttons alongside. The buttons are not a
// nicety: HTML5 drag-and-drop does not fire on touch, and this app is used on
// an iPad. Anyone on a tablet would otherwise be locked out of the feature.
function SpecOrderEditor({ specKeys, onReorder, onRemove, onAdd }) {
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  const labelOf = (k) => (MS_SPEC_FIELDS.find(f => f.key === k) || {}).label || k;
  const unused  = MS_SPEC_FIELDS.filter(f => !specKeys.includes(f.key));

  const move = (from, to) => {
    if (to < 0 || to >= specKeys.length || from === to) return;
    const next = [...specKeys];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onReorder(next);
  };

  const onDrop = (targetKey) => {
    const from = specKeys.indexOf(dragKey);
    const to   = specKeys.indexOf(targetKey);
    setDragKey(null); setOverKey(null);
    if (from >= 0 && to >= 0) move(from, to);
  };

  return (
    <div>
      {specKeys.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-1">No specs shown for this type yet — add one below.</p>
      ) : (
        <ul className="space-y-1">
          {specKeys.map((k, i) => (
            <li
              key={k}
              draggable
              onDragStart={() => setDragKey(k)}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              onDragOver={(e) => { e.preventDefault(); if (overKey !== k) setOverKey(k); }}
              onDrop={(e) => { e.preventDefault(); onDrop(k); }}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-white transition-colors ${
                dragKey === k ? 'opacity-40 border-amber-300'
                : overKey === k ? 'border-amber-400 bg-amber-50'
                : 'border-slate-200'
              }`}
            >
              <GripVertical size={13} className="text-slate-300 cursor-grab active:cursor-grabbing flex-shrink-0" />
              <span className="text-[11px] text-slate-400 tabular-nums w-4 flex-shrink-0">{i + 1}</span>
              <span className="text-xs font-medium text-slate-700 flex-1 min-w-0 truncate">{labelOf(k)}</span>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                  aria-label={`Move ${labelOf(k)} up`}
                  className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors p-0.5">
                  <ChevronUp size={13} />
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === specKeys.length - 1}
                  aria-label={`Move ${labelOf(k)} down`}
                  className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors p-0.5">
                  <ChevronDown size={13} />
                </button>
                <button type="button" onClick={() => onRemove(k)}
                  aria-label={`Remove ${labelOf(k)}`}
                  className="text-slate-300 hover:text-red-500 transition-colors p-0.5 ml-0.5">
                  <X size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unused.map(f => (
            <button key={f.key} type="button" onClick={() => onAdd(f.key)}
              className="text-xs font-medium px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-600 transition-colors flex items-center gap-1">
              <Plus size={11} /> {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Which operation type each measure-time option actually orders.
 *
 * "Battery" is what the customer says; `Li-ion Motor 2.0` is what the factory
 * needs, and which motor that is differs by product and changes as suppliers
 * do. Leaving this in code meant a motor change needed a deploy, so it lives
 * here next to the option lists it chooses from.
 *
 * A blank mapping is a real answer, not a missing one: on most roller blinds
 * "chain" is the absence of a motor, and the line should carry no operation
 * type rather than an invented one.
 */
function OptionFamilyEditor({ pt, onChange }) {
  const codes = getMsOptions('operationType', pt);
  const configured = hasBuiltInFamilies(pt) || !!pt?.options?.optionFamilies;
  const map = familyMapFor(pt);

  const save = (key, code) => {
    const next = { ...(pt.options?.optionFamilies || {}) };
    next[key] = code;
    saveProductType({ ...pt, options: { ...(pt.options || {}), optionFamilies: next } });
    onChange?.();
  };

  const enable = () => {
    saveProductType({ ...pt, options: { ...(pt.options || {}), optionFamilies: { ...map } } });
    onChange?.();
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-xs font-medium text-slate-500">Options offered at measure time</p>
      <p className="text-[11px] text-slate-400 mt-0.5">
        &ldquo;Add option&rdquo; on a measure-sheet line clones the opening and sets only the operation.
        These say what each one orders.
      </p>

      {!configured ? (
        <button
          onClick={enable}
          className="mt-2 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-amber-300 transition-colors"
        >
          Offer these on {pt.name}
        </button>
      ) : (
        <div className="mt-2 grid gap-2">
          {OPTION_FAMILIES.map(f => (
            <label key={f.key} className="flex items-center gap-3">
              <span className="w-20 flex-shrink-0 text-xs text-slate-600">{f.label}</span>
              <select
                value={map[f.key] || ''}
                onChange={e => save(f.key, e.target.value)}
                className="flex-1 min-w-0 text-xs rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700"
              >
                <option value="">No operation type</option>
                {codes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Per-product-type dropdown options ────────────────────────────────────────
// Lets each product type override a spec field's option list (e.g. a Roller
// Blind's Operation Types differ from a Curtain's). Shown inside the type's spec
// panel; only the dropdown specs the type actually uses are listed.
function TypeOptionEditor({ pt, onChange }) {
  const [openField, setOpenField] = useState(null);
  const [draft, setDraft] = useState('');

  const specKeys = getTypeSpecKeys(pt);
  const fields = MS_SPEC_FIELDS.filter(f => f.optionKey && specKeys.includes(f.key));
  if (fields.length === 0) return null;

  const save = (optionKey, list) => {
    const options = { ...(pt.options || {}) };
    if (list == null) delete options[optionKey]; // reset → fall back to the global default
    else options[optionKey] = list;
    saveProductType({ ...pt, options });
    onChange();
  };
  const addOpt = (f) => {
    const v = draft.trim();
    if (!v) return;
    const cur = getMsOptions(f.optionKey, pt);
    if (!cur.some(o => String(o).toLowerCase() === v.toLowerCase())) save(f.optionKey, [...cur, v]);
    setDraft('');
  };
  const removeOpt = (f, val) => save(f.optionKey, getMsOptions(f.optionKey, pt).filter(o => o !== val));

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="text-xs font-medium text-slate-500 mb-2">Dropdown options for {pt.name}</p>
      <div className="space-y-1.5">
        {fields.map(f => {
          const opts = getMsOptions(f.optionKey, pt);
          const isCustom = Array.isArray(pt.options?.[f.optionKey]);
          const open = openField === f.optionKey;
          return (
            <div key={f.key} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <button type="button" onClick={() => { setOpenField(open ? null : f.optionKey); setDraft(''); }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
                <span className="text-xs font-medium text-slate-600">{f.label}</span>
                <span className="text-[11px] text-slate-400">{opts.length} option{opts.length !== 1 ? 's' : ''}{isCustom ? ' · custom' : ''}</span>
              </button>
              {open && (
                <div className="px-3 pb-3 pt-1 bg-slate-50/50">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {opts.map(o => (
                      <span key={o} className="inline-flex items-center gap-1 text-xs bg-white border border-slate-200 text-slate-600 rounded-full pl-2.5 pr-1 py-1">
                        {o}
                        <button type="button" onClick={() => removeOpt(f, o)} className="text-slate-300 hover:text-red-500"><X size={11} /></button>
                      </span>
                    ))}
                    {opts.length === 0 && <span className="text-xs text-slate-400 italic">No options — add one below.</span>}
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <input value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOpt(f); } }}
                      placeholder={`Add ${f.label.toLowerCase()} option…`}
                      className="flex-1 border border-slate-200 rounded-lg text-xs px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <button type="button" onClick={() => addOpt(f)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-400">Add</button>
                    {isCustom && <button type="button" onClick={() => save(f.optionKey, null)} className="text-xs text-slate-400 hover:text-amber-600 px-1 whitespace-nowrap">Reset</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProductTypes() {
  useDataRefresh();
  const [productTypes, setProductTypes] = useState(getProductTypes);
  const [adding, setAdding]             = useState(false);
  const [newName, setNewName]           = useState('');
  const [editingId, setEditingId]       = useState(null);
  const [editName, setEditName]         = useState('');

  const refresh = () => setProductTypes(getProductTypes());

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addProductType(name);
    setNewName('');
    setAdding(false);
    refresh();
  };

  // One unified editor per type (name + specs + options). editingId tracks it.
  const openEdit  = (pt) => { setEditingId(pt.id); setEditName(pt.name); };
  const saveName  = (pt) => { const n = editName.trim(); if (n && n !== pt.name) saveProductType({ ...pt, name: n }); };
  const closeEdit = (pt) => { saveName(pt); setEditingId(null); refresh(); };

  const handleToggleActive = (pt) => {
    saveProductType({ ...pt, isActive: !pt.isActive });
    refresh();
  };

  const handleMove = (id, dir) => {
    reorderProductType(id, dir);
    refresh();
  };

  // Adding puts the spec at the end, where it is visible and can be dragged
  // into place. Order is stored data now, so this is a real position rather
  // than a value the canonical list was about to overwrite.
  const handleToggleSpec = (pt, key) => {
    const current = getTypeSpecKeys(pt);
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    saveProductType({ ...pt, specs: next });
    refresh();
  };
  const handleReorderSpecs = (pt, keys) => {
    saveProductType({ ...pt, specs: keys });
    refresh();
  };
  const handleResetSpecs = (pt) => {
    saveProductType({ ...pt, specs: null }); // null → falls back to the built-in default set
    refresh();
  };

  // sorted is maintained by getProductTypes (sorts by sortOrder)
  const sorted = productTypes; // already sorted

  return (
    <SettingsCard
      id="product-types"
      icon={Tag}
      title="Product types"
      description="Used in measure sheet product dropdowns. Disabled types no longer appear in new measure sheets but are preserved on existing records."
      scope="team"
      save={{ kind: 'auto' }}
      bodyClass=""
      actions={
        <button onClick={() => { setAdding(true); setNewName(''); }}
          className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 min-h-[36px] rounded-lg transition-colors">
          <Plus size={13} /> Add
        </button>
      }
    >
              {adding && (
                <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                  <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
                    placeholder="New product type name…"
                    className="flex-1 border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  <button onClick={handleAdd} className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-3 py-2 rounded-lg"><Save size={14} /></button>
                  <button onClick={() => setAdding(false)} className="text-slate-400 hover:text-slate-600 px-2 py-2"><X size={14} /></button>
                </div>
              )}
              <div className="divide-y divide-slate-50">
                {sorted.map((pt, idx) => {
                  const specKeys = getTypeSpecKeys(pt);
                  const isCustomSpecs = Array.isArray(pt.specs);
                  const isEditing = editingId === pt.id;
                  return (
                  <div key={pt.id} className={isEditing ? 'bg-amber-50/40' : (!pt.isActive ? 'bg-slate-50/60' : '')}>
                    <div className="flex items-center gap-3 px-5 py-3">
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button onClick={() => handleMove(pt.id, 'up')} disabled={idx === 0} aria-label={`Move ${pt.name} up`}
                          className="flex items-center justify-center min-h-[22px] min-w-[32px] text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ChevronUp size={14} /></button>
                        <button onClick={() => handleMove(pt.id, 'down')} disabled={idx === sorted.length - 1} aria-label={`Move ${pt.name} down`}
                          className="flex items-center justify-center min-h-[22px] min-w-[32px] text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ChevronDown size={14} /></button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${pt.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{pt.name}</span>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {specKeys.length} spec{specKeys.length !== 1 ? 's' : ''} on the measure sheet
                        </p>
                      </div>
                      {/* Enable / disable — a status toggle, distinct from editing */}
                      <button onClick={() => handleToggleActive(pt)} title={pt.isActive ? 'Disable' : 'Enable'}
                        className={`flex-shrink-0 p-3 -m-1 rounded transition-colors ${pt.isActive ? 'text-green-500 hover:text-red-400' : 'text-slate-300 hover:text-green-500'}`}>
                        {pt.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                      {/* ONE edit button — opens name + specs + options together */}
                      <button onClick={() => isEditing ? closeEdit(pt) : openEdit(pt)}
                        className={`flex-shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 min-h-[40px] rounded-lg border transition-colors ${
                          isEditing ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-400' : 'border-slate-200 text-slate-600 hover:border-amber-400 hover:text-amber-600'
                        }`}>
                        {isEditing ? <><Check size={14} /> Done</> : <><Edit3 size={14} /> Edit</>}
                      </button>
                    </div>

                    {isEditing && (
                      <div className="px-5 pb-4 pl-16 space-y-3">
                        {/* Rename */}
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Product type name</label>
                          <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                            onBlur={() => saveName(pt)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); closeEdit(pt); } }}
                            className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                        </div>

                        {/* Specs shown + per-spec dropdown options */}
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-slate-500">Specs shown on the measure sheet</p>
                            {isCustomSpecs && (
                              <button onClick={() => handleResetSpecs(pt)} className="text-xs text-slate-400 hover:text-amber-600 transition-colors">Reset to default</button>
                            )}
                          </div>
                          <SpecOrderEditor
                            specKeys={specKeys}
                            onReorder={(keys) => handleReorderSpecs(pt, keys)}
                            onRemove={(key) => handleToggleSpec(pt, key)}
                            onAdd={(key) => handleToggleSpec(pt, key)}
                          />
                          <p className="text-[11px] text-slate-400 mt-2">Shown in this order on the measure sheet card and table. Width, drop, quantity, fabric and notes always show. A spec that already holds a value stays visible even if switched off.</p>
                          <TypeOptionEditor pt={pt} onChange={refresh} />
                          <OptionFamilyEditor pt={pt} onChange={refresh} />
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
    </SettingsCard>
  );
}
