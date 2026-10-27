import { deriveBuzInventoryCode } from './buzFabricResolver';

/**
 * Structured fabric fields for a measure-sheet line item.
 *
 * Lusso stores fabric as one free-text box (`fabricColour`), which three
 * different consumers then try to parse — BUZ codes, curtain pricing, line
 * titles. These fields are the structured version, added ALONGSIDE the text
 * rather than replacing it, so every existing read site keeps working.
 * See docs/fabric-field-split.md.
 *
 *   fabricSupplier    'skins2go' | 'verosol' | undefined
 *   fabricRange       BUZ material-type name, e.g. 'Solarview Screen Fabric'
 *   fabricColourName  BUZ colour name, e.g. 'Charcoal'
 *   fabricCode        BUZ INVENTORY CODE, e.g. 'ROLLM105T461C14'
 *
 * All four are OPTIONAL. A line with none of them is a line we haven't placed
 * yet, which is the normal state for everything entered before the picker
 * exists. Absent beats wrong: a field is only set when it is certain.
 *
 * `fabricSupplier` is the load-bearing one — only Skins2Go orders through BUZ,
 * so it decides which order file a line belongs in.
 */

export const FABRIC_FIELDS = ['fabricSupplier', 'fabricRange', 'fabricColourName', 'fabricCode'];

/**
 * Verosol fabrics are written as a product number and colour — "205 0020
 * silverscren performance beige", "890 0000 white silver screen originals",
 * "203 black" — and Verosol does not use BUZ at all.
 *
 * Only ever consulted AFTER the BUZ catalogue has been tried, because Shaw
 * also has numeric ranges (4300, 4500, 4510). Catalogue first means a Shaw
 * "4500 white" can never be mistaken for Verosol.
 */
const looksVerosol = (s) => {
  const t = String(s ?? '').toLowerCase();
  if (/silver\s?scr(e)?(e)?n|silverscren/.test(t)) return true;   // incl. the common "silverscren" typo
  return /^\s*\d{3,4}\b/.test(t);
};

/**
 * Work out what we can about a fabric string. Returns only the fields it is
 * sure of — `{}` when the fabric can't be placed at all.
 *
 * Deliberately partial: a fabric whose range is known but colour isn't still
 * yields a supplier and a range, which is enough to route the line to the
 * right export even though it can't be ordered yet.
 */
export function deriveFabricFields(fabricText) {
  const text = String(fabricText ?? '').trim();
  if (!text) return {};

  const r = deriveBuzInventoryCode(text);

  if (r.code) {
    return {
      fabricSupplier: 'skins2go',
      fabricRange: r.material,
      fabricColourName: r.colour,
      fabricCode: r.code,
    };
  }

  // Range matched but no colour given. It's a Skins2Go fabric and we know
  // which range — just not which of its colours, so no code.
  if (r.reason === 'nocolour' && r.ranges?.length === 1) {
    return { fabricSupplier: 'skins2go', fabricRange: r.ranges[0].material };
  }
  if (r.reason === 'nocolour') return { fabricSupplier: 'skins2go' };

  // Several products fit — usually one range in Blockout and Light Filtering.
  // The supplier is certain even though the product isn't.
  if (r.reason === 'ambiguous') return { fabricSupplier: 'skins2go' };

  if (looksVerosol(text)) return { fabricSupplier: 'verosol' };

  return {};
}

/** True when a line is orderable through BUZ — Skins2Go, with a resolved code. */
export const isBuzOrderable = (item) =>
  item?.fabricSupplier === 'skins2go' && Boolean(item?.fabricCode);
