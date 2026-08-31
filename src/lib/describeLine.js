/**
 * What a window treatment is called on a customer's quote.
 *
 * The product type alone says "Curtain", which is true and useless — the thing
 * being quoted is a wand operated reverse pleat sheer curtain, and the details
 * that make it that are sitting in separate spec fields nobody reads. This
 * assembles them back into the phrase a person would actually say.
 *
 * It only ever composes from values that are already words. Trade codes
 * (KAW, MKH, C/O, F/R) are looked up in OPERATION_WORDS below and contribute
 * nothing until someone has said what they mean in English — a wrong expansion
 * printed on a quote is worse than a short title.
 */

const norm = (s) => String(s ?? '').trim();
const lower = (s) => norm(s).toLowerCase();
// Keys are matched with internal whitespace collapsed: these are typed by hand
// often enough that a double space should not cost the line its operation.
const opKey = (s) => lower(s).replace(/\s+/g, ' ');

/**
 * Track / operation type → how it is operated, in customer words.
 *
 * These are the built-in defaults. Settings → Quote Wording overrides and
 * extends them (see `getOperationWords` in store/data), so a new track type
 * does not need a code change to read properly on a quote.
 *
 * Keys are matched case-insensitively, with internal whitespace collapsed,
 * against the line's `trackType` — the field the "Operation Type" dropdown
 * writes to. Anything unmapped is left out of the title rather than guessed at.
 */
export const OPERATION_WORDS = {
  // Wand operated — every manual curtain track Lusso fits is drawn by wand.
  'kaw':                'wand operated',
  'mkh':                'wand operated',
  'dual kaw':           'wand operated',
  'dual mkh':           'wand operated',
  'mkh and kaw':        'wand operated',
  'fineline':           'wand operated',
  'bendable track':     'wand operated',
  'oslo 74':            'wand operated',

  // Mains powered — the track name states the voltage.
  'oslo 84 (240v)':     '240v motorised',
  'e6 arc 240 rts':     '240v motorised',
  'm6 - 240 wt':        '240v motorised',
  'cherubini 240v':     '240v motorised',

  // Rechargeable — Li-ion is a battery motor by definition.
  'oslo 83 (battery)':  'battery motorised',
  'li-ion motor 1.1':   'battery motorised',
  'li-ion motor 2.0':   'battery motorised',
  'li-ion motor 3.0':   'battery motorised',

  // Roller blinds. RB09 is read from the data rather than assumed: every RB09
  // line on file carries a chain colour and no motorised line does.
  'rb09':               'chain operated',

  // Deliberately absent, pending someone who knows: 'Oslo 84 (Manual)',
  // 'Oslo 70 (Recess)', 'CRM01', 'RB09', 'No tracks'. An unmapped code costs a
  // shorter title; a guessed one prints a false claim on a customer's quote.
};


/**
 * Fabric qualities worth saying out loud, spotted inside the fabric name.
 *
 * This is what carries a roller blind: its operation is often blank, and the
 * word that tells the customer what they are getting is buried in a supplier
 * code — "Kleen screen ivory", "Linesque soba blockout", "890 0000 white
 * silver screen originals". Keys are matched as substrings of the lowercased
 * fabric name, longest first, so "sun screen" wins over "screen".
 *
 * Overridable in Settings → Quote Wording, because which words a fabric range
 * deserves is a merchandising call, not a code one.
 */
export const FABRIC_WORDS = {
  'blockout':     'blockout',
  'block out':    'blockout',
  'sheer':        'sheer',
  'sunscreen':    'sunscreen',
  'sun screen':   'sunscreen',
  'screen':       'sunscreen',
  'translucent':  'translucent',
  'light filter': 'light filtering',
  'dimout':       'dimout',
  'dim out':      'dimout',
};

/**
 * True when `snapshot` is just the bare product type ("Curtain"), rather than a
 * full name someone wrote or an import already carried ("Bed 2 Lusso 40mm
 * Chain operated Blockout roller blind"). Only the bare case gets composed —
 * rewriting a name a human chose would be a bug, not a feature.
 */
/** Normalise a track type into an OPERATION_WORDS key. */
export const operationKey = (s) => opKey(s);

export const isBareProductName = (snapshot, productTypes = []) => {
  const s = lower(snapshot);
  if (!s) return true;
  return productTypes.some(pt => lower(pt.name) === s);
};

/**
 * Build the customer-facing name for a line.
 *
 * @param {Object} item          quote or measure-sheet line item
 * @param {Array}  productTypes  product types, to recognise a bare name
 * @param {Object} wording  `{ operationWords, fabricWords }`, each a map that
 *   defaults to the built-ins. Callers inside the app should pass
 *   `getQuoteWording()` so what Settings says is what the customer reads.
 * @returns {string} e.g. "Wand operated reverse pleat sheer curtain"
 */
export function describeLine(item, productTypes = [], wording = {}) {
  const operationWords = wording.operationWords || OPERATION_WORDS;
  const fabricWords    = wording.fabricWords || FABRIC_WORDS;
  const snapshot = norm(item?.productNameSnapshot || item?.productType);
  if (!isBareProductName(snapshot, productTypes)) return snapshot;

  const product = lower(snapshot);
  if (!product) return '';

  const parts = [];

  // "wand operated", "motorised" — only where the code has a known meaning.
  const operation = operationWords[opKey(item?.trackType)];
  if (operation) parts.push(operation);

  // "reverse pleet", "ripple fold" — already words, just cased inconsistently.
  const heading = lower(item?.heading);
  if (heading && heading !== 'n/a') parts.push(heading);

  // "sheer" / "blockout" / "sunscreen" out of the fabric name, which is where
  // it actually lives ("Hugo sheer white", "Kleen screen ivory"). Longest key
  // first so "sun screen" is not swallowed by "screen".
  const fabric = lower(item?.fabricColour);
  const hit = Object.keys(fabricWords)
    .filter(w => w && fabric.includes(w))
    .sort((a, b) => b.length - a.length)[0];
  const quality = hit && String(fabricWords[hit] || '').trim();
  if (quality) parts.push(quality);

  // Nothing to add — the line carries no heading, fabric quality or known
  // operation. Hand back the name exactly as it was rather than round-tripping
  // it through lowercase and turning "Roman Blind" into "Roman blind".
  const lined = item?.attachedLining ? ', lined' : '';
  if (!parts.length) return snapshot + lined;

  parts.push(product);
  const out = parts.join(' ');
  return (out.charAt(0).toUpperCase() + out.slice(1) + lined).trim();
}
