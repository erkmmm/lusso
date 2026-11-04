import {OPERATION_REQUESTS} from '../lib/openingWorkflow';
import {useState} from 'react';
import {Plus,Trash2,ChevronDown,ChevronUp,Copy,Tag,GitBranch,Check} from 'lucide-react';
import {getMsOptions,MS_SPEC_FIELDS,getVisibleSpecKeys,makeProductSelectHandlers,isPlanEstimate} from '../store/data';
import {OPTION_FAMILIES,familyOfLine,hasBuiltInFamilies} from '../lib/optionFamilies';
import {isRollerBlindItem} from '../lib/buzExport';
import CheckMeasureControl from './CheckMeasureControl';
import PricedItemPicker from './PricedItemPicker';
import LinePhotos from './LinePhotos';
import LineLimitWarnings from './LineLimitWarnings';
const inp = () => 'w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400';
function SpecSelect({ label, value, onChange, options }) {
  value = value ?? '';
  options = [...new Set([...options,...(value && !options.includes(value) && !options.includes('Other') ? [value] : [])])];
  const hasOther  = options.includes('Other');
  const nonOther  = options.filter(o => o !== 'Other');
  const showInput = hasOther && (value === 'Other' || (value !== '' && !nonOther.includes(value)));
  const selectVal = showInput ? 'Other' : (value || '');
  const inputVal  = value === 'Other' ? '' : (showInput ? value : '');
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select aria-label={label} value={selectVal} onChange={e => onChange(e.target.value === 'Other' ? 'Other' : e.target.value)}
        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {showInput && (
        <input autoFocus value={inputVal} onChange={e => onChange(e.target.value)}
          placeholder="Type custom value…"
          className="mt-1.5 w-full border border-amber-300 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
      )}
    </div>
  );
}

// Renders one spec dropdown by its schema key (skips the special 'lining' key,
// which is rendered by LiningBlock). Keeps the item field ↔ option list wiring
// in one place (e.g. Operation Type stores to `trackType`).
// The collapsed form of a line item — what you see when you're reading the
// sheet rather than filling one opening in. It has to answer the two questions
// you actually have while scrolling ("which room is this?" and "what did I put
// down?") without being opened, because opening twenty cards to find line 6 is
// the problem it exists to solve.
//
// An unfinished line says so. On a twenty-line sheet the gap you left in the
// back bedroom is invisible until the order bounces, so a line missing a room,
// a product or a size carries a dot here.
/**
 * "Add option" — the question the customer asks while you are at the window.
 *
 * Offers the ways this product can be operated that the line is not already
 * quoted as. Ticking one or more clones the opening per family and sets only
 * the operation on each, so the measure sheet carries the choice instead of
 * someone having to remember it and rebuild it at quoting time.
 *
 * Hidden on products nothing is configured for — a "Battery" alternative on a
 * shutter is a line the factory cannot make.
 */
function OptionFamilyPicker({ item, productType, onAdd }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState([]);

  const configured = hasBuiltInFamilies(productType) || !!productType?.options?.optionFamilies;
  const current = familyOfLine(item, productType);
  const offerable = OPTION_FAMILIES.filter(f => f.key !== current);

  if (!productType || !configured || !offerable.length) return null;

  const toggle = (key) => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]));
  const confirm = () => { onAdd(picked); setPicked([]); setOpen(false); };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Offer this opening operated another way — the customer picks one"
        className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors ${
          open ? 'bg-slate-900 text-white border-slate-900' : 'text-slate-500 border-slate-200 hover:bg-slate-50'
        }`}
      >
        <Plus size={13} /> Add option
      </button>

      {open && (
        <>
          {/* Tapping anywhere else puts it away — on a phone, held one-handed
              at a window, there is no spare corner to aim at. */}
          <div className="fixed inset-0 z-20" onClick={() => { setPicked([]); setOpen(false); }} />
          <div className="absolute left-0 z-30 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
            <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Also quote this window as
            </p>
            {offerable.map((f) => {
              const on = picked.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggle(f.key)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left hover:bg-slate-50"
                >
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                    on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
                  }`}>
                    {on && <Check size={11} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-slate-700">{f.label}</span>
                    <span className="block text-[11px] text-slate-400">{f.hint}</span>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              disabled={!picked.length}
              onClick={confirm}
              className="mt-1.5 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-200 disabled:text-slate-400"
            >
              {picked.length
                ? `Add ${picked.length} option${picked.length > 1 ? 's' : ''}`
                : 'Choose at least one'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LineSummary({ item, idx, open, issues, onToggle }) {
  const size = item.widthMm && item.dropMm
    ? `${item.widthMm} × ${item.dropMm}`
    : item.widthMm || item.dropMm
      ? `${item.widthMm || '—'} × ${item.dropMm || '—'}`
      : null;
  // A roller with no roll direction is as unfinished as one with no width:
  // the factory cannot make it either way, and the gap is invisible once the
  // card is closed.
  const incomplete = !item.location || !item.productTypeId || !item.widthMm || !item.dropMm
    || (isRollerBlindItem(item) && !item.heading);
  const worst = issues?.some(r => r.severity === 'error') ? 'error'
    : issues?.length ? 'warning' : null;

  return (
    // rounded-[inherit] because the card above cannot clip: an overflow-hidden
    // ancestor would become the scroll container for the open card's sticky
    // title bar and silently kill it, so corners are rounded on the children
    // instead. This row had no rounding at all, so its hover and selected fills
    // painted square corners out past the card's rounded ones — most visible at
    // the top-left, right behind the number badge. Inheriting matches both
    // states for free: all four corners when collapsed (parent is the
    // rounded-xl card), top two only when open (parent is rounded-t-xl).
    <button type="button" onClick={onToggle}
      aria-expanded={open}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-amber-50/60 transition-colors rounded-[inherit]">
      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
        open ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'
      }`}>{idx + 1}</span>

      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`text-sm font-semibold truncate ${item.location ? 'text-slate-800' : 'text-slate-300 italic font-normal'}`}>
            {item.location || 'No room yet'}
          </span>
          {worst && (
            <span title={worst === 'error' ? 'Outside what the supplier will make' : 'Close to the supplier limit'}
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${worst === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
          )}
          {!worst && incomplete && (
            <span title="This line is not finished" className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
          )}
          {item.isOptional && (
            <span title="Quoted as an optional extra"
              className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-px">
              Optional
            </span>
          )}
          {item.choiceGroupId && (
            <span title={`One of the alternatives for "${item.choiceGroupId}" — the customer picks one`}
              className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-purple-700 bg-purple-100 border border-purple-200 rounded px-1.5 py-px">
              Choice
            </span>
          )}
        </span>
        <span className="block text-xs text-slate-400 truncate">
          {[item.productNameSnapshot, item.fabricColour].filter(Boolean).join(' · ') || 'No product yet'}
        </span>
      </span>

      <span className="flex-shrink-0 text-right">
        <span className={`block text-sm tabular-nums ${size ? 'text-slate-700 font-medium' : 'text-slate-300'}`}>
          {size || 'no size'}
        </span>
        {Number(item.quantity) > 1 && <span className="block text-xs text-slate-400">× {item.quantity}</span>}
      </span>

      {/* A static chip, NOT CheckMeasureControl: that renders a confirm BUTTON,
          and a button inside this button is both invalid markup and a dead
          click. Confirming still happens on the open card, where the real
          control lives. */}
      {item.source === 'takeoff' && (
        <span className={`flex-shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
          isPlanEstimate(item)
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {isPlanEstimate(item) ? 'Plan' : 'Measured'}
        </span>
      )}
      {open
        ? <ChevronUp size={15} className="text-slate-400 flex-shrink-0" />
        : <ChevronDown size={15} className="text-slate-300 flex-shrink-0" />}
    </button>
  );
}

function SpecField({ specKey, item, idx, setLineItem, productType }) {
  const f = MS_SPEC_FIELDS.find(s => s.key === specKey);
  if (!f || f.key === 'lining') return null;
  return (
    <SpecSelect label={f.label} value={item[f.itemField]}
      onChange={v => setLineItem(idx, f.itemField, v)}
      options={getMsOptions(f.optionKey, productType)} />
  );
}

/**
 * None, attached, or separate — and they cost differently.
 *
 * Attached lining is sewn to the curtain: one curtain, one track, nothing
 * extra to hang. Separate lining is its own curtain on its own track, so it
 * carries a track and extra fitting, and it can be made to a different
 * heading on a different track from the face fabric. Recording both as one
 * "Enabled" was costing the separate ones at the attached price.
 *
 * `attachedLining` stays in step with the choice because the line description,
 * the purchase order and the grid all still read it as "is there a lining".
 */
const LINING_MODES = [
  ['',         'None'],
  ['attached', 'Attached'],
  ['separate', 'Separate'],
];

function LiningBlock({ item, idx, setLineItem, productType }) {
  // Lines measured before separate lining existed only carry the boolean, and
  // a boolean has always meant attached.
  const mode = item.liningMode ?? (item.curtainLayers==='Separate sheer and blockout'?'separate':item.curtainLayers==='Curtain with attached lining' || item.attachedLining?'attached':'');

  const setMode = (next) => {
    setLineItem(idx, 'curtainLayers', next==='separate'?'Separate sheer and blockout':next==='attached'?'Curtain with attached lining':(/separate|attached/i.test(item.curtainLayers || '')?'':item.curtainLayers || ''));
    setLineItem(idx, 'liningMode', next);
    setLineItem(idx, 'attachedLining', next !== '');
    if (next !== 'separate') {
      // Its own heading and track mean nothing once it is sewn on, and left
      // behind they would price a lining track that is not being fitted.
      setLineItem(idx, 'liningHeading', '');
      setLineItem(idx, 'liningTrackType', '');
    }
  };

  return (
    <>
      <div className="sm:col-span-3">
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Lining</label>
        <div className="flex gap-2">
          {LINING_MODES.map(([val, label]) => (
            <button key={val || 'none'} type="button" onClick={() => setMode(val)}
              className={`flex-1 max-w-[120px] text-xs font-medium py-1.5 rounded-lg border transition-colors ${
                mode === val ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'separate' && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            Hung on its own track — adds a track and extra fitting.
          </p>
        )}
      </div>

      {mode !== '' && (
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-slate-500 mb-1">Lining Fabric / Colour</label>
          <input value={item.liningFabricColour || ''}
            onChange={e => setLineItem(idx, 'liningFabricColour', e.target.value)}
            placeholder="e.g. Blockout White" className={inp()} />
        </div>
      )}

      {mode === 'separate' && (
        <>
          <div className="sm:col-span-3">
            {/* No default. An attached lining is made the same way every time
                and can fall back to the rate card; a separate one is a curtain
                in its own right, so it is asked for rather than assumed. */}
            <label className="block text-xs font-medium text-slate-500 mb-1">Lining Heading</label>
            <select value={item.liningHeading || ''}
              onChange={e => setLineItem(idx, 'liningHeading', e.target.value)}
              className={inp()}>
              <option value="">Select…</option>
              {getMsOptions('heading', productType).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-slate-500 mb-1">Lining Track</label>
            <select value={item.liningTrackType || ''}
              onChange={e => setLineItem(idx, 'liningTrackType', e.target.value)}
              className={inp()}>
              <option value="">Select…</option>
              {getMsOptions('operationType', productType).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </>
      )}
    </>
  );
}

function specSummary(item, productType) {
  const set = [];
  for (const key of getVisibleSpecKeys(item, productType)) {
    if (key === 'lining') { if (item.attachedLining) set.push('Lined'); continue; }
    const f = MS_SPEC_FIELDS.find(x => x.key === key);
    const v = f && String(item[f.itemField] || '').trim();
    if (v) set.push(v);
  }
  if (!set.length) return '';
  return set.length > 3 ? `${set.slice(0, 3).join(' · ')} · +${set.length - 3}` : set.join(' · ');
}


export default function MeasureSheetOpeningCard({item,idx,productTypes,errors={},isExpanded,otherOpen,cardOpen,nextItem,sheetId,lineCount,limitIssues={},setLimitDocId,setLineItem:writeLineItem,commitMeasure,confirmLineMeasured,revertLineToPlan,toggleCard,toggleItemExpand,toggleOtherSpecs,addAlternative,addOptionFamilies,copyLineItem,setLinePhotos,confirmDelete,setConfirmDelete,removeLineItem,openOnly,addLineItem,children}) {
  const setLineItem=(index,key,value)=>{
    writeLineItem(index,key,value);
    if(key==='curtainLayers') {
      const mode=value==='Separate sheer and blockout'?'separate':value==='Curtain with attached lining'?'attached':'';
      writeLineItem(index,'liningMode',mode);
      writeLineItem(index,'attachedLining',Boolean(mode));
      if(mode!=='separate') {writeLineItem(index,'liningHeading','');writeLineItem(index,'liningTrackType','');}
    }
  };
              const productType = productTypes.find(p => p.id === item.productTypeId) || null;
              const visibleSpecs = getVisibleSpecKeys(item, productType);
              const dropdownSpecs = visibleSpecs.filter(k => k !== 'lining');
              const liningVisible = visibleSpecs.includes('lining');
              const hiddenSpecs   = MS_SPEC_FIELDS.filter(f => !visibleSpecs.includes(f.key));
return (
                /* NOT overflow-hidden: the header below is sticky, and an
                   overflow-hidden ancestor becomes its scroll container, which
                   silently kills the stickiness. Corners are rounded on the
                   children instead. */
                <div key={item.id} data-line-card={item.id}
                  className={`border rounded-xl bg-white scroll-mt-2 ${
                    cardOpen ? 'border-amber-300 shadow-sm' : 'border-slate-200'
                  }`}>
                  {/* Collapsed: the whole card is this one row. */}
                  {!cardOpen && (
                    <LineSummary item={item} idx={idx} open={false}
                      issues={limitIssues[item.id]} onToggle={() => toggleCard(item.id)} />
                  )}

                  {cardOpen && <div className="opening-content-enter">
                  {/* Open: the summary becomes a sticky title bar, so however
                      far you scroll into this opening's fields you can still
                      see which room you're in — the thing that was missing. */}
                  <div className="sticky top-0 z-20 bg-amber-50/95 backdrop-blur-sm border-b border-amber-200 rounded-t-xl">
                    <LineSummary item={item} idx={idx} open
                      issues={limitIssues[item.id]} onToggle={() => toggleCard(item.id)} />
                  </div>

                  {/* Item header. The row actions used to share this flex row
                      with the fields and squeezed Location to 205px inside a
                      343px card; they sit under the fields now, so both inputs
                      get the full width on a phone. */}
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Location *</label>
                        <input aria-label="Location" value={item.location || ''} onChange={e => setLineItem(idx, 'location', e.target.value)}
                          placeholder="e.g. Master Bedroom — or Bed 2 A, Bed 2 B"
                          className={inp() + (errors[`item_${idx}_location`] ? ' border-red-300 ring-1 ring-red-300' : '')} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Product *</label>
                        <PricedItemPicker
                          value={item.productNameSnapshot}
                          productTypes={productTypes}
                          error={!!errors[`item_${idx}_productType`]}
                          typesFirst
                          placeholder="Select product type…"
                          {...makeProductSelectHandlers(setLineItem, idx, productTypes)}
                        />
                      </div>
                    </div>
                    {/* Clear of the fields above, not tucked under them: this
                        row used to carry a negative top margin and a 4px gap,
                        which read as the buttons being part of the Location
                        input rather than actions on the whole line. Wraps on a
                        phone instead of squeezing. */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <CheckMeasureControl
                        item={item}
                        onConfirm={() => confirmLineMeasured(idx)}
                        onRevert={() => revertLineToPlan(idx)}
                      />
                      {/* Marked on site, where the customer asks the question.
                          The alternative is remembering at quoting time which
                          openings were "just price it up for me". */}
                      <button
                        type="button"
                        onClick={() => setLineItem(idx, 'isOptional', !item.isOptional)}
                        aria-pressed={!!item.isOptional}
                        title={item.isOptional
                          ? 'Quoted as an optional extra — tap to make it part of the job'
                          : 'Part of the job — tap to quote it as an optional extra'}
                        className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors ${
                          item.isOptional
                            ? 'bg-amber-100 text-amber-700 border-amber-300'
                            : 'text-slate-500 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Tag size={13} /> Optional
                      </button>
                      {/* The alternative is created from this line rather than
                          added blank, so the opening's room and size come with
                          it and only the decision is left to fill in. */}
                      {addAlternative && <button
                        type="button"
                        onClick={() => addAlternative(idx)}
                        title="Offer a second product for this opening — the customer picks one"
                        className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border text-slate-500 border-slate-200 hover:bg-slate-50 transition-colors"
                      >
                        <GitBranch size={13} /> Alternative
                      </button>}
                      {/* The motorisation version of the button above it: same
                          idea, but it knows what it is cloning, so nothing has
                          to be re-picked afterwards. */}
                      {addOptionFamilies && <OptionFamilyPicker
                        item={item}
                        productType={productType}
                        onAdd={(keys) => addOptionFamilies(idx, keys)}
                      />}
                      <span className="flex-1" />
                      {/* Delete used to sit here, one icon away from Copy and
                          the same size and colour — a mis-tap on a phone threw
                          away an opening that had just been measured. It lives
                          at the foot of the card now, apart from everything
                          that is safe to tap twice. */}
                      {copyLineItem && <button onClick={() => copyLineItem(idx)}
                        className="text-slate-300 hover:text-amber-500 transition-colors p-1.5 rounded" title="Copy to next window">
                        <Copy size={14} />
                      </button>}
                    </div>
                  </div>

                  {/* Core fields — Width & Drop get their own prominent row with
                      large touch targets + numeric keyboards for on-site use. */}
                  <div className="px-4 pt-3 pb-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {[['widthMm', 'Width', '1800'], ['dropMm', 'Drop', '2400']].map(([field, label, eg]) => {
                        const working = item[`${field}Expr`];
                        const typed   = String(item[field] ?? '');
                        const notANumber = typed !== '' && !Number.isFinite(Number(typed));
                        return (
                        <div key={field}>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            {label} <span className="font-normal text-slate-400">mm</span>
                          </label>
                          {/* Text, not number: a number input silently discards
                              "1200+50" before it ever reaches us. The full
                              keyboard is the cost of being able to type a sum
                              over a tape measure. */}
                          <input aria-label={`${label} (mm)`} type="text" value={item[field] ?? ''}
                            onChange={e => setLineItem(idx, field, e.target.value)} placeholder={eg}
                            onFocus={e => e.target.select()}
                            onBlur={e => commitMeasure(idx, field, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            className="w-full border border-slate-200 rounded-xl text-2xl font-semibold text-slate-900 px-2 py-3.5 bg-white text-center tabular-nums no-spin placeholder:text-slate-300 placeholder:font-normal placeholder:text-lg focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200" />
                          {notANumber ? (
                            <p className="mt-1 text-center text-[11px] text-red-500">Not a number</p>
                          ) : working ? (
                            <p className="mt-1 text-center text-[11px] text-slate-400 tabular-nums">{working}</p>
                          ) : null}
                        </div>
                        );
                      })}
                    </div>
                    {/* Qty is 1 on almost every opening and fabric is typed by
                        hand, so the space goes to fabric. */}
                    <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Qty</label>
                        <input aria-label="Qty" type="number" inputMode="numeric" min="1" value={item.quantity ?? 1}
                          onFocus={e => e.target.select()}
                          onChange={e => setLineItem(idx, 'quantity', e.target.value)}
                          className={inp() + ' text-center tabular-nums no-spin'} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Fabric / Colour</label>
                        <input aria-label="Fabric / Colour" value={item.fabricColour || ''}
                          onChange={e => setLineItem(idx, 'fabricColour', e.target.value)} placeholder="e.g. Arctic White" className={inp()} />
                      </div>
                    </div>

                    {/* Roll direction decides which way the fabric comes off
                        the tube — whether it hangs against the glass or clears
                        a handle — and it is not something anyone can work out
                        later from the sheet. It was a dropdown among a dozen
                        others behind "Add specifications", which is why lines
                        reached the factory without it. On a roller it is a
                        question the card asks out loud. */}
                    {isRollerBlindItem(item) && (() => {
                      const rolls = getMsOptions('heading', productType).filter(o => /roll/i.test(o));
                      const options = rolls.length ? rolls : ['Standard Roll', 'Reverse Roll'];
                      return (
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">
                            Roll direction {!item.heading && <span className="text-amber-600">· needed</span>}
                          </label>
                          <div className="flex gap-2">
                            {options.map(o => (
                              <button key={o} type="button"
                                onClick={() => setLineItem(idx, 'heading', o)}
                                className={`flex-1 text-xs font-medium py-2 rounded-lg border transition-colors ${
                                  item.heading === o
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}>
                                {o}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* What the supplier's spec sheet says about what was just
                      measured — under the fields it refers to, while the tape
                      is still in your hand. */}
                  {limitIssues[item.id] && (
                    <div className="px-4 pb-1">
                      <LineLimitWarnings results={limitIssues[item.id]} onOpenDoc={setLimitDocId} />
                    </div>
                  )}

                  {/* Specs toggle. Closed, it still states what the specs ARE —
                      they are inherited from the previous opening, and a row
                      that only said "Show specifications" gave no way to tell
                      whether the right ones had carried over without opening
                      eleven dropdowns to look. */}
                  <div className="px-4 pb-3">
                    <button type="button" onClick={() => toggleItemExpand(item.id)}
                      className="w-full flex items-center gap-2 text-left py-1">
                      {isExpanded
                        ? <ChevronUp size={14} className="text-amber-600 flex-shrink-0" />
                        : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
                      {isExpanded ? (
                        <span className="text-xs font-medium text-amber-600">Hide specifications</span>
                      ) : specSummary(item, productType) ? (
                        <span className="text-xs text-slate-500 truncate">{specSummary(item, productType)}</span>
                      ) : (
                        <span className="text-xs font-medium text-amber-600">Add specifications</span>
                      )}
                    </button>
                  </div>

                  {/* Expanded specs — only the specs this product type uses.
                      Any spec that already holds a value stays visible too, so
                      changing the product type never hides entered data. */}
                  {isExpanded && (
                    <div className="opening-content-enter border-t border-slate-100 px-4 py-3 bg-slate-50/40 space-y-3">
                      {(dropdownSpecs.length > 0 || liningVisible) ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {dropdownSpecs.map(k => (
                            <SpecField key={k} specKey={k} item={item} idx={idx} setLineItem={setLineItem} productType={productType} />
                          ))}
                          {liningVisible && <LiningBlock item={item} idx={idx} setLineItem={setLineItem} productType={productType} />}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">
                          {productType ? `${productType.name} has no specs configured — add some in Settings › Product Types, or use “Other specifications” below.` : 'Pick a product to see its specs.'}
                        </p>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <SpecSelect label="Operation requested" value={item.operationRequest} options={OPERATION_REQUESTS} onChange={v=>setLineItem(idx,'operationRequest',v)} />
                        {/curtain/i.test(item.productNameSnapshot || productType?.name || '') && <>
                          <SpecSelect label="Curtain layers" value={item.curtainLayers} options={['Sheer only','Blockout only','Separate sheer and blockout','Curtain with attached lining']} onChange={v=>setLineItem(idx,'curtainLayers',v)} />
                          <SpecSelect label="Track arrangement" value={item.trackArrangement} options={['Single track','Double tracks with dual brackets','Two separate tracks','Existing track — fabric only']} onChange={v=>setLineItem(idx,'trackArrangement',v)} />
                          <SpecSelect label="Track installation" value={item.trackRecess} options={['Recessed / built into ceiling','Surface mounted','Existing — confirm']} onChange={v=>setLineItem(idx,'trackRecess',v)} />
                        </>}
                        {/roman/i.test(item.productNameSnapshot || productType?.name || '') && <SpecSelect label="Roman lining" value={item.liningRequirement} options={['Unlined','Lined']} onChange={v=>setLineItem(idx,'liningRequirement',v)} />}
                        {/roman/i.test(item.productNameSnapshot || productType?.name || '') && <div><label className="block text-xs font-medium text-slate-500 mb-1">Lining Fabric / Colour</label><input aria-label="Lining Fabric / Colour" value={item.liningFabricColour || ''} onChange={e=>setLineItem(idx,'liningFabricColour',e.target.value)} className={inp()} /></div>}
                        {item.operationRequest==='Manual and automated alternatives' && <>
                          <SpecSelect label="Manual control / track model" value={item.manualTrackType} options={getMsOptions('operationType',productType)} onChange={v=>setLineItem(idx,'manualTrackType',v)} />
                          <SpecSelect label="Automated control / track model" value={item.automatedTrackType} options={getMsOptions('operationType',productType)} onChange={v=>setLineItem(idx,'automatedTrackType',v)} />
                        </>}
                        {item.operationRequest && item.operationRequest!=='Manual' && <SpecSelect label="Motor power" value={item.motorPower} options={['Battery','240V','Low voltage — confirm system']} onChange={v=>setLineItem(idx,'motorPower',v)} />}
                        <div><label className="block text-xs font-medium text-slate-500 mb-1">Supplier</label><input aria-label="Supplier" value={item.supplier || ''} onChange={e=>setLineItem(idx,'supplier',e.target.value)} className={inp()} /></div>
                      </div>

                      {/* Escape hatch: reach any spec this product type doesn't normally use */}
                      {hiddenSpecs.length > 0 && (
                        <div className="pt-1">
                          <button type="button" onClick={() => toggleOtherSpecs(item.id)}
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
                            {otherOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {otherOpen ? 'Hide other specifications' : `Other specifications (${hiddenSpecs.length})`}
                          </button>
                          {otherOpen && (
                            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {hiddenSpecs.filter(f => f.key !== 'lining').map(f => (
                                <SpecField key={f.key} specKey={f.key} item={item} idx={idx} setLineItem={setLineItem} productType={productType} />
                              ))}
                              {hiddenSpecs.some(f => f.key === 'lining') && <LiningBlock item={item} idx={idx} setLineItem={setLineItem} productType={productType} />}
                            </div>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                        <textarea aria-label="Notes" value={item.notes || ''}
                          onChange={e => setLineItem(idx,'notes',e.target.value)}
                          rows={2} placeholder="Additional notes…" className={inp() + ' resize-none'} />
                      </div>

                      {/* A photo of the opening beats any description of it */}
                      <LinePhotos
                        sheetId={sheetId}
                        item={item}
                        onChange={(paths) => setLinePhotos(item.id, paths)}
                      />
                    </div>
                  )}

                  {children && <div className="border-t border-slate-100 px-4 py-3 space-y-4">{children}</div>}

                  {/* Step straight to the next opening — closes this card,
                      opens that one and puts it at the top. Walking a house
                      window by window shouldn't involve the scrollbar at all,
                      and this is what stops you sailing past the one you
                      wanted. The last line offers a new one instead. */}
                  <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-2">
                    {/* Two taps, and the second is the only red thing on the
                        card. An opening is twenty seconds of measuring and a
                        trip back to site if it goes. */}
                    {removeLineItem && (confirmDelete === item.id ? (
                      <span className="flex items-center gap-1">
                        <button type="button"
                          onClick={() => { setConfirmDelete(null); removeLineItem(idx); }}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1.5">
                          Delete opening
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)}
                          className="text-xs font-medium text-slate-400 hover:text-slate-600 px-2 py-1.5">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button"
                        onClick={() => setConfirmDelete(item.id)}
                        disabled={lineCount <= 1}
                        title={lineCount <= 1
                          ? 'A sheet keeps at least one opening'
                          : 'Remove this opening'}
                        className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-400 px-2 py-1.5">
                        <Trash2 size={13} /> Delete
                      </button>
                    ))}
                    <span className="flex-1" />
                    <button type="button" onClick={() => toggleCard(item.id)}
                      className="text-xs font-medium text-slate-400 hover:text-slate-600 px-2 py-1.5">
                      Collapse
                    </button>
                    {nextItem ? (
                      <button type="button" onClick={() => openOnly(nextItem.id)}
                        className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 px-2 py-1.5">
                        Next: {nextItem.location || `line ${idx + 2}`} <ChevronDown size={13} />
                      </button>
                    ) : addLineItem ? (
                      <button type="button" onClick={addLineItem}
                        className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 px-2 py-1.5">
                        <Plus size={13} /> Add next opening
                      </button>
                    ) : null}
                  </div>
                  </div>}
                </div>
);
}
