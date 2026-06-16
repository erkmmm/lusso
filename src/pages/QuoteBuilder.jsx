import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useCallback } from 'react';
import { useActiveSalespeople } from '../hooks/useActiveSalespeople';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Eye, Send, Save,
  User, FileText, Settings, DollarSign, ChevronRight, GripVertical,
  Package, ClipboardList, BookOpen, Sparkles, Info, Check, Copy,
  AlertCircle, CheckCircle2, X, Loader2, ExternalLink,
} from 'lucide-react';
import BackButton from '../components/BackButton';
import AddressAutocomplete from '../components/AddressAutocomplete';
import {
  getQuote, getCustomers, getCustomer, getMeasureSheet, getMeasureSheets, getJob,
  getActiveProductTypes, getSavedItems, getPricedItems, getQuoteTemplates, getQuoteSettings,
  CONTROL_OPTIONS, RETURN_OPTIONS, MOTOR_SIDE_OPTIONS, FIXING_OPTIONS,
  HEADING_OPTIONS, HEM_OPTIONS, TRACK_COLOUR_OPTIONS, BASE_BAR_COLOUR_OPTIONS, BASE_BAR_TYPE_OPTIONS, CHAIN_COLOUR_OPTIONS,
  computeQuoteTotals, calcItemPricing, QUOTE_ITEM_TYPES, DEPOSIT_TYPES,
  createQuote, saveQuote, sendQuote, addQuoteActivity,
  getMeasureSheetByJob, addActivity, getMessagePresets,
} from '../store/data';
import Card from '../components/Card';
import { sendQuoteEmail } from '../lib/email';
import PricedItemPicker from '../components/PricedItemPicker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  location: '',
  productTypeId: '',
  productNameSnapshot: preset.name || '',
  description: preset.description || '',
  quantity: 1,
  widthMm: '', dropMm: '', fabricColour: '',
  control: '', returnSide: '', motorSide: '', fixing: '',
  heading: '', hem: '', trackColour: '', baseBarColour: '', trackBaseBarColour: '',
  baseBarType: '', chainColour: '',
  unitCostPrice: '', labourCost: '', marginPercent: 40,
  manualSellPrice: preset.price || '',
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
  unitCostPrice: '',
  labourCost: '',
  marginPercent: 40,
  manualSellPrice: '',
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
function msItemToQuoteLine(msLi, sortOrder) {
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

// ─── LineItemCard ─────────────────────────────────────────────────────────────

function LineItemCard({ item, idx, productTypes, onChange, onRemove, canRemove, isExpanded, onToggle }) {
  const [showSpecs, setShowSpecs] = useState(false);
  const [showPricing, setShowPricing] = useState(true);

  const set = (field, value) => onChange(idx, field, value);

  const pricing = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
  const { finalSell, lineTotal, grossProfit, gpPercent, totalCost, calcSell } = pricing;

  const TYPE_COLORS = {
    Required:         'bg-slate-100 text-slate-700 border-slate-200',
    Optional:         'bg-amber-100 text-amber-700 border-amber-200',
    'Multiple Choice':'bg-purple-100 text-purple-700 border-purple-200',
    Part:             'bg-cyan-100 text-cyan-700 border-cyan-200',
  };

  // Quick summary shown in the collapsed chip row
  const specs = [
    item.quantity > 1 ? `×${item.quantity}` : null,
    item.widthMm ? `${item.widthMm}W` : null,
    item.dropMm  ? `${item.dropMm}D`  : null,
    item.fabricColour || null,
    item.control || null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`border rounded-xl overflow-hidden bg-white transition-shadow ${isExpanded ? 'border-amber-300 shadow-sm' : 'border-slate-200'}`}>
      {/* ── Header — always visible, click to expand/collapse ── */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-4 py-3 text-left transition-colors ${isExpanded ? 'bg-amber-50 border-b border-amber-100' : 'bg-slate-50 hover:bg-slate-100'}`}
      >
        {/* Number badge */}
        <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 transition-colors ${isExpanded ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {idx + 1}
        </div>
        {/* Title + specs summary */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800 truncate block">
            {item.location || <span className="text-slate-400 font-normal">New Item</span>}
            {item.productNameSnapshot ? <span className="text-slate-500 font-normal"> · {item.productNameSnapshot}</span> : ''}
          </span>
          {!isExpanded && specs && (
            <span className="text-xs text-slate-400 truncate block">{specs}</span>
          )}
        </div>
        {/* Type badge */}
        {item.type !== 'Required' && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${TYPE_COLORS[item.type] || TYPE_COLORS.Required}`}>
            {item.type}
          </span>
        )}
        {/* Line total */}
        <span className="text-sm font-bold text-slate-800 flex-shrink-0 ml-1">{fmt(lineTotal)}</span>
        {/* Chevron */}
        <span className="text-slate-400 flex-shrink-0 ml-1">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
        {/* Remove button — stop propagation so it doesn't toggle */}
        {canRemove && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRemove(idx); }}
            className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0 p-1 -mr-1"
          >
            <Trash2 size={14} />
          </button>
          )}
      </button>

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
          {/* Qty + Price */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FieldInput label="Qty" value={item.quantity} onChange={v => set('quantity', v)} type="number" placeholder="1" />
            <FieldInput label="Sell Price (each)" value={item.manualSellPrice} onChange={v => set('manualSellPrice', v)} type="number" placeholder="0.00" prefix="$" />
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Line Total</label>
              <p className="text-sm font-bold text-amber-700 py-1.5">{fmt(Number(item.manualSellPrice || 0) * Number(item.quantity || 1))}</p>
            </div>
          </div>
          {/* Supplier + taxable */}
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="Supplier 🔒" value={item.supplier} onChange={v => set('supplier', v)} placeholder="e.g. Acmeda" />
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Taxable</label>
              <button type="button" onClick={() => set('taxable', !item.taxable)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${item.taxable ? 'bg-green-50 border-green-300 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                {item.taxable ? 'GST Applicable' : 'GST Free'}
              </button>
            </div>
          </div>
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
          <FieldInput label="Location / Room" value={item.location} onChange={v => set('location', v)} placeholder="e.g. Master Bedroom" />
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
          <div className="bg-slate-50 rounded-xl p-3 space-y-3">
            {/* Cost inputs row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FieldInput label="Material Cost 🔒" value={item.unitCostPrice} onChange={v => set('unitCostPrice', v)} type="number" placeholder="0.00" prefix="$" />
              <FieldInput label="Labour Cost 🔒" value={item.labourCost} onChange={v => set('labourCost', v)} type="number" placeholder="0.00" prefix="$" />
              <FieldInput label="Margin % 🔒" value={item.marginPercent} onChange={v => set('marginPercent', v)} type="number" placeholder="40" />
              <FieldInput label="Supplier 🔒" value={item.supplier} onChange={v => set('supplier', v)} placeholder="e.g. Acmeda" />
            </div>
            {/* Sell price row */}
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

            {/* GP row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1.5 border-t border-slate-200">
              <span className="text-xs text-slate-400">Cost: <span className="font-medium text-slate-600">{fmt(totalCost * (Number(item.quantity)||1))}</span></span>
              <span className="text-xs text-slate-400">GP: <span className={`font-semibold ${grossProfit * (Number(item.quantity)||1) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(grossProfit * (Number(item.quantity)||1))}</span></span>
              <span className="text-xs text-slate-400">GP%: <span className={`font-semibold ${gpPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>{gpPercent.toFixed(1)}%</span></span>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="grid sm:grid-cols-2 gap-3">
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
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Choice Group Name</label>
            <input
              value={item.choiceGroupId || ''}
              onChange={e => set('choiceGroupId', e.target.value)}
              placeholder="e.g. motor-upgrade (items with same group are shown as alternatives)"
              className="w-full px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
        )}
      </div>}
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

  const settings      = getQuoteSettings();
  const productTypes  = getActiveProductTypes();
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
      lineItems = ms.lineItems.map((li, i) => msItemToQuoteLine(li, i));
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + settings.defaultExpiryDays);

    return {
      id: uuidv4(),
      quoteNumber: '', // assigned on save
      version: 1,
      status: 'Draft',
      title: job ? `${cust?.name || ''} – ${job.jobType || 'Window Treatment'}` : '',
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
      activity: [],
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const [form, setForm]         = useState(initForm);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [errors, setErrors]     = useState({});
  const [showSavedItems, setShowSavedItems] = useState(false);
  const [itemLibSearch, setItemLibSearch]   = useState('');
  const [showTemplates, setShowTemplates]   = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  // New state
  const [toast, setToast]           = useState(null);
  const [msSelection, setMsSelection] = useState(new Set());
  const [showMsImport, setShowMsImport] = useState(false);

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

  if (!form) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Quote not found.</p>
        <BackButton fallback="/quotes" className="mt-2" />
      </div>
    );
  }

  // Toast helper
  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const setLineItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.lineItems];
      items[idx] = { ...items[idx], [field]: value };
      return { ...f, lineItems: items };
    });
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

  const removeLineItem = (idx) => {
    setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }));
  };

  const addSavedItem = (si) => {
    const newItem = {
      ...EMPTY_LINE_ITEM(),
      productTypeId: si.productTypeId || '',
      productNameSnapshot: si.productNameSnapshot || '',
      description: si.description || '',
      unitCostPrice: si.unitCostPrice !== undefined ? si.unitCostPrice : '',
      labourCost: si.labourCost || '',
      marginPercent: si.marginPercent !== undefined ? si.marginPercent : 40,
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
      marginPercent:       pi.marginPercent || 40,
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
    const newLines = [];
    msItems.forEach(msLi => {
      if (!msSelection.has(msLi.id)) return;
      newLines.push(msItemToQuoteLine(msLi, form.lineItems.length + newLines.length));
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
      if (isEdit) {
        const now = new Date().toISOString();
        saveQuote({ ...form, updatedAt: now });
        addQuoteActivity(form.id, 'edited', 'Quote updated', form.salesperson || 'Admin');
        q = getQuote(form.id);
      } else {
        q = createQuote({ ...form, status: 'Draft' });
      }
      if (andSend && q) {
        // Mark quote as sent in local store
        sendQuote(q.id, form.salesperson || 'Admin');
        if (form.jobId) {
          addActivity({
            jobId: form.jobId,
            type: 'quote_sent',
            message: `Quote ${q.quoteNumber} sent to customer`,
            user: form.salesperson || 'Admin',
          });
        }
        q = getQuote(q.id); // refresh after send

        // Actually send the email
        const customer = getCustomer(q.customerId);
        if (customer?.email) {
          try {
            await sendQuoteEmail(q, customer, getMessagePresets().quoteEmailIntro);
          } catch (emailErr) {
            console.error('[QuoteBuilder] Email send failed:', emailErr);
            // Still return the quote — save succeeded even if email failed
            setSaving(false);
            throw emailErr; // bubble up so handleSaveAndSend can show the error
          }
        }
      }
      setSaving(false);
      return q;
    } catch (err) {
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
    try {
      q = await doSave(true);
    } catch (emailErr) {
      showToast('error', `Quote saved but email failed: ${emailErr.message}`);
      const savedId = form.id;
      if (savedId) setTimeout(() => navigate(`/quotes/${savedId}`), 900);
      return;
    }
    if (q) {
      const email = getCustomer(q.customerId)?.email || 'customer';
      const msg = isDraft
        ? `Quote ${q.quoteNumber} sent to ${email}!`
        : `Quote ${q.quoteNumber} updated and re-sent to ${email}!`;
      showToast('success', msg);
      setTimeout(() => navigate(`/quotes/${q.id}`), 900);
    } else {
      showToast('error', 'Could not save or send. Please fix errors and try again.');
    }
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
    form.lineItems, form.depositType, form.depositValue, form.gstRate, form.includesGST
  );

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.email?.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone?.includes(customerSearch)
  );

  const selectedCustomer = customers.find(c => c.id === form.customerId);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">

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
          <BackButton fallback={form?.jobId ? `/jobs/${form.jobId}` : '/quotes'} />
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
            onClick={handleSaveAndSend}
            disabled={saving}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold px-3 sm:px-4 py-2 rounded-lg transition-colors"
            title={isDraft ? 'Save & Send' : 'Save & Re-send'}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span className="hidden sm:inline">{isDraft ? 'Save & Send' : 'Save & Re-send'}</span>
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

      <div className="grid lg:grid-cols-3 gap-6">
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

              <div className="grid sm:grid-cols-2 gap-3">
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
              {form.lineItems.length === 0 ? (
                <div className="text-center py-8">
                  <Package size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm text-slate-400">No items yet. Add a line item or import from a saved item.</p>
                </div>
              ) : (
                form.lineItems.map((item, idx) => (
                  <LineItemCard
                    key={item.id}
                    item={item}
                    idx={idx}
                    productTypes={productTypes}
                    onChange={setLineItem}
                    onRemove={removeLineItem}
                    canRemove={form.lineItems.length > 0}
                    isExpanded={expandedItems.has(item.id)}
                    onToggle={() => toggleItem(item.id)}
                  />
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
              <div className="grid sm:grid-cols-3 gap-3">
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

            {/* Item type breakdown */}
            <div className="space-y-1.5 mb-4">
              {['Required', 'Optional', 'Multiple Choice'].map(type => {
                const count = form.lineItems.filter(li => li.type === type).length;
                if (count === 0) return null;
                const typeTotal = form.lineItems
                  .filter(li => li.type === type)
                  .reduce((s, li) => {
                    const { lineTotal } = calcItemPricing(li.unitCostPrice, li.labourCost, li.marginPercent, li.manualSellPrice, li.quantity);
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
                onClick={handleSaveAndSend}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {isDraft ? 'Save & Send' : 'Save & Re-send'}
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
