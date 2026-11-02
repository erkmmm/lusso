/**
 * What a measure-sheet line is still missing, asked at the moment it turns
 * into a quote.
 *
 * A measure sheet is filled in on a ladder, often in a hurry, and the fields
 * that get skipped are never random: the operation type nobody had decided
 * yet, the fixing that depended on what the architrave looked like, the drop
 * on the window that was behind the couch. None of that stops the sheet being
 * saved — and it shouldn't, because a half-filled sheet beats no sheet.
 *
 * It stops mattering later and starts mattering here. A line with no drop
 * can't be costed, so the quote carries a $0 and somebody prices it by hand;
 * a line with no fixing prices fine and then can't be ordered, which is found
 * out a week later by the factory. Both were invisible on the way through: you
 * picked a sheet, pressed Create Quote, and the holes came with it.
 *
 * So this is the list of holes, per line, each one either fillable right there
 * or dismissable — because plenty of them are deliberate. A roller blind with
 * no chain colour is a motorised blind. "Nothing is missing" and "I know, it's
 * fine" are different answers and the second one has to be sayable, or the
 * warning becomes noise and gets scrolled past.
 *
 * Two tiers, by consequence rather than by field:
 *
 *   price — the line cannot be costed without it. Width, drop, no product at
 *           all, and everything the curtain calculator says it is missing.
 *   order — the line prices, but the factory cannot make it. The spec fields,
 *           and the fabric.
 *
 * Nothing here blocks anything. It is a list, with the fix next to it.
 */

import {
  MS_SPEC_FIELDS, getTypeSpecKeys, specHasValue, getMsOptions,
} from '../store/data';
import { autoCostCurtainLine, isCurtainProduct } from './curtainCalc';
import { curtainBlockers } from './curtainBlockers';
import { familyOfLine } from './optionFamilies';

const SPEC_BY_KEY = Object.fromEntries(MS_SPEC_FIELDS.map(f => [f.key, f]));

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const mm    = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Specs that only apply once the operation is known, and the answer that makes
 * them apply. A motor side on a chain blind and a chain colour on a motorised
 * one are both questions with no answer — asking them is how a list of real
 * gaps turns into a list to be ignored.
 */
const OPERATION_DEPENDENT = {
  motorSide:   'motorised',
  chainColour: 'manual',
};

/** 'motorised' | 'manual' | 'unknown' — read off the line, not assumed. */
function operationOf(item, productType) {
  const code = String(item?.trackType || '').trim();
  // Nothing chosen yet: the operation type is itself one of the gaps below, and
  // guessing here would invent a second one off the back of it.
  if (!code) return 'unknown';
  if (/motoris|motorized/i.test(`${code} ${item?.productNameSnapshot || ''}`)) return 'motorised';
  const family = familyOfLine(item, productType);
  if (family === 'battery' || family === 'mains') return 'motorised';
  if (family === 'chain') return 'manual';
  return 'unknown';
}

/**
 * Curtain-calculator codes that are the same thing as a field gap listed here.
 * Both are true, but saying "No drop recorded" and "No drop — not priced" one
 * under the other reads like two problems.
 */
const COVERED_BY_FIELD = {
  'no-width':      'widthMm',
  'no-drop':       'dropMm',
  'no-heading':    'heading',
  'no-track-type': 'operationType',
};

/** The fabric name is the fix for these, so offer it inline. */
const FABRIC_CODES = new Set(['fabric-not-found', 'fabric-ambiguous', 'fabric-width-assumed', 'no-fabric-price']);

/**
 * One line's gaps, in the order they are worth fixing.
 *
 * @param {object} item               measure-sheet line item
 * @param {object} opts
 * @param {Array}  opts.productTypes  from getProductTypes()
 * @param {object} opts.rates         from getCurtainRates()
 * @param {Array}  opts.pricedItems   from getPricedItems()
 * @param {string} opts.measureSheetId  so an off-screen fix can link to the sheet
 * @returns {Array} gap descriptors — see the shape at the bottom of this file
 */
export function lineGaps(item, { productTypes = [], rates = null, pricedItems = [], measureSheetId = null } = {}) {
  if (!item) return [];
  const pt = productTypes.find(p => p.id === item.productTypeId) || null;
  const out = [];

  // ── What it is ────────────────────────────────────────────────────────────
  // First, because every other answer depends on it: the spec fields a line is
  // asked for are the ones its product type uses.
  if (!item.productTypeId && !item.pricedItemId && blank(item.productNameSnapshot) && blank(item.productType)) {
    out.push({
      key: 'product', field: 'productNameSnapshot', label: 'Product',
      what: 'No product chosen', severity: 'price', editor: 'product',
      hint: 'Decides what else this line needs',
    });
  }

  // ── Measurements ──────────────────────────────────────────────────────────
  if (mm(item.widthMm) <= 0) {
    out.push({
      key: 'widthMm', field: 'widthMm', label: 'Width',
      what: 'No width recorded', severity: 'price', editor: 'measure', unit: 'mm',
    });
  }
  if (mm(item.dropMm) <= 0) {
    out.push({
      key: 'dropMm', field: 'dropMm', label: 'Drop',
      what: 'No drop recorded', severity: 'price', editor: 'measure', unit: 'mm',
    });
  }

  // ── Fabric ────────────────────────────────────────────────────────────────
  // Free text on purpose: it is free text on the sheet, and the pricing match
  // runs off the same string either way.
  if (blank(item.fabricColour)) {
    out.push({
      key: 'fabric', field: 'fabricColour', label: 'Fabric / colour',
      what: 'No fabric or colour recorded', severity: 'order', editor: 'text',
      hint: 'As it is written on the price list',
    });
  }

  // ── Specs the product type actually uses ──────────────────────────────────
  const operation = operationOf(item, pt);
  getTypeSpecKeys(pt).forEach((key) => {
    // A lining is a yes/no, and "no" is the common answer — an unticked box is
    // not a hole in the sheet.
    if (key === 'lining') return;
    if (specHasValue(item, key)) return;
    const need = OPERATION_DEPENDENT[key];
    if (need && operation !== need) return;

    const spec = SPEC_BY_KEY[key];
    if (!spec) return;
    out.push({
      key,
      field: spec.itemField,
      label: spec.label,
      what: `No ${spec.label.toLowerCase()} chosen`,
      severity: 'order',
      editor: 'select',
      options: getMsOptions(spec.optionKey, pt),
    });
  });

  // ── What the curtain calculator still cannot do ───────────────────────────
  // Only curtains are costed automatically, so only curtains can report a
  // pricing gap that isn't just an empty field — an unrated heading, a fabric
  // with no price, a track wider than the rate card goes.
  if (isCurtainProduct(item.productNameSnapshot || item.productType || '')) {
    const costed = autoCostCurtainLine(item, rates || undefined, pricedItems);
    if (costed?.blocked) {
      const have = new Set(out.map(g => g.key));
      curtainBlockers(costed.warnings, { measureSheetId }).forEach((b) => {
        const covered = COVERED_BY_FIELD[b.code];
        if (covered && have.has(covered)) return;      // already listed as a field
        out.push({
          key: `calc:${b.code}`,
          label: 'Pricing',
          what: b.what,
          detail: b.detail,
          severity: 'price',
          // A fabric the library cannot price is most often a fabric whose name
          // is nearly right, so the name is editable here as well as linked.
          editor: FABRIC_CODES.has(b.code) ? 'text' : null,
          field: FABRIC_CODES.has(b.code) ? 'fabricColour' : null,
          fixLabel: b.fixLabel,
          href: b.href,
        });
      });
    }
  }

  return out;
}

/**
 * Gaps for a whole selection of lines. Lines with nothing missing are dropped
 * rather than listed as complete — this is a list of work, not a report card.
 */
export function sheetGaps(items = [], opts = {}) {
  const out = [];
  items.forEach((item, index) => {
    const gaps = lineGaps(item, opts);
    if (gaps.length) out.push({ id: item.id, index, item, gaps });
  });
  return out;
}

/** `lineId::gapKey` — the identity of one gap, for dismissals. */
export const gapId = (lineId, key) => `${lineId}::${key}`;

/** Every gap key still open on a line, for telling filled from outstanding. */
export const openGapKeys = (item, opts) => new Set(lineGaps(item, opts).map(g => g.key));

/**
 * Counts for a summary line: what is left, split by consequence, with
 * dismissed gaps taken out — a dismissal is an answer, so it stops counting.
 */
export function gapTotals(lineGapsList = [], dismissed = new Set(), resolvedIds = new Set()) {
  let price = 0, order = 0, lines = 0;
  lineGapsList.forEach(({ id, gaps }) => {
    let live = 0;
    gaps.forEach((g) => {
      const gid = gapId(id, g.key);
      if (dismissed.has(gid) || resolvedIds.has(gid)) return;
      live += 1;
      if (g.severity === 'price') price += 1; else order += 1;
    });
    if (live) lines += 1;
  });
  return { price, order, total: price + order, lines };
}

/**
 * The gap descriptor, for reference:
 *
 *   key       stable within a line: a spec key, a field name, or `calc:<code>`
 *   field     the line-item property an editor writes to (null = not fillable)
 *   label     field name, for the editor's label
 *   what      the gap in words — "No drop recorded"
 *   detail    extra from the calculator, e.g. the heading it could not rate
 *   severity  'price' | 'order' — see the header
 *   editor    'measure' | 'text' | 'select' | 'product' | null
 *   options   for 'select'
 *   fixLabel  where it is fixed, when that is not here
 *   href      and the link to it
 */
