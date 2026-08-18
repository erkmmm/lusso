import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { categorizeProduct } from './productCategories';
import {
  lookupBuzInventoryCode, getBuzValueMap,
  OPERATION_TYPE_OPTIONS, HEADING_OPTIONS, BASE_BAR_TYPE_OPTIONS,
} from '../store/data';

/**
 * BUZ roller-blind order import ("ROLL" sheet) generator.
 *
 * BUZ imports one row per blind across a fixed 33-column layout (A→AG). The
 * column ORDER and header spelling are load-bearing — BUZ matches by position,
 * so COLUMNS below must never be reordered. Most columns map 1:1 from a Lusso
 * measure-sheet line item; a handful are BUZ-only choices we fill with sensible
 * defaults (see DEFAULTS), and a few need value translation because Lusso's
 * dropdown vocab differs from BUZ's (see the *_MAP tables).
 *
 * The one value Lusso can't derive is INVENTORY CODE (col B) — that's a BUZ
 * fabric/product code (e.g. "ROLLSERBOO1"). It comes from the user-maintained
 * fabric-range → code table in Settings, via lookupBuzInventoryCode().
 */

// Column headers, in BUZ's required order. Index === spreadsheet column A,B,C…
export const BUZ_ROLL_COLUMNS = [
  'ORDER ITEM PKID',   // A  per-line GUID
  'INVENTORY CODE',    // B  fabric/product code (from Settings map)
  'DESCN',             // C  free-text description
  'QTY',               // D
  'ITEMWIDTH',         // E  mm
  'ITEMHEIGHT',        // F  mm
  'SIZES',             // G  measurement convention (Opening/Exact)
  'CONTROLTYPE',       // H  motor / chain operation
  'CONTROLS',          // I  control side
  'ROLLDIR',           // J  roll direction
  'BOTTOMTRIM',        // K  bottom rail type
  'RAILCOLOUR',        // L  bottom rail colour
  'ITEMDEPTH',         // M  remote / handset option
  'FIT',               // N  fixing
  'CHAINTEN',          // O  chain tensioner
  'BRACKET',           // P
  'BRACKETCOLR',       // Q
  'BRACKETCOV',        // R
  'PELTYPE',           // S  pelmet type
  'INSTALLCH',         // T  install charge
  'ASSIST',            // U
  'CHAINLENGTH',       // V
  'CUSTOMCHAINLEN',    // W
  'DOUBLETYPE',        // X  dual-blind type
  'DOUBLEPOSIT',       // Y  dual-blind position
  'PELCOL',            // Z  pelmet colour
  'PELCOLCUST',        // AA
  'PELWID',            // AB
  'PELRET',            // AC
  'PELRETSIZE',        // AD
  'PELBRACK',          // AE
  'EXTRA CHARGE',      // AF
  'EXTRA DESCRIPTION', // AG
];

// BUZ-only fields Lusso doesn't capture — safe defaults, tweak here if BUZ
// rejects any value.
export const DEFAULTS = {
  SIZES: 'Opening',        // BUZ deducts from the opening size
  ITEMDEPTH: 'No Remote',
  BRACKET: 'Single',
  BRACKET_DUAL: 'Double',
  BRACKETCOLR: 'Pure White',
  BRACKETCOV: 'No',
  PELTYPE: 'N/A',
  INSTALLCH: 'N/A',
  CHAINTEN: 'Clear',       // clear P-clip tensioner on chain blinds
};

// ── Value translation: Lusso vocab → BUZ vocab ───────────────────────────────
// Every map falls back to passing the Lusso value through unchanged, so an
// unmapped option still lands in the file (visible for the user to reconcile in
// BUZ) rather than silently blanking.
//
// CONTROLTYPE, ROLLDIR and BOTTOMTRIM are USER-CONFIGURABLE: the DEFAULT_* maps
// below are the built-in starting point, and the user can override/extend them
// per Lusso option in Settings → BUZ Export (stored via getBuzValueMap). CONTROLS
// stays hardcoded (a fixed L/R/Centre translation).

// CONTROLS (col I): control side. Lusso allows RHS/LHS/C/O shorthand.
const CONTROLS_MAP = {
  'rhs': 'Right', 'lhs': 'Left', 'right': 'Right', 'left': 'Left',
  'c/o': 'Centre', 'c/o-fr': 'Centre', 'fr': 'Centre', 'centre': 'Centre',
};

// CONTROLTYPE (col H): from Lusso's operation type (item.trackType). BUZ spells
// its motor SKUs in full; seed the ones we know and pass the rest through.
export const DEFAULT_CONTROLTYPE_MAP = {
  'li-ion motor 1.1': 'Acmeda Automate Zero Li-ion Q  Motor 1.1',
  'li-ion motor 2.0': 'Acmeda Automate Zero Li-ion Q  Motor 2.0',
  'li-ion motor 3.0': 'Acmeda Automate Zero Li-ion Q  Motor 3.0',
};

// ROLLDIR (col J): from Lusso's heading/roll field.
export const DEFAULT_ROLLDIR_MAP = {
  'standard roll': 'Backroll / Std',
  'reverse roll': 'Frontroll / Rev',
};

// BOTTOMTRIM (col K): from Lusso's bottom-rail type. BUZ writes the fabric-wrap
// rails with a hyphen where Lusso uses an en-dash.
export const DEFAULT_BOTTOMTRIM_MAP = {
  'smart rail fabric wrap – full': 'Smart Rail Fabric Wrap - FULL',
  'smart rail fabric wrap – half': 'Smart Rail Fabric Wrap - HALF',
};

// The user-configurable fields, surfaced in Settings. `sourceOptions` are the
// Lusso dropdown values each mapping is keyed by.
export const BUZ_MAP_FIELDS = [
  { key: 'controltype', label: 'Control Type', column: 'CONTROLTYPE',
    sourceLabel: 'Operation Type', sourceOptions: OPERATION_TYPE_OPTIONS, defaults: DEFAULT_CONTROLTYPE_MAP },
  { key: 'rolldir', label: 'Roll Direction', column: 'ROLLDIR',
    sourceLabel: 'Heading / Roll', sourceOptions: HEADING_OPTIONS, defaults: DEFAULT_ROLLDIR_MAP },
  { key: 'bottomtrim', label: 'Bottom Rail Type', column: 'BOTTOMTRIM',
    sourceLabel: 'Bottom Rail Type', sourceOptions: BASE_BAR_TYPE_OPTIONS, defaults: DEFAULT_BOTTOMTRIM_MAP },
];

const norm = (v) => String(v ?? '').trim();
const lc = (v) => norm(v).toLowerCase();
const mapOr = (table, v) => (norm(v) ? (table[lc(v)] ?? norm(v)) : '');

/**
 * Translate a Lusso value for a configurable field: stored override wins, then
 * the built-in default, then the value passes through unchanged. Reads the
 * override map fresh so Settings edits take effect on the next export.
 */
const mapField = (fieldKey, defaults, v) =>
  mapOr({ ...defaults, ...getBuzValueMap(fieldKey) }, v);

const isDual = (item) =>
  /\bdual\b/i.test(item.productNameSnapshot || item.productType || '');

/** True when a measure-sheet line item is a roller blind (single or dual). */
export function isRollerBlindItem(item) {
  const name = item.productNameSnapshot || item.productType || '';
  const code = item.pricedItemCode || item.itemCode || '';
  return categorizeProduct(name, code) === 'Roller Blinds';
}

/**
 * Map one measure-sheet line item to a BUZ ROLL row (array aligned to
 * BUZ_ROLL_COLUMNS). Fabric colour, control side and roll direction are
 * translated; everything else is a direct field or a default.
 */
export function buildBuzRow(item) {
  const inventoryCode = lookupBuzInventoryCode(item.fabricColour);
  const controlType   = mapField('controltype', DEFAULT_CONTROLTYPE_MAP, item.trackType);
  const controlSide   = mapOr(CONTROLS_MAP, item.control || item.motorSide);
  const rollDir       = mapField('rolldir', DEFAULT_ROLLDIR_MAP, item.heading);
  const bottomTrim    = mapField('bottomtrim', DEFAULT_BOTTOMTRIM_MAP, item.baseBarType);
  const railColour    = norm(item.baseBarColour || item.trackBaseBarColour);
  const motorised     = /motor/i.test(item.trackType || '') || lc(item.control) === 'motorised';

  const row = {
    'ORDER ITEM PKID': uuidv4(),
    'INVENTORY CODE': inventoryCode,
    'DESCN': norm(item.location),
    'QTY': Number(item.quantity) || 1,
    'ITEMWIDTH': item.widthMm ?? '',
    'ITEMHEIGHT': item.dropMm ?? '',
    'SIZES': DEFAULTS.SIZES,
    'CONTROLTYPE': controlType,
    'CONTROLS': controlSide,
    'ROLLDIR': rollDir,
    'BOTTOMTRIM': bottomTrim,
    'RAILCOLOUR': railColour,
    'ITEMDEPTH': DEFAULTS.ITEMDEPTH,
    'FIT': norm(item.fixing),
    'CHAINTEN': motorised ? 'N/A' : DEFAULTS.CHAINTEN,
    'BRACKET': isDual(item) ? DEFAULTS.BRACKET_DUAL : DEFAULTS.BRACKET,
    'BRACKETCOLR': DEFAULTS.BRACKETCOLR,
    'BRACKETCOV': DEFAULTS.BRACKETCOV,
    'PELTYPE': DEFAULTS.PELTYPE,
    'INSTALLCH': DEFAULTS.INSTALLCH,
    'ASSIST': '',
    'CHAINLENGTH': '',
    'CUSTOMCHAINLEN': '',
    'DOUBLETYPE': '',
    'DOUBLEPOSIT': '',
    'PELCOL': '',
    'PELCOLCUST': '',
    'PELWID': '',
    'PELRET': '',
    'PELRETSIZE': '',
    'PELBRACK': '',
    'EXTRA CHARGE': '',
    'EXTRA DESCRIPTION': '',
  };
  return BUZ_ROLL_COLUMNS.map((c) => row[c] ?? '');
}

/**
 * Build BUZ ROLL rows for every roller-blind line on a measure sheet. Each
 * line's `quantity` stays as the QTY column (BUZ expands it), matching the
 * sample. Returns { rows, unmapped } where `unmapped` lists fabrics with no
 * INVENTORY CODE so the caller can warn.
 */
export function buildBuzRows(sheet) {
  const items = (sheet?.lineItems || []).filter(isRollerBlindItem);
  const rows = items.map(buildBuzRow);
  const codeIdx = BUZ_ROLL_COLUMNS.indexOf('INVENTORY CODE');
  const unmapped = [];
  rows.forEach((r, i) => {
    if (!r[codeIdx]) {
      const fabric = norm(items[i].fabricColour) || '(no fabric)';
      if (!unmapped.includes(fabric)) unmapped.push(fabric);
    }
  });
  return { rows, unmapped };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Filename in BUZ's DDMMYY convention, keyed off the job number when present. */
export function buzFileName(job) {
  const d = new Date();
  const stamp = `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
  const ref = job?.jobNumber ? String(job.jobNumber).replace(/[^\w-]/g, '') : stamp;
  return `${ref}_BUZ_ROLL.xlsx`;
}

/**
 * Generate and download the BUZ .xlsx for a measure sheet. Returns
 * { count, unmapped } — count of blinds written, and any fabrics missing a
 * code. Throws with a clear message when there are no roller blinds to export.
 */
export function exportMeasureSheetToBuz(sheet, job = null) {
  const { rows, unmapped } = buildBuzRows(sheet);
  if (rows.length === 0) {
    throw new Error('No roller blinds on this measure sheet to export.');
  }
  const aoa = [BUZ_ROLL_COLUMNS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ROLL');
  XLSX.writeFile(wb, buzFileName(job));
  return { count: rows.length, unmapped };
}
