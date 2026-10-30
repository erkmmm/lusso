/**
 * Offering the same window two ways, decided at the tape rather than at the desk.
 *
 * The customer asks "what would the motorised one cost?" while you are standing
 * in their lounge with a tape measure. Until now that answer had to be
 * remembered until quoting time and then built by hand: duplicate the line,
 * re-pick the product, re-pick the fabric, set the motor, and hope the two
 * lines still describe the same window. Most of the time it was easier to
 * quote one way and lose the upsell.
 *
 * A family is the level the customer actually thinks at — chain, battery,
 * 240V — sitting above the specific track and motor codes the factory needs.
 * Picking a family on a measure-sheet line clones the opening and changes only
 * the operation, so the two lines cannot drift apart on anything else.
 *
 * Everything downstream already exists: the clones share a `choiceGroupId`,
 * which the quote turns into a "Choose one" block, which the customer's page
 * renders as a comparison with the shared product name lifted into a heading.
 */

/** The three ways a window gets operated, as a customer would say them. */
export const OPTION_FAMILIES = [
  // "Manual" rather than "Chain": the same family is a chain on a roller and a
  // wand or a hand-drawn track on a curtain, and the word the customer uses
  // for all of them is manual.
  { key: 'chain',   label: 'Manual',  hint: 'Hand operated — chain or wand' },
  { key: 'battery', label: 'Battery', hint: 'Rechargeable motor, remote' },
  { key: 'mains',   label: '240V',    hint: 'Hardwired, needs an electrician' },
];

export const FAMILY_KEYS = OPTION_FAMILIES.map(f => f.key);

/**
 * What each family means for a given product, before anyone sets it in Settings.
 *
 * Keyed on the product type's name because that is what survives a product
 * type being rebuilt; ids are not stable across environments. A blank code is
 * meaningful — it says "this family is the absence of a motor on this product",
 * so the clone carries no operation type at all rather than a made-up one.
 */
const BUILT_IN_BY_PRODUCT = {
  'roller blind':      { chain: 'RB09', battery: 'Li-ion Motor 2.0', mains: 'E6 ARC 240 RTS' },
  'dual roller blind': { chain: 'RB09', battery: 'Li-ion Motor 2.0', mains: 'E6 ARC 240 RTS' },
  'curtain':           { chain: 'Oslo 84 (Manual)', battery: 'Oslo 83 (Battery)', mains: 'Oslo 84 (240v)' },
};

const nameKey = (s) => String(s || '').trim().toLowerCase();

/**
 * Family → operation type code for one product type.
 *
 * Settings wins over the built-in, per family, so naming the battery motor for
 * roller blinds does not silently drop the 240V mapping with it.
 */
export function familyMapFor(productType) {
  const built = BUILT_IN_BY_PRODUCT[nameKey(productType?.name)] || {};
  const saved = (productType?.options && productType.options.optionFamilies) || {};
  const out = {};
  FAMILY_KEYS.forEach((key) => {
    out[key] = Object.prototype.hasOwnProperty.call(saved, key)
      ? String(saved[key] ?? '').trim()
      : (built[key] ?? '');
  });
  return out;
}

/** Is this family offered on this product at all? */
export const familyIsConfigured = (productType, key) => {
  const built = BUILT_IN_BY_PRODUCT[nameKey(productType?.name)];
  const saved = productType?.options?.optionFamilies;
  // Nothing known about the product and nothing set: offering "Battery" on a
  // shutter would create a line nobody can order.
  if (!built && !saved) return false;
  return FAMILY_KEYS.includes(key);
};

/** Which products this knows about out of the box, for Settings to explain itself. */
export const hasBuiltInFamilies = (productType) => !!BUILT_IN_BY_PRODUCT[nameKey(productType?.name)];

/**
 * Which family a line is already quoted as, by its operation type.
 *
 * Matched against the configured codes first, so a business that renames its
 * motors keeps working; the word match is the fallback for lines typed before
 * any of this existed, and for the blank operation type that means "chain" on
 * most roller blinds.
 */
export function familyOfLine(line, productType) {
  const code = String(line?.trackType || '').trim();
  const map = familyMapFor(productType);
  const hit = FAMILY_KEYS.find(k => map[k] && map[k].toLowerCase() === code.toLowerCase());
  if (hit) return hit;

  // The operation type is the reliable answer and is often blank, so the
  // product's own name is read too. "Lusso 40mm Motorised Blockout Roller
  // Blind" with no operation type was being called a chain blind on the
  // strength of the empty field, which hid the manual alternative — the one
  // worth offering on a motorised line.
  const text = `${code} ${line?.productNameSnapshot || ''} ${line?.displayName || ''}`;
  if (/li-?ion|battery|wire[-\s]?free|wirefree|rechargeable/i.test(text)) return 'battery';
  if (/\b240\b|240\s?v|mains|hard[-\s]?wired|\brts\b|\bwt\b/i.test(text)) return 'mains';

  // Motorised, but nothing says which kind. Offering every family is right
  // here: we genuinely do not know which one it already is, and hiding one on
  // a guess is how the manual option went missing in the first place.
  if (/motoris|motorized/i.test(text)) return null;

  return 'chain';
}
