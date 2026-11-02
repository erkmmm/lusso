// ─── Quote wording ────────────────────────────────────────────────────────────
/**
 * How each operation / track type reads on a customer's quote.
 *
 * The quote used to say "Curtain", which is true and tells the customer
 * nothing — what they are buying is a wand operated reverse pleat sheer
 * curtain. The heading and fabric are already words; the operation is a trade
 * code (KAW, MKH, Oslo 84) that only means something in the workroom. This is
 * where those get their plain-English half.
 *
 * A code left blank is deliberately silent: the title simply omits the
 * operation rather than printing a guess.
 *
 * Both maps live inside the quote-settings blob (`operationWords`,
 * `fabricWords`), so they reach the public `business_settings` row the same way
 * the business details do — hence the "Shown to customers" badge. They are
 * already written one key at a time, which is the shape QuotePage.jsx had to be
 * reworked into; nothing to change here but the label.
 */
import { useState } from 'react';
import { Type, ArrowRight, Plus, X } from 'lucide-react';
import { useDataRefresh } from '../../hooks/useDataRefresh';
import {
  getProductTypes, getMsOptions,
  getOperationWords, setOperationWord, OPERATION_TYPE_OPTIONS,
  getFabricWords, setFabricWord,
} from '../../store/data';
import { toast } from '../../components/ToastContainer';
import SettingsCard from './SettingsCard';

/** One "code → what the customer reads" row, saved when you leave the field. */
function WordingRow({ label, value, onCommit, onRemove }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? value;
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); };
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <span className="text-sm font-medium text-slate-700 w-44 flex-shrink-0 break-words">{label}</span>
      <span className="text-slate-300 flex-shrink-0"><ArrowRight size={13} /></span>
      <input
        value={shown}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } }}
        placeholder="not shown on the quote"
        className="flex-1 min-w-[180px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove this word"
          className="text-slate-300 hover:text-red-500 flex-shrink-0 p-2 relative before:absolute before:content-[''] before:-inset-[7px]"><X size={14} /></button>
      )}
    </div>
  );
}

export default function QuoteWording() {
  useDataRefresh();
  const [ops, setOps] = useState(getOperationWords);
  const [fabrics, setFabrics] = useState(getFabricWords);
  const [newWord, setNewWord] = useState('');

  const keyOf = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

  // Everything the Operation Type dropdown can produce — the built-in list plus
  // anything added in Settings → Measure Sheet, and any per-product overrides,
  // so a code can never appear on a line without a row here to name it. Curtain
  // tracks and roller-blind motors both live in this one list.
  const productTypes = getProductTypes();
  const codes = [...new Set([
    ...OPERATION_TYPE_OPTIONS,
    ...getMsOptions('operationType'),
    ...productTypes.flatMap(pt => pt?.options?.operationType || []),
  ].map(c => String(c).trim()).filter(Boolean))];

  const saveOp = (code, phrase) => {
    setOperationWord(code, phrase);
    setOps(getOperationWords());
    toast('Wording saved.');
  };
  const saveFabric = (word, phrase) => {
    setFabricWord(word, phrase);
    setFabrics(getFabricWords());
    toast(phrase.trim() ? 'Wording saved.' : 'Word removed.', phrase.trim() ? 'success' : 'info');
  };
  const addFabric = () => {
    const w = keyOf(newWord);
    if (!w) return;
    if (fabrics[w]) { toast('That word is already listed.', 'info'); return; }
    setFabricWord(w, w);
    setFabrics(getFabricWords());
    setNewWord('');
    toast('Word added.');
  };

  const namedOps = codes.filter(c => (ops[keyOf(c)] || '').trim()).length;

  return (
    <>
      <SettingsCard
        id="operation-wording"
        icon={Type}
        title="Operation"
        description={<>
          What each operation type is called on the customer&rsquo;s quote — curtain tracks and
          roller-blind motors alike. &ldquo;KAW&rdquo; becomes &ldquo;wand operated&rdquo;, so the line reads
          <em> Wand operated reverse pleat sheer curtain</em> instead of just <em>Curtain</em>.
          Leave one blank to keep it off the quote entirely. {namedOps} of {codes.length} named.
        </>}
        scope="customers"
        save={{ kind: 'auto' }}
      >
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
          {codes.map(code => (
            <WordingRow key={code} label={code} value={ops[keyOf(code)] || ''}
              onCommit={v => saveOp(code, v)} />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        id="fabric-wording"
        icon={Type}
        title="Fabric type"
        description={<>
          Words to look for inside a fabric name, and what to call them. This is what carries a
          roller blind — its operation is usually blank, so &ldquo;Kleen screen ivory&rdquo; is the only
          thing on the line saying what the blind actually does. Matched anywhere in the name,
          longest match first.
        </>}
        scope="customers"
        save={{ kind: 'auto' }}
      >
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
          {Object.keys(fabrics).sort().map(word => (
            <WordingRow key={word} label={word} value={fabrics[word] || ''}
              onCommit={v => saveFabric(word, v)}
              onRemove={() => saveFabric(word, '')} />
          ))}
          {Object.keys(fabrics).length === 0 && (
            <p className="text-xs text-slate-400 p-3">No fabric words — nothing will be added to a product name.</p>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={newWord} onChange={e => setNewWord(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFabric(); } }}
            placeholder="e.g. silver screen"
            className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <button type="button" onClick={addFabric}
            className="flex items-center gap-1.5 text-sm font-medium px-3 min-h-[44px] rounded-lg bg-amber-500 hover:bg-amber-400 text-white flex-shrink-0">
            <Plus size={14} /> Add
          </button>
        </div>
      </SettingsCard>

      <p className="text-xs text-slate-400 px-1">
        Applies when a quote is saved. Lines whose product name was written by hand are left exactly as typed.
      </p>
    </>
  );
}
