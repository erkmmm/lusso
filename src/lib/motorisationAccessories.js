/**
 * Remotes and chargers, derived from the blinds that are actually motorised.
 *
 * These were hand-added, one line at a time, and the two mistakes were
 * structural rather than careless. A quote that offers chain-operated OR
 * battery-operated at every window doesn't know how many motors it has until
 * the customer answers — so a remote typed in by hand is either charged to
 * someone who chose all-manual, or forgotten by someone who chose all-motors.
 * And a charger was being added per blind, when one charger does a houseful:
 * it is walked from blind to blind every year or two.
 *
 * So neither is a stored line. Both are DERIVED from whichever options are
 * live, and they re-count as the customer picks:
 *
 *   • one remote per room that has a motor in it — a 1-Channel where that
 *     room has a single blind, otherwise a 15-Channel. Not the 5-Channel,
 *     which is the cheaper handset but the one customers ring up about.
 *   • one charger per BLINDS_PER_CHARGER battery blinds, rounded up, for the
 *     whole job. Hardwired motors don't take one — nothing to charge.
 *
 * Idempotent by construction: every derived line carries `autoAddedBy`, and
 * resolving strips the previous pass before computing the next, so a quote can
 * be resolved, saved, reloaded and resolved again without accumulating.
 */
import { groupByRoom } from './roomNaming';
import { OPERATION_WORDS, operationKey } from './describeLine';

/** Marker on every line this module produces. Nothing else may set it. */
export const AUTO_MOTORISATION = 'motorisation';

/** Where the whole-job accessories sit, since they belong to no one room. */
export const JOB_WIDE_LOCATION = 'Whole job';

/**
 * Which priced item plays each accessory role.
 *
 * Prices are NOT written here. They live in Settings → Priced Items with
 * everything else that gets sold, which is where they are kept current and
 * where the cost price behind them lives — so an auto-added remote is costed
 * and margined exactly like a blind picked out of the item library. These
 * codes are the join: `item_code`, not the name, because a name gets tidied
 * up and a SKU does not.
 */
export const ACCESSORY_ITEM_CODES = {
  wifiHub:  'Acmeda Hub',
  charger:  'Acmeda CH',
  remote1:  'Remote - Acmeda',
  remote5:  'Remote Acmeda',
  remote15: 'Remote Wire Free 15 Ch Acmeda',
};

/**
 * Last-resort prices, for a quote saved before the catalogue join existed and
 * for the item somebody renames the code on. A $0 accessory line is worse than
 * a slightly stale one: it goes out the door looking like a freebie.
 */
export const ACCESSORY_FALLBACKS = {
  wifiHub:  { name: 'Acmeda Automate WiFi Hub',            description: 'Acmeda Automate Pulse WiFi Hub',                                 price: 340 },
  charger:  { name: 'Wall Charger 4m USB to Micro Cable',  description: 'Acmeda Li-ion Charger to charge battery operated roller blinds', price: 38  },
  remote1:  { name: '1 Channel Remote Control – White',    description: '1 Channel Wire Free Remote Control White',                       price: 85  },
  remote5:  { name: '5 Channel Remote Control – White',    description: '5 Channel Wire Free Remote Control White',                       price: 95  },
  remote15: { name: '15 Channel Remote Control – White',   description: '15 Channel Wire Free Remote Control White',                      price: 85  },
};

const eqCode = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Read today's accessory prices out of the price library.
 *
 * @param {Array} pricedItems  getPricedItems()
 * @returns {Object} role → { pricedItemId, name, description, price, cost,
 *   labourCost, marginPercent }, every role present, falling back per role.
 */
export function resolveAccessoryPresets(pricedItems = []) {
  const out = {};
  for (const [role, code] of Object.entries(ACCESSORY_ITEM_CODES)) {
    const item = pricedItems.find(i => i.isActive !== false && eqCode(i.itemCode, code));
    const fallback = ACCESSORY_FALLBACKS[role];
    if (!item) { out[role] = { ...fallback }; continue; }
    const sell = Number(item.sellPrice);
    out[role] = {
      pricedItemId:  item.id,
      name:          item.itemName || fallback.name,
      // The description is what the customer reads under the line. A priced
      // item often has none, so the hand-written one stands in rather than
      // leaving a bare product name on the quote.
      description:   item.description || fallback.description,
      // A priced item with no sell price is a cost-only import — its margin
      // can't be guessed at, so the fallback price carries the line.
      price:         Number.isFinite(sell) && sell > 0 ? sell : fallback.price,
      cost:          Number(item.costPrice) || 0,
      labourCost:    Number(item.labourCost) || 0,
      marginPercent: Number(item.marginPercent) || 0,
    };
  }
  return out;
}

/** A presets object with every role filled, whatever the caller had. */
export const withFallbackPresets = (presets) => ({ ...ACCESSORY_FALLBACKS, ...(presets || {}) });

/** One charger per this many battery blinds, rounded up. */
export const BLINDS_PER_CHARGER = 4;

// ─── Which lines are motorised ───────────────────────────────────────────────
// Motorisation lives in the product NAME and nowhere else: the product types
// are "Roller Blind" / "Curtain", and the priced items carry the operation
// ("Lusso 40mm Battery-Operated Blockout Roller Blind", "MOT RB40 Block").

/** Says the line is powered rather than chain- or cord-operated. */
const POWERED_RE = /motoris|motorized|battery[-\s]?operat|wire[-\s]?free|wirefree|hard[-\s]?wired/i;

/** Says the line is a window covering, not a component or a visit. */
const COVERING_RE = /blind|curtain|sheer|drape|shade|awning|screen|shutter|roman|venetian|vertical|roller|track|pelmet|ziptrak|zip\s?screen|glidescreen/i;

/**
 * Says the line is a part, a bare motor or a service call, all of which can
 * name-drop motorisation without being a motorised blind. A line reading
 * "Motor operation" is caught here too and so takes no accessories — a false
 * negative on a legacy imported title, which is the safe direction: it leaves
 * the quote as it is rather than adding a remote nobody asked for.
 */
const NOT_A_BLIND_RE = /\bremote\b|\bhandset\b|\bcharger\b|\bhub\b|battery pack|\bbracket|\bclips?\b|\bmotor\b|\bservice\b|warranty|call[-\s]?out|repair|freight|delivery|labou?r/i;

/** Takes a charger. A hardwired motor is powered but has nothing to charge. */
const BATTERY_RE = /battery|wire[-\s]?free|wirefree|li-?ion/i;

/**
 * Lines that ARE the accessory, so the rule must stand aside.
 *
 * A quote can already carry a handset — an imported Quotient job that lists
 * "15 Channel Acmed RTS remote control" as a line of its own, or a staff
 * member who quick-added one for a reason the rule cannot see. Deriving
 * another on top of it bills the customer twice for the same handset, which
 * is exactly the failure this whole module exists to prevent. Whoever put one
 * on the quote by hand has taken ownership of that accessory.
 */
const EXISTING_REMOTE_RE  = /\bremotes?\b|\bhandsets?\b/i;
const EXISTING_CHARGER_RE = /\bchargers?\b|\bcharging\b/i;

const hay = (li) => `${li?.productNameSnapshot || ''} ${li?.displayName || ''} ${li?.description || ''}`;

/**
 * How the line is operated according to its track / operation type.
 *
 * A curtain's product name is often just "Curtain" — the motor is named by its
 * track ("Oslo 83 (Battery)", "Cherubini 240v"), which the Operation Type
 * dropdown writes to `trackType` and describeLine already translates into
 * "battery motorised" / "240v motorised" for the quote title. Reading the same
 * map here means a motorised curtain gets its remote on the same evidence the
 * customer's quote prints. Only the built-in map, deliberately: the Settings
 * override lives in store/data, which imports this module.
 */
const operationOf = (li) => OPERATION_WORDS[operationKey(li?.trackType)] || '';

/** Is this line a motorised window covering? */
export const isMotorisedCovering = (li) => {
  if (!li || li.type === 'Part') return false;
  const text = hay(li);
  if (NOT_A_BLIND_RE.test(text)) return false;
  const powered = POWERED_RE.test(text) || /motoris/i.test(operationOf(li));
  return powered && COVERING_RE.test(text);
};

/** Is this motorised line battery-powered (so it needs a charger)? */
export const isBatteryPowered = (li) =>
  isMotorisedCovering(li) && (BATTERY_RE.test(hay(li)) || BATTERY_RE.test(operationOf(li)));

/**
 * Is the line part of the order as it currently stands? Required and Part
 * lines always are; an Optional or an alternative only once it is ticked.
 * Same test computeQuoteTotals charges by, so what is counted here and what
 * is billed cannot disagree.
 */
const isLive = (li, selectedIds) =>
  li.type === 'Required' || li.type === 'Part' || selectedIds.includes(li.id);

const qtyOf = (li) => Math.max(1, Number(li?.quantity) || 1);

const slug = (s) => String(s || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job';

/**
 * A derived accessory as a quote line item.
 *
 * The id is deterministic — `auto-motorisation-remote-office-1` — not a uuid.
 * A fresh id on every render would reset React keys and make the row flicker
 * as the customer ticks things, and a line materialised at acceptance has to
 * match the one that was on screen when they agreed to it.
 */
const accessoryLine = ({ preset, kind, room, quantity, serves, sortOrder }) => ({
  id: `auto-${AUTO_MOTORISATION}-${kind}-${slug(room)}`,
  autoAddedBy: AUTO_MOTORISATION,
  autoKind: kind,
  // Which blinds brought it in. Not used for pricing — it is what lets a
  // staff member see why a remote is on the quote.
  autoServes: serves.map(li => li.id),
  type: 'Part',
  choiceGroupId: null,
  choiceRequired: false,
  location: room,
  productTypeId: '',
  productNameSnapshot: preset.name,
  description: preset.description,
  quantity,
  widthMm: '', dropMm: '', fabricColour: '',
  control: '', returnSide: '', motorSide: '', fixing: '',
  heading: '', hem: '', trackColour: '', baseBarColour: '', trackBaseBarColour: '',
  baseBarType: '', chainColour: '', trackType: '',
  attachedLining: false,
  // Linked to the price library like any other line, so the margin on a
  // remote is the real one rather than 100% of a $0 cost.
  pricedItemId: preset.pricedItemId || null,
  unitCostPrice: Number(preset.cost) || 0,
  labourCost: Number(preset.labourCost) || 0,
  marginPercent: Number(preset.marginPercent) || 0,
  manualSellPrice: preset.price,
  discountPercent: '', discountAmount: '',
  supplier: 'Acmeda',
  taxable: true,
  customerNotes: '', internalNotes: '',
  // Past every real line, so accessories read last in their room and the
  // whole-job section lands at the end of the quote.
  sortOrder: 100_000 + sortOrder,
  measureSheetLineItemId: null,
});

/** Drop any previously derived accessory lines. Safe on any quote. */
export const withoutAutoAccessories = (lineItems = []) =>
  lineItems.filter(li => li?.autoAddedBy !== AUTO_MOTORISATION);

/**
 * Which accessories the quote already carries as lines of its own, so the
 * rule can stand aside rather than double up. Derived lines don't count —
 * they are this module's own previous pass.
 */
export function existingAccessories(lineItems = []) {
  const manual = withoutAutoAccessories(lineItems);
  return {
    hasRemote:  manual.some(li => EXISTING_REMOTE_RE.test(hay(li))),
    hasCharger: manual.some(li => EXISTING_CHARGER_RE.test(hay(li))),
  };
}

/**
 * The accessory lines this quote needs, given what is currently selected.
 *
 * @param {Array}  lineItems    a quote's line items (derived ones are ignored)
 * @param {Array}  selectedIds  ids of ticked optionals / chosen alternatives
 * @param {Object} presets      role → preset, from resolveAccessoryPresets().
 *   A quote carries its own snapshot so the price the customer was shown
 *   cannot move under them, and so pricing a quote never costs a read of the
 *   779-row price library. Absent ⇒ the fallbacks.
 * @returns {Array} new line items — empty when nothing motorised is live
 */
export function motorisationAccessories(lineItems = [], selectedIds = [], presets = null) {
  const parts = withFallbackPresets(presets);
  const base = withoutAutoAccessories(lineItems);
  const selected = Array.isArray(selectedIds) ? selectedIds : [];

  // A line with no location at all can't be counted per room, and the rule is
  // per room. That is not a technicality: the imported Quotient jobs carry the
  // room inside the product name ("Master A - Lusso Verosol 40mm Motorised…")
  // and nothing in `location`, so every motor on a 200-window job would land
  // in one bucket and take a single handset. Better to add nothing to a quote
  // the app didn't build than to add one wrong thing.
  const motorised = base.filter(li =>
    isLive(li, selected) && isMotorisedCovering(li) && String(li.location || '').trim());
  if (!motorised.length) return [];

  // Stand aside where the quote already names the accessory itself, whether
  // or not that line is currently selected. Checked across the whole quote
  // rather than per room: an imported job's accessory lines carry no location
  // at all, so there is no honest way to tell which room one was meant for.
  const { hasRemote, hasCharger } = existingAccessories(base);

  // Rooms are read from the SAME grouping the quote is laid out by, so the
  // remote's heading is the heading the customer is already reading. Derived
  // from every line, not just the motorised ones: groupByRoom only treats a
  // trailing letter as a window reference once a room holds more than one, so
  // "Office 1 A" alone would otherwise come back as its own room.
  const roomOf = new Map();
  groupByRoom(base).forEach(({ room, entries }) =>
    entries.forEach(entry => (entry.items || []).forEach(li => roomOf.set(li.id, room))));

  // One remote per room, in the order the rooms appear on the quote.
  const byRoom = new Map();
  motorised.forEach(li => {
    const room = roomOf.get(li.id) || JOB_WIDE_LOCATION;
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room).push(li);
  });

  const out = [];
  if (!hasRemote) {
    byRoom.forEach((blinds, room) => {
      const blindCount = blinds.reduce((n, li) => n + qtyOf(li), 0);
      // The 5-Channel is deliberately skipped: people get lost on its channel
      // switch, so a room with more than one motor takes the 15-Channel.
      const preset = blindCount === 1 ? parts.remote1 : parts.remote15;
      out.push(accessoryLine({
        preset, kind: 'remote', room, quantity: 1, serves: blinds, sortOrder: out.length,
      }));
    });
  }

  // Chargers are whole-job, and only for the battery motors: one charger is
  // carried around the house, which is why this is not one per blind.
  const battery = motorised.filter(isBatteryPowered);
  const batteryCount = battery.reduce((n, li) => n + qtyOf(li), 0);
  if (batteryCount > 0 && !hasCharger) {
    out.push(accessoryLine({
      preset: parts.charger,
      kind: 'charger',
      room: JOB_WIDE_LOCATION,
      quantity: Math.ceil(batteryCount / BLINDS_PER_CHARGER),
      serves: battery,
      sortOrder: out.length,
    }));
  }

  return out;
}

/**
 * A quote's line items with its motorisation accessories resolved onto the
 * end. Idempotent — call it as often as you like, including on a quote whose
 * accessories were already materialised at acceptance.
 */
export function withMotorisationAccessories(lineItems = [], selectedIds = [], presets = null) {
  const base = withoutAutoAccessories(lineItems);
  const extra = motorisationAccessories(base, selectedIds, presets);
  return extra.length ? [...base, ...extra] : base;
}

/**
 * What the accessories would be if the customer took every motorised option
 * on offer — the staff-facing "here is what this quote can add" view, for a
 * draft where nothing has been chosen yet.
 */
export const maxMotorisationAccessories = (lineItems = [], presets = null) =>
  motorisationAccessories(lineItems, (lineItems || []).map(li => li.id), presets);
