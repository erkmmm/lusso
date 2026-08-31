import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useActiveSalespeople } from '../hooks/useActiveSalespeople';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Eye, Send, Save,
  User, FileText, Settings, DollarSign, ChevronRight, GripVertical,
  Package, ClipboardList, BookOpen, Sparkles, Info, Check, Copy,
  AlertCircle, CheckCircle2, X, Loader2, ExternalLink, Map, RefreshCw, Ruler,
  Calculator,
} from 'lucide-react';
import AddressAutocomplete from '../components/AddressAutocomplete';
import {
  getQuote, getCustomers, getCustomer, getMeasureSheet, getMeasureSheets, getJob,
  getActiveProductTypes, getSavedItems, getPricedItems, getQuoteTemplates, getQuoteSettings,
  getQuoteWording, DEFAULT_MARGIN_PERCENT,
  CONTROL_OPTIONS, RETURN_OPTIONS, MOTOR_SIDE_OPTIONS, FIXING_OPTIONS,
  HEADING_OPTIONS, HEM_OPTIONS, TRACK_COLOUR_OPTIONS, BASE_BAR_COLOUR_OPTIONS, BASE_BAR_TYPE_OPTIONS, CHAIN_COLOUR_OPTIONS,
  computeQuoteTotals, linePricing, QUOTE_ITEM_TYPES, DEPOSIT_TYPES,
  createQuote, saveQuote, addQuoteActivity,
  getMeasureSheetByJob, getMessagePresets, getTakeoffByJob,
  getCurtainRates,
} from '../store/data';
import Card from '../components/Card';
import CurtainCostPanel from '../components/CurtainCostPanel';
import { isCurtainProduct, autoCostCurtainLine } from '../lib/curtainCalc';
import { quoteSections } from '../lib/quoteSections';
import { nextRoomLabel, splitRoomLabel, capitaliseRoom } from '../lib/roomNaming';
import { describeLine } from '../lib/describeLine';
import { curtainBlockers } from '../lib/curtainBlockers';

import CustomerQuotePage from './CustomerQuotePage';
import { deliverQuote } from '../lib/quoteDelivery';
import { captureQuotePlan, removeQuotePlan, snapshotIsStale } from '../lib/quotePlanSnapshot';
import PricedItemPicker from '../components/PricedItemPicker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The quote saved but the email didn't go. Distinct from a save failure so
// doSave's catch-all can let it past and the user gets the real reason rather
// than "could not save".
class SendFailed extends Error {
  constructor(message, quote) {
    super(message);
    this.name = 'SendFailed';
    this.quote = quote;
  }
}

const fmt = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-AU')}`;

// ─── Parts & Accessories catalogue ───────────────────────────────────────────
const PRESET_PARTS = [
  { name: 'Acmeda Automate WiFi Hub',            description: 'Acmeda Automate Pulse WiFi Hub',                                      price: 340 },
  { name: 'Wall Charger 4m USB to Micro Cable',  description: 'Acmeda Li-ion Charger to charge battery operated roller blinds',      price: 38  },
  { name: '1 Channel Remote Control – White',    description: '1 Channel Wire Free Remote Control White',                            price: 85  },
  { name: '5 Channel Remote Control – White',    description: '5 Channel Wire Free Remote Control White',                            price: 95  },
  { name: '15 Channel Remote Control – White',   description: '15 Channel Wire Free Remote Control White',                           price: 120 },
];

const EMPTY_PART_ITEM = (preset = {}) => ({
  id: uuidv4(),
  type: 'Part',
  choiceGroupId: null,
  choiceRequired: false,
  location: '',
  productTypeId: '',
  productNameSnapshot: preset.name || '',
  description: preset.description || '',
  quantity: 1,
  widthMm: '', dropMm: '', fabricColour: '',
  control: '', returnSide: '', motorSide: '', fixing: '',
  heading: '', hem: '', trackColour: '', baseBarColour: '', trackBaseBarColour: '',
  baseBarType: '', chainColour: '', trackType: '',
  attachedLining: false,
  unitCostPrice: '', labourCost: '', marginPercent: DEFAULT_MARGIN_PERCENT,
  manualSellPrice: preset.price || '',
  discountPercent: '', discountAmount: '',
  supplier: 'Acmeda',
  taxable: true,
  customerNotes: '', internalNotes: '',
  sortOrder: 0,
  measureSheetLineItemId: null,
});

const EMPTY_LINE_ITEM = () => ({
  id: uuidv4(),
  type: 'Required',
  choiceGroupId: null,
  choiceRequired: false,
  location: '',
  productTypeId: '',
  productNameSnapshot: '',
  pricedItemId: null,
  description: '',
  quantity: 1,
  widthMm: '',
  dropMm: '',
  fabricColour: '',
  control: '',
  returnSide: '',
  motorSide: '',
  fixing: '',
  heading: '',
  hem: '',
  trackColour: '',
  baseBarColour: '',
  trackBaseBarColour: '',
  baseBarType: '',
  chainColour: '',
  trackType: '',
  attachedLining: false,
  // Curtain calculator inputs (see components/CurtainCostPanel)
  curtainFabricPricePerM: '',
  curtainFabricWidthMm: '',
  curtainLiningPricePerM: '',
  curtainExtraCost: '',
  curtainFittingEnabled: true,
  unitCostPrice: '',
  labourCost: '',
  marginPercent: DEFAULT_MARGIN_PERCENT,
  manualSellPrice: '',
  discountPercent: '',
  discountAmount: '',
  pricePerSqm: null,
  supplier: '',
  taxable: true,
  customerNotes: '',
  internalNotes: '',
  sortOrder: 0,
  measureSheetLineItemId: null,
});

/**
 * buildSalesDescription — generates a concise, client-facing product description.
 * Shows fabric + product name only. All other specs (fixing, control, heading etc.)
 * are displayed separately in the specs section — no duplication.
 */
function buildSalesDescription(item) {
  const product = (item.productNameSnapshot || item.productType || '').trim();
  const fabric  = (item.fabricColour || '').trim();

  if (!product && !fabric) return '';

  // Combine fabric colour + product name naturally
  let desc = '';
  if (fabric && product) {
    desc = `${fabric} ${product}`;
  } else {
    desc = product || fabric;
  }

  // Capitalise first letter
  return desc.charAt(0).toUpperCase() + desc.slice(1) + '.';
}

// Backwards-compat wrapper used when importing from measure sheets
function genClientDesc(msLi) {
  return buildSalesDescription(msLi);
}

// msItemToQuoteLine: converts a measure sheet line item to a quote line item
//
// Curtains arrive pre-costed by the calculator (src/lib/curtainCalc.js). This
// path and QuoteFromJob's share autoCostCurtainLine so the two can't drift.
function msItemToQuoteLine(msLi, sortOrder, rates, pricedItems) {
  const costed = autoCostCurtainLine(
    { ...msLi, productNameSnapshot: msLi.productNameSnapshot || msLi.productType },
    rates || getCurtainRates(),
    pricedItems || getPricedItems(),
  );
  const curtainCost = costed && !costed.blocked
    ? {
        unitCostPrice:          costed.unitCostPrice,
        labourCost:             costed.labourCost,
        curtainFabricPricePerM: costed.curtainFabricPricePerM,
      }
    : {};

  return {
    ...EMPTY_LINE_ITEM(),
    measureSheetLineItemId: msLi.id,
    pricedItemId: msLi.pricedItemId || null,
    location: msLi.location || '',
    productTypeId: msLi.productTypeId || '',
    productNameSnapshot: msLi.productNameSnapshot || msLi.productType || '',
    description: genClientDesc(msLi),
    quantity: msLi.quantity || 1,
    widthMm: msLi.widthMm || msLi.width || '',
    dropMm: msLi.dropMm || msLi.drop || '',
    fabricColour: msLi.fabricColour || '',
    control: msLi.control || '',
    returnSide: msLi.returnSide || msLi.controlSide || '',
    motorSide: msLi.motorSide || '',
    fixing: msLi.fixing || msLi.mountType || '',
    heading: msLi.heading || '',
    hem: msLi.hem || '',
    trackColour:       msLi.trackColour || '',
    baseBarColour:     msLi.baseBarColour || '',
    trackBaseBarColour: msLi.trackBaseBarColour || '',
    baseBarType:       msLi.baseBarType || '',
    chainColour: msLi.chainColour || '',
    // The calculator needs the track and lining, which this converter used to
    // drop — without them the panel opened with no track and couldn't price it.
    trackType:          msLi.trackType || '',
    attachedLining:     !!msLi.attachedLining,
    liningFabricColour: msLi.liningFabricColour || '',
    ...curtainCost,
    internalNotes: msLi.notes || '',
    sortOrder,
  };
}

function SpecSelect({ label, value, onChange, options }) {
  const hasOther = options.includes('Other');
  const nonOther = options.filter(o => o !== 'Other');
  // Show the text input when "Other" is the sentinel OR when the value isn't in the preset list
  const showInput = hasOther && (value === 'Other' || (value !== '' && !nonOther.includes(value)));
  const selectVal  = showInput ? 'Other' : (value || '');
  // The text box shows empty when sentinel is set, otherwise shows the typed value
  const inputVal   = value === 'Other' ? '' : (showInput ? value : '');

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select
        value={selectVal}
        onChange={e => onChange(e.target.value === 'Other' ? 'Other' : e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {showInput && (
        <input
          autoFocus
          value={inputVal}
          onChange={e => onChange(e.target.value)}
          placeholder="Type custom value…"
          className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg border border-amber-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      )}
    </div>
  );
}

/**
 * A text field that commits when you leave it, not on every keystroke.
 *
 * Location and choice-group decide which room section and which "choose one"
 * block a line belongs to. Regrouping per keystroke would tear the card out of
 * the DOM mid-word and take the caret with it, so those two fields hold their
 * own value while focused and hand it over on blur or Enter.
 */
function DeferredInput({ label, value, onCommit, placeholder, className }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value || '');
  const commit = () => { if (draft !== null) { onCommit(draft); setDraft(null); } };
  return (
    <div>
      {label && <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>}
      <input
        value={shown}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } }}
        placeholder={placeholder}
        className={className || 'w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'}
      />
    </div>
  );
}

function FieldInput({ label, value, onChange, placeholder, type = 'text', prefix }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${prefix ? 'pl-7' : 'px-3'} pr-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400`}
        />
      </div>
    </div>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

/**
 * Attach the job's plan takeoff so the customer can see WHERE each product
 * goes, not just a list of rooms and prices.
 *
 * The wording leans on "snapshot" throughout because that's the behaviour that
 * will surprise someone otherwise: change the takeoff later and this quote
 * keeps showing what was priced, until it's refreshed on purpose.
 */
function PlanAttachment({ takeoff, snapshot, busy, onAttach, onDetach, onToggleSizes }) {
  const stale = snapshotIsStale(snapshot, takeoff);

  if (!takeoff?.filePath && !snapshot) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 flex items-start gap-2.5">
        <Map size={15} className="text-slate-300 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-slate-400">
          No plan takeoff on this job yet. Mark one up on the job&rsquo;s plan and you can attach it here, so the
          customer sees which window is getting what alongside the price.
        </p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-slate-200 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Map size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-800">Attach the plan takeoff</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Adds the marked-up plan and window schedule to the customer&rsquo;s quote page — each covering drawn
              where it goes, colour-coded by product.
            </p>
          </div>
          <button
            type="button" onClick={onAttach} disabled={busy}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Map size={13} />} Attach
          </button>
        </div>
      </div>
    );
  }

  const measured = snapshot.schedule.filter(e => e.measured).length;
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-2.5 bg-slate-50/70">
        <Map size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">
            Plan attached · {snapshot.schedule.length} opening{snapshot.schedule.length === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {snapshot.pages.length} page{snapshot.pages.length === 1 ? '' : 's'} ·
            {' '}captured {new Date(snapshot.capturedAt).toLocaleDateString('en-AU')}
            {snapshot.fileName ? ` from ${snapshot.fileName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button" onClick={onAttach} disabled={busy}
            title="Re-capture from the current takeoff"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            type="button" onClick={onDetach} disabled={busy}
            title="Remove the plan from this quote"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-white disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* The takeoff has moved on since this was captured. Saying so is the
          whole reason the snapshot carries a revision. */}
      {stale && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800 flex items-center gap-1.5">
          <AlertCircle size={13} className="flex-shrink-0" />
          The takeoff has changed since this was captured — refresh to show the customer the latest.
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-slate-500 flex items-center gap-1.5">
          <Ruler size={12} className={measured === snapshot.schedule.length ? 'text-green-600' : 'text-amber-500'} />
          {measured} of {snapshot.schedule.length} measured on site
        </span>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-auto">
          <input
            type="checkbox" checked={snapshot.showSizes !== false}
            onChange={e => onToggleSizes(e.target.checked)}
            className="accent-amber-500"
          />
          Show sizes to the customer
        </label>
      </div>

      {snapshot.pages[0]?.url && (
        <div className="px-4 pb-3 pt-1 flex gap-2 overflow-x-auto">
          {snapshot.pages.map(pg => (
            <img
              key={pg.path} src={pg.url} alt={`Plan page ${pg.pageNumber}`}
              className="h-24 rounded-lg border border-slate-200 bg-white flex-shrink-0"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Icon size={15} className="text-slate-400" /> {title}
        </span>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-100">{children}</div>}
    </Card>
  );
}

/**
 * Cost, margin and the numbers that fall out of them.
 *
 * Shared by ordinary lines and parts. A part is bought and resold exactly like
 * a blind is, so quoting it at a flat sell price left it out of every margin
 * figure the business actually runs on.
 */
function PricingFields({ item, set, pricing }) {
  const { finalSell, lineTotal, grossProfit, gpPercent, totalCost, calcSell, preDiscountSell, discountTotal } = pricing;
  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FieldInput label="Material Cost 🔒" value={item.unitCostPrice} onChange={v => set('unitCostPrice', v)} type="number" placeholder="0.00" prefix="$" />
        <FieldInput label="Labour Cost 🔒" value={item.labourCost} onChange={v => set('labourCost', v)} type="number" placeholder="0.00" prefix="$" />
        <FieldInput label="Margin % 🔒" value={item.marginPercent} onChange={v => set('marginPercent', v)} type="number" placeholder={String(DEFAULT_MARGIN_PERCENT)} />
        <FieldInput label="Supplier 🔒" value={item.supplier} onChange={v => set('supplier', v)} placeholder="e.g. Acmeda" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Calc. Sell Price</label>
          <p className="text-sm text-slate-500 py-1.5">{fmt(calcSell)}</p>
        </div>
        <FieldInput label="Manual Sell Price (override)" value={item.manualSellPrice} onChange={v => set('manualSellPrice', v)} type="number" placeholder={`${fmt(calcSell)} (auto)`} prefix="$" />
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Final Sell (ea)</label>
          <p className="text-sm font-bold text-slate-800 py-1.5">{fmt(finalSell)}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Line Total</label>
          <p className="text-sm font-bold text-amber-700 py-1.5">{fmt(lineTotal)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FieldInput label="Discount %" value={item.discountPercent} onChange={v => { set('discountPercent', v); if (v) set('discountAmount', ''); }} type="number" placeholder="0" />
        <FieldInput label="or Discount $ (each)" value={item.discountAmount} onChange={v => { set('discountAmount', v); if (v) set('discountPercent', ''); }} type="number" placeholder="0.00" prefix="$" />
        {discountTotal > 0 && (
          <div className="col-span-2 flex items-center gap-2 text-xs text-amber-700 pt-6">
            <span className="line-through text-slate-400">{fmt(preDiscountSell)}</span>
            <span className="font-semibold">− {fmt(discountTotal)} off this line</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1.5 border-t border-slate-200">
        <span className="text-xs text-slate-400">Cost: <span className="font-medium text-slate-600">{fmt(totalCost * (Number(item.quantity) || 1))}</span></span>
        <span className="text-xs text-slate-400">GP: <span className={`font-semibold ${grossProfit * (Number(item.quantity) || 1) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(grossProfit * (Number(item.quantity) || 1))}</span></span>
        <span className="text-xs text-slate-400">GP%: <span className={`font-semibold ${gpPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>{gpPercent.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}

// ─── LineItemCard ─────────────────────────────────────────────────────────────

function LineItemCard({ item, productTypes, wording, onChange, onRemove, onDuplicate, canRemove, isExpanded, onToggle, inBlock, measureSheetId, navigate }) {
  const [showSpecs, setShowSpecs] = useState(false);
  const [showPricing, setShowPricing] = useState(true);

  const set = (field, value) => onChange(item.id, field, value);

  // Curtains are costed by the calculator rather than a flat price, so the
  // panel is offered whenever the line is one.
  const productType = productTypes.find(p => p.id === item.productTypeId);
  const isCurtain = isCurtainProduct(item.productNameSnapshot || productType?.name || '');

  // Why this curtain can't be costed, if it is one and it can't. Computed here
  // so the collapsed row can say so without anyone opening the pricing panel —
  // a blank cost that explains itself is the whole point.
  const costed = isCurtain ? autoCostCurtainLine(item, getCurtainRates(), getPricedItems()) : null;
  const blockers = costed?.blocked ? curtainBlockers(costed.warnings, { measureSheetId }) : [];

  const pricing = linePricing(item);
  // Only what the collapsed row shows — the rest is PricingFields' business.
  const { lineTotal, discountTotal } = pricing;

  const TYPE_COLORS = {
    Required:         'bg-slate-100 text-slate-700 border-slate-200',
    Optional:         'bg-amber-100 text-amber-700 border-amber-200',
    'Multiple Choice':'bg-purple-100 text-purple-700 border-purple-200',
    Part:             'bg-cyan-100 text-cyan-700 border-cyan-200',
  };

  // The collapsed row mirrors the customer's option card — product name, then
  // the customer-facing description, then the size — so building a quote shows
  // what the quote will read like without opening the preview. The internals a
  // customer never sees (fabric code, control) stay in the expanded body.
  const desc = [item.description, item.customerNotes].filter(Boolean).join(' · ');
  const meta = [
    item.widthMm ? `${item.widthMm} × ${item.dropMm || '—'} mm` : null,
    Number(item.quantity) > 1 ? `${item.quantity} of them` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`border rounded-xl overflow-hidden bg-white transition-shadow ${isExpanded ? 'border-amber-300 shadow-sm' : 'border-slate-200'}`}>
      {/* ── Header — always visible, click to expand/collapse ── */}
      {/* A div, not a button: the remove control lives inside this row, and a
          button nested in a button is invalid DOM that React rejects. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className={`w-full flex items-start gap-3 px-4 py-3 text-left cursor-pointer transition-colors ${isExpanded ? 'bg-amber-50 border-b border-amber-100' : 'bg-white hover:bg-slate-50'}`}
      >
        {/* Title + customer-facing description, as the customer will read it */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800 block">
            {describeLine(item, productTypes, wording) || <span className="text-slate-400 font-normal">New item — no product yet</span>}
          </span>
          {desc && <span className="text-xs text-slate-500 leading-relaxed block mt-0.5">{desc}</span>}
          {meta && <span className="text-xs text-slate-400 block mt-0.5">{meta}</span>}
          {!item.location && (
            <span className="text-[11px] text-amber-600 block mt-1">No room set — shows under “General”</span>
          )}
          {/* Said on the row, not behind "Show pricing": a curtain that cannot
              be costed is exactly the line you would otherwise scroll past. */}
          {blockers.length > 0 && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <AlertCircle size={11} /> Can&rsquo;t be priced
              </span>
              <span className="text-[11px] text-slate-500">
                {blockers.map(b => b.what + (b.detail ? ` ${b.detail}` : '')).join(' · ')}
              </span>
              {blockers.filter(b => b.href).map(b => (
                <button key={b.code} type="button"
                  onClick={e => { e.stopPropagation(); navigate(b.href); }}
                  className="text-[11px] font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800">
                  {b.fixLabel}
                </button>
              ))}
            </span>
          )}
        </div>
        {/* Type badge — redundant inside a block that already says "choose one"
            or "optional", so it only appears where it still tells you something. */}
        {item.type !== 'Required' && !inBlock && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${TYPE_COLORS[item.type] || TYPE_COLORS.Required}`}>
            {item.type}
          </span>
        )}
        {/* Line total */}
        <div className="flex-shrink-0 text-right">
          <span className="text-sm font-bold text-slate-800 block">{fmt(lineTotal)}</span>
          {discountTotal > 0 && <span className="text-[10px] text-amber-600 block">−{fmt(discountTotal)}</span>}
        </div>
        {/* Chevron */}
        <span className="text-slate-400 flex-shrink-0">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
        {/* Remove button — stop propagation so it doesn't toggle */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDuplicate(item.id); }}
          className="text-slate-300 hover:text-amber-500 transition-colors flex-shrink-0 p-1"
          title="Duplicate this item"
        >
          <Copy size={14} />
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRemove(item.id); }}
            className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0 p-1 -mr-1"
          >
            <Trash2 size={14} />
          </button>
          )}
      </div>

      {/* Body — only shown when expanded */}
      {isExpanded && item.type === 'Part' && (
        <div className="p-4 space-y-4">
          {/* Type toggle strip */}
          <div className="flex flex-wrap gap-1.5">
            {QUOTE_ITEM_TYPES.map(t => (
              <button key={t} type="button" onClick={() => set('type', t)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${item.type === t ? TYPE_COLORS[t] : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                {t}
              </button>
            ))}
          </div>
          {/* Part name */}
          <FieldInput label="Part / Accessory Name" value={item.productNameSnapshot} onChange={v => set('productNameSnapshot', v)} placeholder="e.g. Acmeda Automate WiFi Hub" />
          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Description (customer-facing)</label>
            <input value={item.description} onChange={e => set('description', e.target.value)}
              placeholder="e.g. Acmeda Automate Pulse WiFi Hub"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          {/* Qty + taxable */}
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="Qty" value={item.quantity} onChange={v => set('quantity', v)} type="number" placeholder="1" />
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Taxable</label>
              <button type="button" onClick={() => set('taxable', !item.taxable)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${item.taxable ? 'bg-green-50 border-green-300 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                {item.taxable ? 'GST Applicable' : 'GST Free'}
              </button>
            </div>
          </div>
          {/* A part is bought and resold like anything else on the quote, so it
              gets the same cost/margin panel. It only ever had a flat sell
              price, which left every part invisible to the margin figures the
              rest of the quote is judged on. */}
          <PricingFields item={item} set={set} pricing={pricing} />
        </div>
      )}

      {isExpanded && item.type !== 'Part' && <div className="p-4 space-y-4">
        {/* Item type toggle */}
        <div className="flex flex-wrap gap-1.5">
          {QUOTE_ITEM_TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => set('type', t)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                item.type === t ? TYPE_COLORS[t] : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* Row 1: Location + Product */}
        <div className="grid grid-cols-2 gap-3">
          <DeferredInput label="Location / Room" value={item.location}
            onCommit={v => set('location', capitaliseRoom(v))}
            placeholder="e.g. Master Bedroom — or Bed 2 A, Bed 2 B" />
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Product</label>
            <PricedItemPicker
              value={item.productNameSnapshot}
              productTypes={productTypes}
              onSelect={pricedItem => {
                if (!pricedItem) {
                  set('pricedItemId', null);
                  set('productNameSnapshot', '');
                  set('productTypeId', '');
                  return;
                }
                // Match product type by category
                const pt = productTypes.find(p =>
                  p.name.toLowerCase() === (pricedItem.category || '').toLowerCase()
                );
                set('pricedItemId',         pricedItem.id);
                set('productNameSnapshot',  pricedItem.itemName);
                set('productTypeId',        pt?.id || '');
                // Pre-fill pricing from library item
                if (pricedItem.costPrice)     set('unitCostPrice',  pricedItem.costPrice);
                if (pricedItem.labourCost)    set('labourCost',     pricedItem.labourCost);
                if (pricedItem.marginPercent) set('marginPercent',  pricedItem.marginPercent);
                if (pricedItem.supplier)      set('supplier',       pricedItem.supplier);
                // For size-based pricing: store $/m² rate and clear fixed sell price
                // so the quote builder can auto-calculate from width × drop
                if (pricedItem.pricePerSqm) {
                  set('pricePerSqm',    pricedItem.pricePerSqm);
                  set('manualSellPrice', ''); // will be calculated from $/m² × area
                } else if (pricedItem.sellPrice) {
                  set('pricePerSqm',    null);
                  set('manualSellPrice', pricedItem.sellPrice);
                }
              }}
              onSelectType={pt => {
                if (!pt) {
                  set('productTypeId', '');
                  set('productNameSnapshot', '');
                  set('pricedItemId', null);
                  return;
                }
                set('productTypeId',       pt.id);
                set('productNameSnapshot', pt.name);
                set('pricedItemId',        null);
              }}
            />
          </div>
        </div>

        {/* Row 2: Qty + Width + Drop + Fabric */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FieldInput label="Qty" value={item.quantity} onChange={v => set('quantity', v)} type="number" placeholder="1" />
          <FieldInput label="Width (mm)" value={item.widthMm} onChange={v => set('widthMm', v)} type="number" placeholder="1800" />
          <FieldInput label="Drop (mm)" value={item.dropMm} onChange={v => set('dropMm', v)} type="number" placeholder="2400" />
          <FieldInput label="Fabric / Colour" value={item.fabricColour} onChange={v => set('fabricColour', v)} placeholder="Arctic White" />
        </div>

        {/* Specs toggle */}
        <button
          type="button"
          onClick={() => setShowSpecs(s => !s)}
          className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 font-medium"
        >
          {showSpecs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showSpecs ? 'Hide specifications' : 'Show specifications'}
        </button>

        {showSpecs && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 rounded-xl p-3">
            <SpecSelect label="Control" value={item.control} onChange={v => set('control', v)} options={CONTROL_OPTIONS} />
            <SpecSelect label="Return" value={item.returnSide} onChange={v => set('returnSide', v)} options={RETURN_OPTIONS} />
            <SpecSelect label="Motor Side" value={item.motorSide} onChange={v => set('motorSide', v)} options={MOTOR_SIDE_OPTIONS} />
            <SpecSelect label="Fixing" value={item.fixing} onChange={v => set('fixing', v)} options={FIXING_OPTIONS} />
            <SpecSelect label="Heading" value={item.heading} onChange={v => set('heading', v)} options={HEADING_OPTIONS} />
            <SpecSelect label="Hem" value={item.hem} onChange={v => set('hem', v)} options={HEM_OPTIONS} />
            <SpecSelect label="Track Colour" value={item.trackColour} onChange={v => set('trackColour', v)} options={TRACK_COLOUR_OPTIONS} />
            <SpecSelect label="Bottom Rail Colour" value={item.baseBarColour} onChange={v => set('baseBarColour', v)} options={BASE_BAR_COLOUR_OPTIONS} />
            <SpecSelect label="Bottom Rail Type" value={item.baseBarType} onChange={v => set('baseBarType', v)} options={BASE_BAR_TYPE_OPTIONS} />
            <SpecSelect label="Chain Colour" value={item.chainColour} onChange={v => set('chainColour', v)} options={CHAIN_COLOUR_OPTIONS} />
          </div>
        )}

        {/* Pricing toggle */}
        <button
          type="button"
          onClick={() => setShowPricing(s => !s)}
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 font-medium"
        >
          {showPricing ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showPricing ? 'Hide pricing' : 'Show pricing'}
        </button>

        {showPricing && (
          <div className="space-y-3">
            <PricingFields item={item} set={set} pricing={pricing} />
            {/* Curtain cost calculator — the Excel workbook, inline. Shown on
                every curtain line, measured or not: a line missing its drop is
                the one that most needs to say so, and hiding the panel there
                made the whole feature invisible on real quotes. */}
            {isCurtain && <CurtainCostPanel item={item} set={set} />}

            {/* $/m² calculator — shown when item has a per-sqm rate and dimensions are set */}
            {item.pricePerSqm && item.widthMm && item.dropMm && (() => {
              const w = Number(item.widthMm);
              const d = Number(item.dropMm);
              const sqm = w * d / 1_000_000;
              const calc = Math.round(sqm * Number(item.pricePerSqm) * 100) / 100;
              return (
                <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-xs">
                  <span className="text-violet-500">$/m² price:</span>
                  <span className="font-bold text-violet-800">{fmt(calc)}</span>
                  <span className="text-violet-400 hidden sm:inline">
                    ({w}mm × {d}mm = {sqm.toFixed(3)}m² × ${item.pricePerSqm}/m²)
                  </span>
                  <button
                    type="button"
                    onClick={() => set('manualSellPrice', String(calc))}
                    className="ml-auto flex-shrink-0 bg-violet-500 hover:bg-violet-400 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Use this price
                  </button>
                </div>
              );
            })()}

          </div>
        )}

        {/* Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Customer Notes</label>
            <textarea
              value={item.customerNotes}
              onChange={e => set('customerNotes', e.target.value)}
              placeholder="Visible to customer on the quote…"
              rows={2}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Internal Notes 🔒</label>
            <textarea
              value={item.internalNotes}
              onChange={e => set('internalNotes', e.target.value)}
              placeholder="Internal only — not shown to customer…"
              rows={2}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-yellow-50"
            />
          </div>
        </div>

        {/* Multiple choice group ID if type is Multiple Choice */}
        {item.type === 'Multiple Choice' && (
          <div className="space-y-2">
            <DeferredInput
              label="Choice Group Name"
              value={item.choiceGroupId || ''}
              onCommit={v => set('choiceGroupId', v)}
              placeholder="e.g. motor-upgrade (items with same group are shown as alternatives)"
              className="w-full px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            {/* Set on any line in the group to make the whole group compulsory.
                Without it a customer can accept a quote having answered none of
                the alternatives, and the order goes to production with the
                decision still missing. */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.choiceRequired || false}
                onChange={e => set('choiceRequired', e.target.checked)}
                className="mt-0.5 accent-purple-500"
              />
              <div>
                <p className="text-xs font-medium text-slate-700">Customer must choose one from this group</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Blocks acceptance until they pick, and hides the &ldquo;prefer none of these&rdquo; opt-out.</p>
              </div>
            </label>
          </div>
        )}
      </div>}
    </div>
  );
}

/**
 * The customer's quote, full screen, with the send control past the end of it.
 *
 * Deliberately not a sticky footer: the send button sits below the quote's own
 * summary bar, so reaching it means scrolling through everything the customer
 * will read. That is the whole point of routing the send through here.
 */
function SendPreviewOverlay({ quote, recipient, isDraft, saving, onSend, onClose }) {

  // Esc closes — the overlay covers the whole editor, so there has to be a way
  // out that isn't hunting for the button.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);


  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Preview and send quote">
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        {/* Staff bar — the only chrome over the customer's view */}
        <div className="sticky top-0 z-20 flex items-center gap-3 bg-slate-900 text-white px-4 py-2.5 text-xs">
          <Eye size={14} className="flex-shrink-0 opacity-70" />
          <span className="flex-1 min-w-0 truncate">
            This is what {recipient || 'the customer'} will see — scroll to the bottom to send it.
          </span>
          <button type="button" onClick={onClose}
            className="flex-shrink-0 rounded-full p-1 hover:bg-white/10 transition-colors" title="Close preview (Esc)">
            <X size={14} />
          </button>
        </div>

        <CustomerQuotePage
          previewQuote={quote}
          footer={
            <div className="bg-slate-900 px-5 py-10">
              <div className="mx-auto w-full max-w-[880px]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-400">
                  End of the customer&rsquo;s view
                </p>
                <h2 className="mt-3 text-2xl font-light tracking-tight text-white">
                  {isDraft ? 'Send this quote?' : 'Re-send this quote?'}
                </h2>
                <p className="mt-2.5 max-w-[52ch] text-sm leading-relaxed text-slate-300">
                  {recipient
                    ? <>Everything above goes to <span className="text-white">{recipient}</span> as a link they can open, choose their options on, and accept.</>
                    : <>This customer has no email address on file, so there is nowhere to send it. Add one on the customer record first.</>}
                  {!isDraft && ' They will see this version in place of the one they already have.'}
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={saving || !recipient}
                    className="flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    {saving ? 'Sending…' : isDraft ? 'Send to customer' : 'Re-send to customer'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="rounded-full border border-white/25 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    Back to editing
                  </button>
                </div>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

// ─── Main QuoteBuilder ────────────────────────────────────────────────────────

export default function QuoteBuilder() {
  useDataRefresh();
  const { id }      = useParams();
  const navigate    = useNavigate();
  const [params]    = useSearchParams();
  const isEdit      = Boolean(id && id !== 'new');

  // Single front door: a quote is always created INSIDE a project (pre-filled
  // with the customer + measurements). If someone reaches the bare /quotes/new
  // with no project/customer context, send them to start a project instead of
  // re-entering the customer here — that double-entry is exactly what we removed.
  const nakedNewQuote = !isEdit && !params.get('jobId') && !params.get('customerId') && !params.get('measureSheetId');
  useEffect(() => {
    if (nakedNewQuote) navigate('/jobs/new', { replace: true });
  }, [nakedNewQuote, navigate]);

  const settings      = getQuoteSettings();
  const productTypes  = getActiveProductTypes();
  // Read once per render rather than per line — describeLine is called for
  // every row's header, and this is a localStorage parse.
  const wording = getQuoteWording();
  const customers     = getCustomers();
  // Active salespeople from Supabase — pending/suspended users never appear here
  const { salespeople: staff } = useActiveSalespeople();
  const savedItems    = getSavedItems();
  const pricedItems   = getPricedItems().filter(p => p.isActive !== false);
  const templates     = getQuoteTemplates();

  // Initialise form state
  const initForm = () => {
    if (isEdit) {
      const q = getQuote(id);
      return q || null;
    }
    // Pre-fill from query params
    const jobId = params.get('jobId');
    const measureSheetId = params.get('measureSheetId');
    const customerId = params.get('customerId');
    const job = jobId ? getJob(jobId) : null;
    const ms  = measureSheetId ? getMeasureSheet(measureSheetId) : null;
    const cust = customerId ? getCustomer(customerId) : (job ? getCustomer(job.customerId) : null);

    // Import line items from measure sheet using msItemToQuoteLine for proper desc + tracking
    let lineItems = [];
    if (ms?.lineItems?.length) {
      const curtainRates = getCurtainRates();
      const fabricLib   = getPricedItems();
      lineItems = ms.lineItems.map((li, i) => msItemToQuoteLine(li, i, curtainRates, fabricLib));
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + settings.defaultExpiryDays);

    return {
      id: uuidv4(),
      quoteNumber: '', // assigned on save
      version: 1,
      status: 'Draft',
      title: job ? `${cust?.name || ''} – Window Treatment` : '',
      customerId: cust?.id || customerId || '',
      jobId: job?.id || jobId || '',
      measureSheetId: ms?.id || measureSheetId || '',
      siteAddress: job?.siteAddress || cust?.address || '',
      introMessage: settings.defaultIntro || getMessagePresets().quoteIntroMessage,
      termsAndConditions: settings.defaultTerms || getMessagePresets().quoteTerms,
      internalNotes: job?.internalNotes || '',
      salesperson: job?.assignedStaff || '',
      expiryDate: expiry.toISOString().split('T')[0],
      followUpDate: '',
      depositType: settings.defaultDepositType,
      depositValue: settings.defaultDepositValue,
      includesGST: settings.includesGST,
      gstRate: settings.defaultGSTRate,
      sentAt: null, viewedAt: null, acceptedAt: null, declinedAt: null,
      acceptedBy: null,
      lineItems,
      // Attached on purpose from the Quote Details section — never inherited,
      // because a snapshot belongs to the quote that was priced against it.
      planSnapshot: null,
      activity: [],
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const [form, setForm]         = useState(initForm);
  const [saving, setSaving]     = useState(false);
  // Set by doSave when the mail service accepted the request but didn't confirm
  // the send — read by handleSaveAndSend so the toast doesn't over-promise.
  const sendUnconfirmedRef      = useRef(false);
  const [saved, setSaved]       = useState(false);
  const [errors, setErrors]     = useState({});
  // The quote snapshot being previewed before sending. Null when the overlay
  // is closed — sending is only reachable from inside it.
  const [sendPreview, setSendPreview] = useState(null);
  const [showSavedItems, setShowSavedItems] = useState(false);
  const [itemLibSearch, setItemLibSearch]   = useState('');
  const [showTemplates, setShowTemplates]   = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  // New state
  const [toast, setToast]           = useState(null);
  const [msSelection, setMsSelection] = useState(new Set());
  const [showMsImport, setShowMsImport] = useState(false);
  const [planBusy, setPlanBusy]     = useState(false);

  // Collapsed line items — start all collapsed on edit, start the first item
  // expanded on a brand-new quote (so the user sees the form immediately).
  const [expandedItems, setExpandedItems] = useState(() => {
    const initial = initForm();
    if (!initial) return new Set();
    // New quote with 1 empty item → expand it. Edit → all collapsed.
    if (!isEdit && initial.lineItems.length === 1) {
      return new Set([initial.lineItems[0].id]);
    }
    return new Set();
  });

  const toggleItem  = (itemId) => setExpandedItems(prev => {
    const next = new Set(prev);
    next.has(itemId) ? next.delete(itemId) : next.add(itemId);
    return next;
  });
  const expandItem  = (itemId) => setExpandedItems(prev => new Set([...prev, itemId]));

  // Redirecting a bare /quotes/new to the project flow — render nothing.
  if (nakedNewQuote) return null;

  if (!form) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Quote not found.</p>
      </div>
    );
  }

  // Toast helper
  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // ── Plan takeoff attachment ───────────────────────────────────────────────
  // Rendered to images and stored with the quote rather than linked live: the
  // customer page is anonymous (it can't read the private plan bucket), and a
  // quote should keep showing the plan it was priced against.
  const jobTakeoff = form.jobId ? getTakeoffByJob(form.jobId) : null;

  const attachPlan = async () => {
    if (!jobTakeoff) return;
    setPlanBusy(true);
    try {
      const previous = form.planSnapshot;
      const snapshot = await captureQuotePlan(jobTakeoff, form.id, {
        showSizes: form.planSnapshot?.showSizes ?? true,
        capturedBy: form.salesperson || '',
      });
      set('planSnapshot', snapshot);
      // Only bin the old images once the new ones are safely uploaded.
      if (previous) removeQuotePlan(previous);
      showToast('success', `Plan attached — ${snapshot.pages.length} page${snapshot.pages.length === 1 ? '' : 's'}, ${snapshot.schedule.length} openings.`);
    } catch (e) {
      console.error('[quote] attach plan', e);
      showToast('error', e?.message || 'Could not attach the plan.');
    } finally {
      setPlanBusy(false);
    }
  };

  const detachPlan = () => {
    const previous = form.planSnapshot;
    set('planSnapshot', null);
    if (previous) removeQuotePlan(previous);
    showToast('success', 'Plan removed from this quote.');
  };

  // Keyed by id, not index: the list is grouped by room for display, so its
  // on-screen order no longer matches the array and an index taken from the
  // rendering would edit or delete a different line entirely.
  const setLineItem = (itemId, field, value) => {
    setForm(f => ({
      ...f,
      lineItems: f.lineItems.map(li => li.id === itemId ? { ...li, [field]: value } : li),
    }));
  };

  // Cost every curtain line at once — the answer for a quote that already
  // exists (built before the calculator, or whose measurements have changed).
  // Lines the calculator can't fully price are counted and named rather than
  // part-costed, so nothing is silently under-quoted.
  const costAllCurtains = () => {
    const rates = getCurtainRates();
    const pricedItemsForFabric = getPricedItems();
    let costed = 0;
    const blocked = [];

    // Computed OUTSIDE the setForm updater: a functional updater can be invoked
    // later (and twice under StrictMode), so counting inside it would double-
    // count and leave the toast reading the tallies before they were filled.
    const nextLineItems = form.lineItems.map(li => {
      const result = autoCostCurtainLine(li, rates, pricedItemsForFabric);
      if (!result) return li;                       // not a curtain
      if (result.blocked) {
        blocked.push(li.location || li.description || 'Unnamed line');
        return li;
      }
      costed++;
      return {
        ...li,
        unitCostPrice:          result.unitCostPrice,
        labourCost:             result.labourCost,
        curtainFabricPricePerM: li.curtainFabricPricePerM || result.curtainFabricPricePerM,
      };
    });

    setForm(f => ({ ...f, lineItems: nextLineItems }));

    if (costed === 0 && blocked.length === 0) {
      showToast('info', 'No curtain lines with a width and drop to cost.');
    } else if (blocked.length) {
      showToast('info', `Costed ${costed} curtain${costed === 1 ? '' : 's'}. ${blocked.length} need${blocked.length === 1 ? 's' : ''} a heading or track first: ${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? '…' : ''}`);
    } else {
      showToast('success', `Costed ${costed} curtain line${costed === 1 ? '' : 's'} from their measurements.`);
    }
  };

  const addPartItem = (preset = {}) => {
    const newItem = EMPTY_PART_ITEM(preset);
    newItem.sortOrder = form.lineItems.length;
    setForm(f => ({ ...f, lineItems: [...f.lineItems, newItem] }));
  };

  const addLineItem = () => {
    const newItem = EMPTY_LINE_ITEM();
    newItem.sortOrder = form.lineItems.length;
    setForm(f => ({ ...f, lineItems: [...f.lineItems, newItem] }));
    expandItem(newItem.id); // auto-expand the new item so it's ready to fill in
  };

  /**
   * Duplicate a line, in place, as the next window in its room.
   *
   * A plain copy would land under the SAME letter as its original — which the
   * quote reads as two treatments on one window, not two windows. So a normal
   * line takes the next free letter in its room ("Bed 2 A" → "Bed 2 B"), which
   * is what duplicating a window actually means. Alternatives and parts keep
   * their location: another option for window B is still window B.
   */
  const duplicateLineItem = (itemId) => {
    setForm(f => {
      const idx = f.lineItems.findIndex(li => li.id === itemId);
      if (idx < 0) return f;
      const src = f.lineItems[idx];
      const copy = { ...src, id: uuidv4() };
      // The copy is a new window, not the one that was measured — keeping the
      // link would have two quote lines claiming the same measure-sheet item.
      copy.measureSheetLineItemId = null;
      copy.sourceMeasureSheetItemId = null;

      // Only re-letter where the room already uses letters. Lettering a room
      // that does not would rename every line in it — including the "choose
      // one" options and the optional extras, which are not windows and must
      // not take window letters. Left bare, the copy simply shows as the next
      // item in the room, which is already correct.
      const { letter } = splitRoomLabel(src.location || '');
      if (letter && src.type !== 'Multiple Choice' && src.type !== 'Part') {
        const { room } = splitRoomLabel(src.location || '');
        if (room) {
          const existing = f.lineItems.map(li => ({ id: li.id, label: li.location || '' }));
          const { label, renames } = nextRoomLabel(room, existing);
          copy.location = label;
          // nextRoomLabel may need to retro-letter a bare first window: the
          // moment a room has two, neither is "the" one any more.
          if (renames.length) {
            // A plain object, not a Map: lucide-react's `Map` icon is imported
            // into this module and shadows the global, so `new Map()` here
            // constructs a React component and throws.
            const byId = Object.fromEntries(renames.map(r => [r.id, r.to]));
            f = { ...f, lineItems: f.lineItems.map(li => byId[li.id] ? { ...li, location: byId[li.id] } : li) };
          }
        }
      }

      const items = [...f.lineItems];
      items.splice(idx + 1, 0, copy);
      // Renumber so the copy sorts immediately after its original rather than
      // inheriting a duplicate sortOrder and landing wherever ties fall.
      return { ...f, lineItems: items.map((li, i) => ({ ...li, sortOrder: i })) };
    });
  };

  const removeLineItem = (itemId) => {
    setForm(f => ({ ...f, lineItems: f.lineItems.filter(li => li.id !== itemId) }));
  };

  const addSavedItem = (si) => {
    const newItem = {
      ...EMPTY_LINE_ITEM(),
      productTypeId: si.productTypeId || '',
      productNameSnapshot: si.productNameSnapshot || '',
      description: si.description || '',
      unitCostPrice: si.unitCostPrice !== undefined ? si.unitCostPrice : '',
      labourCost: si.labourCost || '',
      marginPercent: si.marginPercent !== undefined ? si.marginPercent : DEFAULT_MARGIN_PERCENT,
      manualSellPrice: si.manualSellPrice !== undefined ? si.manualSellPrice : '',
      customerNotes: si.notes || '',
      sortOrder: form.lineItems.length,
    };
    setForm(f => ({ ...f, lineItems: [...f.lineItems, newItem] }));
    expandItem(newItem.id);
    setShowSavedItems(false);
  };

  const addPricedItem = (pi) => {
    const sell = pi.sellPrice > 0 ? pi.sellPrice : '';
    const newItem = {
      ...EMPTY_LINE_ITEM(),
      productNameSnapshot: pi.itemName || '',
      description:         pi.description || '',
      unitCostPrice:       pi.costPrice ?? '',
      labourCost:          pi.labourCost ?? '',
      marginPercent:       pi.marginPercent || DEFAULT_MARGIN_PERCENT,
      manualSellPrice:     sell,
      supplier:            pi.supplier || '',
      taxable:             pi.gstApplicable !== false,
      pricedItemId:        pi.id,
      pricedItemSnapshot:  { itemName: pi.itemName, itemCode: pi.itemCode, costPrice: pi.costPrice, sellPrice: pi.sellPrice, marginPercent: pi.marginPercent },
      sortOrder:           form.lineItems.length,
    };
    setForm(f => ({ ...f, lineItems: [...f.lineItems, newItem] }));
    expandItem(newItem.id);
    setShowSavedItems(false);
    setItemLibSearch('');
  };

  const applyTemplate = (tpl) => {
    setForm(f => ({
      ...f,
      introMessage: tpl.introMessage || f.introMessage,
      termsAndConditions: tpl.termsAndConditions || f.termsAndConditions,
      depositType: tpl.depositType || f.depositType,
      depositValue: tpl.depositValue || f.depositValue,
    }));
    setShowTemplates(false);
  };

  const validate = () => {
    const e = {};
    if (!form.customerId) e.customerId = 'Customer is required';
    if (!form.title.trim()) e.title = 'Quote title is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ─── Measure Sheet Import logic ───────────────────────────────────────────

  // Collect all relevant measure sheets: by job > by explicit MS id > by customer
  const linkedMsAll = (() => {
    if (form.jobId) {
      const ms = getMeasureSheetByJob(form.jobId);
      return ms ? [ms] : [];
    }
    if (form.measureSheetId) {
      const ms = getMeasureSheet(form.measureSheetId);
      return ms ? [ms] : [];
    }
    if (form.customerId) {
      return getMeasureSheets()
        .filter(ms => ms.customerId === form.customerId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return [];
  })();

  /**
   * Which measure sheet a quote line came from.
   *
   * The link back has to name a specific sheet — "open the measure sheet" that
   * opens the wrong one is worse than no link. Matched by the line's own
   * source id, falling back to the single linked sheet when there is only one.
   */
  const sheetIdForLine = (li) => {
    const srcId = li?.measureSheetLineItemId || li?.sourceMeasureSheetItemId;
    if (srcId) {
      const owner = linkedMsAll.find(ms => (ms.lineItems || []).some(x => x.id === srcId));
      if (owner) return owner.id;
    }
    return linkedMsAll.length === 1 ? linkedMsAll[0].id : null;
  };

  const msItems = linkedMsAll.flatMap(ms =>
    (ms.lineItems || []).map(li => ({ ...li, _msDate: ms.measureDate }))
  );

  // IDs of MS items already added to the quote
  const addedMsIds = new Set(
    form.lineItems
      .filter(li => li.measureSheetLineItemId)
      .map(li => li.measureSheetLineItemId)
  );

  const addSelectedFromMs = () => {
    if (msSelection.size === 0) return;
    const curtainRates = getCurtainRates();
    const fabricLib   = getPricedItems();
    const newLines = [];
    msItems.forEach(msLi => {
      if (!msSelection.has(msLi.id)) return;
      newLines.push(msItemToQuoteLine(msLi, form.lineItems.length + newLines.length, curtainRates, fabricLib));
    });
    setForm(f => ({ ...f, lineItems: [...f.lineItems, ...newLines] }));
    setMsSelection(new Set());
  };

  const toggleMsItem = (id) => {
    setMsSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllMs = () => setMsSelection(new Set(msItems.map(i => i.id)));
  const deselectAllMs = () => setMsSelection(new Set());

  // ─── Core save function ───────────────────────────────────────────────────

  // doSave: saves the quote (create or update), optionally sends it.
  // Returns the saved quote object on success, null on failure.
  // Does NOT navigate — callers decide what to do after.
  const doSave = async (andSend = false) => {
    if (!validate()) return null;
    setSaving(true);
    try {
      let q;
      // Stamp the customer-facing name onto every line before it is stored.
      // The public quote page has no product-type list to compose one from —
      // a customer's browser has no localStorage copy — so the name is
      // snapshotted here alongside productNameSnapshot, for the same reason.
      const saveForm = { ...form, lineItems: form.lineItems.map(li => ({
        ...li, displayName: describeLine(li, productTypes, wording),
      })) };
      if (isEdit) {
        const now = new Date().toISOString();
        saveQuote({ ...saveForm, updatedAt: now });
        addQuoteActivity(form.id, 'edited', 'Quote updated', form.salesperson || 'Admin');
        q = getQuote(form.id);
      } else {
        q = createQuote({ ...saveForm, status: 'Draft' });
      }
      if (andSend && q) {
        // Email first, mark Sent second — deliverQuote enforces that order, so
        // a quote is never left showing "Sent" (and counting down to expiry)
        // when nothing reached the customer. A missing email address now stops
        // the send with a message instead of silently skipping it.
        try {
          const { quote: sent, unconfirmed } = await deliverQuote(q, {
            user: form.salesperson || 'Admin',
            logActivity: true,
          });
          q = sent;
          sendUnconfirmedRef.current = unconfirmed;
        } catch (emailErr) {
          console.error('[QuoteBuilder] Quote send failed:', emailErr);
          setSaving(false);
          // Rethrown past the outer catch below so handleSaveAndSend can show
          // the real reason. The quote itself is saved — only the send failed.
          throw new SendFailed(emailErr.message, q);
        }
      }
      setSaving(false);
      return q;
    } catch (err) {
      if (err instanceof SendFailed) throw err;   // not a save failure — let it through
      console.error('Quote save error:', err);
      setSaving(false);
      return null;
    }
  };

  // isDraft: true when creating a new quote or editing a Draft-status quote
  const isDraft = !isEdit || form.status === 'Draft';

  const handleSaveDraft = async () => {
    const q = await doSave(false);
    if (q) {
      showToast('success', isDraft ? 'Draft saved successfully.' : 'Quote updated successfully.');
      setTimeout(() => navigate(`/quotes/${q.id}`), 800);
    } else {
      showToast('error', 'Could not save. Please fix errors and try again.');
    }
  };

  const handleSaveAndSend = async () => {
    let q = null;
    sendUnconfirmedRef.current = false;
    try {
      q = await doSave(true);
    } catch (err) {
      // The quote is saved and still a Draft — nothing went to the customer,
      // so say that plainly rather than implying it might have.
      showToast('error', `Quote saved as a draft — not sent. ${err.message}`);
      setSendPreview(null);
      const savedId = err.quote?.id || form.id;
      if (savedId) setTimeout(() => navigate(`/quotes/${savedId}`), 1400);
      return;
    }
    if (q) {
      const email = getCustomer(q.customerId)?.email || 'customer';
      const msg = sendUnconfirmedRef.current
        ? `Quote ${q.quoteNumber} was submitted, but delivery to ${email} wasn't confirmed.`
        : isDraft
          ? `Quote ${q.quoteNumber} sent to ${email}!`
          : `Quote ${q.quoteNumber} updated and re-sent to ${email}!`;
      showToast(sendUnconfirmedRef.current ? 'error' : 'success', msg);
      setSendPreview(null);
      setTimeout(() => navigate(`/quotes/${q.id}`), 900);
    } else {
      showToast('error', 'Could not save or send. Please fix errors and try again.');
    }
  };

  /**
   * Sending goes through the customer's own view first.
   *
   * The old button saved and sent in one click from the top of a long editing
   * form, which meant the last thing anyone looked at before it left was the
   * form — not the quote. This opens what the customer will actually receive,
   * and puts the send control past the end of it, so the quote gets read on
   * the way out.
   */
  const openSendPreview = () => {
    if (!validate()) {
      showToast('error', 'Fix the errors above before previewing.');
      return;
    }
    // A snapshot of the form as it stands — unsaved edits included, and
    // nothing is written or sent until Send is pressed at the bottom.
    setSendPreview({ ...form, lineItems: form.lineItems.map(li => ({
      ...li, displayName: describeLine(li, productTypes, wording),
    })) });
  };

  const handlePreview = async () => {
    if (isEdit) {
      // Silent save current state before opening preview
      try {
        saveQuote({ ...form, updatedAt: new Date().toISOString() });
      } catch (_) {}
      window.open(`/quotes/${form.id}/preview?preview=1`, '_blank');
      return;
    }
    // New quote: needs to be saved to get an ID before preview is possible
    if (!form.title.trim()) {
      showToast('error', 'Enter a quote title before previewing.');
      return;
    }
    setSaving(true);
    try {
      const q = createQuote({ ...form, status: 'Draft' });
      setSaving(false);
      window.open(`/quotes/${q.id}/preview?preview=1`, '_blank');
      navigate(`/quotes/${q.id}/edit`);
    } catch (err) {
      setSaving(false);
      showToast('error', 'Could not save before preview.');
    }
  };

  const totals = computeQuoteTotals(
    form.lineItems, form.depositType, form.depositValue, form.gstRate, form.includesGST,
    form.selectedLineItemIds || [], form.discountType, form.discountValue
  );

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.email?.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone?.includes(customerSearch)
  );

  const selectedCustomer = customers.find(c => c.id === form.customerId);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">

      {/* Preview & send — the customer's view with the send control past its end */}
      {sendPreview && (
        <SendPreviewOverlay
          quote={sendPreview}
          recipient={getCustomer(sendPreview.customerId)?.email || ''}
          isDraft={isDraft}
          saving={saving}
          onSend={handleSaveAndSend}
          onClose={() => setSendPreview(null)}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium transition-all ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header — buttons show icon+label on sm+, icon-only on mobile */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 truncate">{isEdit ? 'Edit Quote' : 'New Quote'}</h1>
            {form.quoteNumber && <p className="text-sm text-slate-400">{form.quoteNumber}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {saved && (
            <span className="hidden sm:flex items-center gap-1 text-green-600 text-sm font-medium mr-1">
              <Check size={14} /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={handlePreview}
            className="flex items-center gap-1.5 text-sm font-medium px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50"
            title="Preview"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            <span className="hidden sm:inline">Preview</span>
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex items-center gap-1.5 text-sm font-medium px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            title={isDraft ? 'Save Draft' : 'Save Changes'}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            <span className="hidden sm:inline">{isDraft ? 'Save Draft' : 'Save Changes'}</span>
          </button>
          <button
            type="button"
            onClick={openSendPreview}
            disabled={saving}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold px-3 sm:px-4 py-2 rounded-lg transition-colors"
            title={isDraft ? 'Preview & Send' : 'Preview & Re-send'}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            <span className="hidden sm:inline">{isDraft ? 'Preview & Send' : 'Preview & Re-send'}</span>
          </button>
        </div>
      </div>

      {/* Validation error banner */}
      {Object.keys(errors).length > 0 && (
        <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-red-700">
            <p className="font-medium">Please fix the following:</p>
            <ul className="mt-1 list-disc list-inside space-y-0.5">
              {Object.values(errors).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main form (2/3) ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Template bar */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowTemplates(t => !t)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
            >
              <BookOpen size={13} /> Use Template
            </button>
            {showTemplates && (
              <div className="flex gap-2 flex-wrap">
                {templates.map(tpl => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"
                  >
                    <Sparkles size={11} /> {tpl.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Section 1: Customer & Site */}
          <Section title="Customer & Site" icon={User} defaultOpen>
            <div className="pt-4 space-y-4">
              {/* Customer search */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Customer *</label>
                {selectedCustomer ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{selectedCustomer.name}</p>
                      <p className="text-xs text-slate-400">{selectedCustomer.phone} · {selectedCustomer.email}</p>
                    </div>
                    <button type="button" onClick={() => { set('customerId', ''); setCustomerSearch(''); }}
                      className="text-xs text-slate-400 hover:text-red-500">Change</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={customerSearch}
                      onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Search customers by name, phone, or email…"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    {customerSearch && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm max-h-48 overflow-y-auto">
                        {filteredCustomers.length === 0 ? (
                          <p className="text-xs text-slate-400 p-3 text-center">No customers found</p>
                        ) : filteredCustomers.slice(0, 8).map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              set('customerId', c.id);
                              if (!form.siteAddress) set('siteAddress', c.address || '');
                              setCustomerSearch('');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 text-left border-b border-slate-50 last:border-b-0"
                          >
                            <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                              {c.name[0]}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-800">{c.name}</p>
                              <p className="text-xs text-slate-400">{c.phone}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {errors.customerId && <p className="text-xs text-red-500">{errors.customerId}</p>}
                  </div>
                )}
              </div>

              {/* Site address */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Site Address</label>
                <AddressAutocomplete
                  value={form.siteAddress}
                  onChange={v => set('siteAddress', v)}
                  placeholder="Start typing an address…"
                />
              </div>
            </div>
          </Section>

          {/* Section 2: Quote Details */}
          <Section title="Quote Details" icon={FileText} defaultOpen>
            <div className="pt-4 space-y-4">
              <FieldInput
                label="Quote Title *"
                value={form.title}
                onChange={v => set('title', v)}
                placeholder="e.g. Brighton Residence – Full Window Treatment"
              />
              {errors.title && <p className="text-xs text-red-500 -mt-2">{errors.title}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Salesperson</label>
                  <select value={form.salesperson} onChange={e => set('salesperson', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                    <option value="">Select staff member…</option>
                    {staff.map(s => <option key={s.id} value={s.fullName}>{s.fullName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Expiry Date</label>
                  <input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Introduction Message (customer-facing)</label>
                <textarea
                  value={form.introMessage}
                  onChange={e => set('introMessage', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>

              <PlanAttachment
                takeoff={jobTakeoff}
                snapshot={form.planSnapshot}
                busy={planBusy}
                onAttach={attachPlan}
                onDetach={detachPlan}
                onToggleSizes={(v) => set('planSnapshot', { ...form.planSnapshot, showSizes: v })}
              />
            </div>
          </Section>

          {/* Measure Sheet Import Card */}
          <Card>
            {/* Header row */}
            <div className="px-5 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <ClipboardList size={15} className="text-slate-400" />
                From Measure Sheet
                <span className="text-xs font-normal text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                  {msItems.length} item{msItems.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setShowMsImport(s => !s)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showMsImport ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {showMsImport && (
              <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                {linkedMsAll.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    No measure sheet found. Select a customer or link a job to see measure sheet items.
                  </div>
                ) : msItems.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    The linked measure sheet has no line items.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Top row: Select All / Deselect All + count badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={selectAllMs}
                          className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                        >
                          Select All
                        </button>
                        <span className="text-slate-300 text-xs">|</span>
                        <button
                          type="button"
                          onClick={deselectAllMs}
                          className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                        >
                          Deselect All
                        </button>
                      </div>
                      {msSelection.size > 0 && (
                        <span className="text-xs font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                          {msSelection.size} selected
                        </span>
                      )}
                    </div>

                    {/* MS items list */}
                    <div className="space-y-2">
                      {msItems.map(msLi => {
                        const isSelected = msSelection.has(msLi.id);
                        const isAdded = addedMsIds.has(msLi.id);
                        const clientDesc = genClientDesc(msLi);
                        return (
                          <div
                            key={msLi.id}
                            className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-amber-50 border-amber-200'
                                : 'bg-white border-slate-200 hover:bg-slate-50'
                            }`}
                            onClick={() => toggleMsItem(msLi.id)}
                          >
                            {/* Checkbox */}
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMsItem(msLi.id)}
                              onClick={e => e.stopPropagation()}
                              className="mt-0.5 accent-amber-500 flex-shrink-0"
                            />

                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isAdded && (
                                  <span className="text-[10px] font-semibold bg-green-100 text-green-700 rounded-full px-2 py-0.5 border border-green-200">
                                    Added
                                  </span>
                                )}
                                {msLi.location && (
                                  <span className="text-xs text-slate-500">{msLi.location}</span>
                                )}
                                <span className="text-sm font-medium text-slate-800">
                                  {msLi.productNameSnapshot || msLi.productType || '—'}
                                </span>
                                {msLi.fabricColour && (
                                  <span className="text-xs text-slate-400 italic">{msLi.fabricColour}</span>
                                )}
                                {Number(msLi.quantity) > 1 && (
                                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                                    ×{msLi.quantity}
                                  </span>
                                )}
                                {(msLi.widthMm || msLi.width) && (msLi.dropMm || msLi.drop) && (
                                  <span className="text-[10px] font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                                    {msLi.widthMm || msLi.width}×{msLi.dropMm || msLi.drop}mm
                                  </span>
                                )}
                              </div>
                              {clientDesc && (
                                <p className="text-xs text-slate-400">{clientDesc}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Bottom action bar */}
                    <div className="pt-2 border-t border-slate-100 flex justify-end">
                      <button
                        type="button"
                        onClick={addSelectedFromMs}
                        disabled={msSelection.size === 0}
                        className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <Plus size={14} />
                        Add {msSelection.size > 0 ? msSelection.size : ''} Selected
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Section 3: Line Items */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Package size={15} className="text-slate-400" />
                Line Items
                <span className="text-xs font-normal text-slate-400">({form.lineItems.length} item{form.lineItems.length !== 1 ? 's' : ''})</span>
              </h2>
              <div className="flex gap-2">
                {/* Item library (saved items + priced items) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setShowSavedItems(s => !s); setItemLibSearch(''); }}
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                  >
                    <BookOpen size={12} /> Item Library
                  </button>
                  {showSavedItems && (
                    <div className="absolute right-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden flex flex-col">
                      <div className="px-3 py-2 border-b border-slate-100">
                        <input
                          autoFocus
                          value={itemLibSearch}
                          onChange={e => setItemLibSearch(e.target.value)}
                          placeholder="Search items…"
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {/* Saved items section */}
                        {savedItems.filter(si => !itemLibSearch || si.name.toLowerCase().includes(itemLibSearch.toLowerCase())).length > 0 && (
                          <>
                            <p className="text-xs font-semibold text-slate-400 px-3 py-1.5 bg-slate-50 sticky top-0">Saved Items</p>
                            {savedItems
                              .filter(si => !itemLibSearch || si.name.toLowerCase().includes(itemLibSearch.toLowerCase()))
                              .map(si => (
                                <button key={si.id} type="button" onClick={() => addSavedItem(si)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-amber-50 text-left border-b border-slate-50">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700 truncate">{si.name}</p>
                                    <p className="text-xs text-slate-400">Sell: {si.manualSellPrice ? `$${si.manualSellPrice}` : 'calc'} · Labour: ${si.labourCost || 0}</p>
                                  </div>
                                  <Plus size={13} className="text-amber-500 flex-shrink-0"/>
                                </button>
                              ))}
                          </>
                        )}
                        {/* Priced items library section */}
                        {pricedItems.filter(pi => !itemLibSearch || pi.itemName.toLowerCase().includes(itemLibSearch.toLowerCase()) || (pi.itemCode || '').toLowerCase().includes(itemLibSearch.toLowerCase())).length > 0 && (
                          <>
                            <p className="text-xs font-semibold text-slate-400 px-3 py-1.5 bg-slate-50 sticky top-0">Priced Items Library</p>
                            {pricedItems
                              .filter(pi => !itemLibSearch || pi.itemName.toLowerCase().includes(itemLibSearch.toLowerCase()) || (pi.itemCode || '').toLowerCase().includes(itemLibSearch.toLowerCase()))
                              .map(pi => (
                                <button key={pi.id} type="button" onClick={() => addPricedItem(pi)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-amber-50 text-left border-b border-slate-50">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700 truncate">{pi.itemName}</p>
                                    <p className="text-xs text-slate-400">
                                      {pi.itemCode && <span className="font-mono mr-1">{pi.itemCode}</span>}
                                      {pi.sellPrice > 0 ? `$${pi.sellPrice.toFixed(2)}` : pi.marginPercent ? `${pi.marginPercent.toFixed(0)}% margin` : 'no price'}
                                    </p>
                                  </div>
                                  <Plus size={13} className="text-amber-500 flex-shrink-0"/>
                                </button>
                              ))}
                          </>
                        )}
                        {itemLibSearch && savedItems.filter(si => si.name.toLowerCase().includes(itemLibSearch.toLowerCase())).length === 0 && pricedItems.filter(pi => pi.itemName.toLowerCase().includes(itemLibSearch.toLowerCase())).length === 0 && (
                          <p className="text-xs text-slate-400 px-3 py-4 text-center">No items match "{itemLibSearch}"</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {form.lineItems.some(li => isCurtainProduct(li.productNameSnapshot)) && (
                  <button
                    type="button"
                    onClick={costAllCurtains}
                    title="Cost every curtain line from its width, drop, heading and track"
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700 transition-colors"
                  >
                    <Calculator size={12} /> Cost Curtains
                  </button>
                )}
                <button
                  type="button"
                  onClick={addLineItem}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white transition-colors"
                >
                  <Plus size={12} /> Add Item
                </button>
                <button
                  type="button"
                  onClick={() => addPartItem()}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white transition-colors"
                >
                  <Package size={12} /> Add Part
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Said once at the top as well as on each line: on a long quote
                  the unpriceable curtain is below the fold, and a quote that
                  goes out with a $0 curtain on it is the failure this exists
                  to prevent. */}
              {(() => {
                const stuck = form.lineItems
                  .filter(li => isCurtainProduct(li.productNameSnapshot))
                  .map(li => ({ li, costed: autoCostCurtainLine(li, getCurtainRates(), getPricedItems()) }))
                  .filter(x => x.costed?.blocked);
                if (!stuck.length) return null;
                return (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    <div className="text-xs text-amber-900">
                      <p className="font-semibold">
                        {stuck.length} curtain{stuck.length === 1 ? '' : 's'} can&rsquo;t be priced yet.
                      </p>
                      <p className="mt-0.5 text-amber-800">
                        {stuck.map(x => x.li.location || x.li.productNameSnapshot || 'Unnamed line').join(', ')}
                        {' — '}each says what it needs on the line below.
                      </p>
                    </div>
                  </div>
                );
              })()}
              {form.lineItems.length === 0 ? (
                <div className="text-center py-8">
                  <Package size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm text-slate-400">No items yet. Add a line item or import from a saved item.</p>
                </div>
              ) : (
                quoteSections(form.lineItems).map(({ room, entries }) => (
                  <section key={room} className="space-y-3">
                    {/* Room subheading — the same one the customer sees */}
                    <div className="flex items-baseline justify-between gap-3 pt-1">
                      <h4 className="text-base font-semibold text-slate-800">{room}</h4>
                      <span className="text-[11px] text-slate-400">
                        {entries.length} item{entries.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <hr className="border-slate-100" />
                    {entries.map(entry => (
                      <div key={entry.key} className="flex items-start gap-2.5">
                        {/* A / B / C — the window reference, read straight out
                            of the location the same way the customer page and
                            the purchase order read it. */}
                        {entry.ref && (
                          <span className="flex-shrink-0 w-6 h-6 mt-2 rounded-full border border-slate-200 bg-white text-[11px] font-medium text-slate-600 flex items-center justify-center">
                            {entry.ref}
                          </span>
                        )}
                        <div className="flex-1 min-w-0 space-y-2.5">
                          {entry.blocks.map(block => (
                            <div key={block.key} className="space-y-1.5">
                              {block.eyebrow && (
                                <div className="flex items-center gap-2">
                                  <span className={`block w-3.5 h-0.5 flex-shrink-0 ${block.kind === 'choice' ? 'bg-purple-400' : 'bg-amber-400'}`} />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                    {block.eyebrow}
                                    {block.kind === 'choice' && block.required && ' · required'}
                                  </span>
                                </div>
                              )}
                              <div className={block.kind === 'choice'
                                ? 'space-y-2 rounded-xl border border-purple-100 bg-purple-50/40 p-2.5'
                                : 'space-y-2'}>
                                {block.items.map(item => (
                                  <LineItemCard
                                    key={item.id}
                                    item={item}
                                    productTypes={productTypes}
                                    wording={wording}
                                    onChange={setLineItem}
                                    onRemove={removeLineItem}
                                    onDuplicate={duplicateLineItem}
                                    measureSheetId={sheetIdForLine(item)}
                                    navigate={navigate}
                                    canRemove={form.lineItems.length > 0}
                                    isExpanded={expandedItems.has(item.id)}
                                    onToggle={() => toggleItem(item.id)}
                                    inBlock={!!block.eyebrow}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                ))
              )}

              {form.lineItems.length > 0 && (
                <button
                  type="button"
                  onClick={addLineItem}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 hover:border-amber-400 hover:text-amber-600 transition-colors"
                >
                  <Plus size={15} /> Add Another Item
                </button>
              )}

              {/* Parts & Accessories quick-add */}
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mb-2">
                  <Package size={12} /> Parts &amp; Accessories — quick add
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_PARTS.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => addPartItem(p)}
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50 text-slate-600 transition-colors"
                    >
                      <Plus size={11} /> {p.name} <span className="text-slate-400">${p.price}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => addPartItem()}
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-slate-500 hover:text-slate-600 transition-colors"
                  >
                    <Plus size={11} /> Custom part…
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Section 4: Terms & Conditions */}
          <Section title="Terms & Conditions" icon={FileText} defaultOpen={false}>
            <div className="pt-4">
              <textarea
                value={form.termsAndConditions}
                onChange={e => set('termsAndConditions', e.target.value)}
                rows={5}
                placeholder="Enter your terms and conditions…"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            </div>
          </Section>

          {/* Section 5: Deposit & GST */}
          <Section title="Deposit & Pricing Settings" icon={DollarSign} defaultOpen={false}>
            <div className="pt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Deposit Type</label>
                  <select value={form.depositType} onChange={e => set('depositType', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                    {DEPOSIT_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {form.depositType !== 'None' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      {form.depositType === 'Percentage' ? 'Deposit %' : 'Deposit Amount ($)'}
                    </label>
                    <input
                      type="number"
                      value={form.depositValue}
                      onChange={e => set('depositValue', Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">GST Rate</label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.includesGST}
                        onChange={e => set('includesGST', e.target.checked)}
                        className="accent-amber-500"
                      />
                      Include GST ({form.gstRate}%)
                    </label>
                  </div>
                </div>
              </div>
              {/* Quote-level discount */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Overall Discount</label>
                  <select value={form.discountType || 'None'} onChange={e => set('discountType', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                    {['None', 'Percentage', 'Fixed Amount'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {form.discountType && form.discountType !== 'None' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      {form.discountType === 'Percentage' ? 'Discount %' : 'Discount Amount ($)'}
                    </label>
                    <input
                      type="number"
                      value={form.discountValue || ''}
                      onChange={e => set('discountValue', Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                )}
              </div>
              {/* Size visibility */}
              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showSizesToClient || false}
                    onChange={e => set('showSizesToClient', e.target.checked)}
                    className="mt-0.5 accent-amber-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Show dimensions to client</p>
                    <p className="text-xs text-slate-400 mt-0.5">When enabled, width × drop measurements will be visible on the customer-facing quote. Off by default — keep sizes internal.</p>
                  </div>
                </label>
              </div>
            </div>
          </Section>

          {/* Section 6: Internal Notes */}
          <Section title="Internal Notes" icon={Settings} defaultOpen={false}>
            <div className="pt-4">
              <textarea
                value={form.internalNotes}
                onChange={e => set('internalNotes', e.target.value)}
                rows={3}
                placeholder="Internal notes — not visible to customer…"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-yellow-50"
              />
            </div>
          </Section>
        </div>

        {/* ── Sidebar (1/3) ────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Quote Totals */}
          <Card className="p-5 sticky top-6">
            <h2 className="font-semibold text-slate-800 text-sm mb-4">Quote Summary</h2>

            {/* Item type breakdown — only the types that count toward the total
                below (Required + Part), so the figures reconcile. Optional /
                Multiple-Choice add-ons aren't in the total and are shown in the
                line-item list instead. */}
            <div className="space-y-1.5 mb-4">
              {['Required', 'Part'].map(type => {
                const count = form.lineItems.filter(li => li.type === type).length;
                if (count === 0) return null;
                const typeTotal = form.lineItems
                  .filter(li => li.type === type)
                  .reduce((s, li) => {
                    const { lineTotal } = linePricing(li);
                    return s + lineTotal;
                  }, 0);
                return (
                  <div key={type} className="flex justify-between text-xs text-slate-500">
                    <span>{count}× {type}</span>
                    <span>{fmt(typeTotal)}</span>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              {totals.discount > 0 && (
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span>{fmt(totals.grossSubtotal)}</span>
                </div>
              )}
              {totals.discount > 0 && (
                <div className="flex justify-between text-sm text-amber-700">
                  <span>Discount {form.discountType === 'Percentage' ? `(${form.discountValue}%)` : ''}</span>
                  <span>− {fmt(totals.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal (excl. GST)</span>
                <span>{fmt(totals.subtotal)}</span>
              </div>
              {form.includesGST && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>GST ({form.gstRate}%)</span>
                  <span>{fmt(totals.gst)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>Total</span>
                <span>{fmt(totals.total)}</span>
              </div>
              {/* Margin — internal only; never rendered on the customer's copy. */}
              {totals.margin !== null ? (
                <div className="flex justify-between text-sm font-medium text-emerald-700 mt-1 pt-2 border-t border-dashed border-slate-200">
                  <span className="flex items-center gap-1.5">Margin <span className="text-[10px] font-normal text-slate-400 uppercase tracking-wide">internal</span></span>
                  <span>{fmt(totals.margin)}{totals.marginPercent !== null ? ` · ${Math.round(totals.marginPercent)}%` : ''}</span>
                </div>
              ) : (
                <div className="flex justify-between text-xs text-slate-400 mt-1 pt-2 border-t border-dashed border-slate-200">
                  <span>Margin</span>
                  <span>no cost data</span>
                </div>
              )}
              {totals.deposit > 0 && (
                <div className="flex justify-between text-sm text-amber-700 font-semibold bg-amber-50 rounded-lg px-3 py-2 mt-1">
                  <span>Deposit ({form.depositType === 'Percentage' ? `${form.depositValue}%` : 'Fixed'})</span>
                  <span>{fmt(totals.deposit)}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={openSendPreview}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                {isDraft ? 'Preview & Send' : 'Preview & Re-send'}
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium py-2.5 rounded-xl transition-colors text-sm"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isDraft ? 'Save Draft' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={handlePreview}
                className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 font-medium py-2 rounded-xl transition-colors text-sm"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Customer Preview
              </button>
            </div>
          </Card>

          {/* Linked job info */}
          {form.jobId && (() => {
            const job = getJob(form.jobId);
            return job ? (
              <Card className="p-5">
                <h3 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5"><ClipboardList size={13} /> Linked Job</h3>
                <p className="text-xs text-slate-400 mb-0.5">{job.jobNumber}</p>
                <p className="text-sm font-medium text-slate-700 mb-2">{job.title}</p>
                <button onClick={() => navigate(`/jobs/${job.id}`)} className="text-xs text-amber-600 hover:underline">View job →</button>
              </Card>
            ) : null;
          })()}
        </div>
      </div>
    </div>
  );
}
