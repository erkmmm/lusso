/**
 * Product categorisation for dashboard analytics.
 *
 * Imported Quotient line items have near-unique titles (room descriptions),
 * so grouping by name produces one "product" per line. Their item codes are
 * structured though (CURT Ripple, RB 40 Block, MOT VEN, Shut Therm, VEN B,
 * SERV Labor…) — these keyword rules roll code + title up into readable
 * categories. Native Lusso quotes match via their product-type names.
 *
 * Matching order (deliberate):
 *   1. Services (labour, removal, freight …)
 *   2. Anchored product PREFIX on the code (after stripping a leading
 *      MOT/MT) — a code that STARTS with RB/CURT/ROMAN/VEN/… IS that
 *      product, even if it also mentions a part word: "RB 40 Block Battery"
 *      is a roller blind, "MOT VEN" is a venetian.
 *   3. Parts words in the CODE — a code that says charger/remote/clip IS a
 *      part even when it name-drops a product, e.g.
 *      "Acmeda USB Wall Charger (Curtains)".
 *   4. The CODE's product match (anywhere in the code).
 *   5. Parts words in the TITLE — "The Clip" isn't a roller blind…
 *   6. The TITLE's product match — …while an RB-coded blind whose
 *      description mentions "bottom clips" stays a roller blind via step 2.
 *   7. Pure motor items with no underlying product → Motors & Controls.
 */
const SERVICE = [/\b(serv|labou?r|removal|install(ation)? only|repair|call ?out|freight|delivery)\b/];

const PRODUCTS = [
  ['Curtains & Sheers',  /\bcurt\b|curtain|sheer|ripple|wave ?fold|s-?fold|knife pleat|pencil pleat|drape|reverse pleat/],
  ['Roman Blinds',       /roman/],
  ['Venetians',          /\bven\b|venetian/],
  ['Verticals',          /\bvert\b|vertical/],
  ['Shutters',           /\bshut\b|shutter|therm/],
  ['External & Awnings', /\bext\b|awning|folding arm|straight drop|widescreen|zip ?screen|patio|outdoor/],
  ['Roller Blinds',      /\brb\d*\b|roller|dual blind|block ?out|sunscreen|privacy/],
  ['Pleated & Cellular', /pleated|cellular|honeycomb/],
  ['Tracks & Pelmets',   /track|pelmet|\brod\b|bracket/],
];

const PARTS  = [/\bclips?\b|tensioner|chain tension|\brem(ote)?s?\b|hub\b|charger|wand|acmeda ch\b|battery|dock|spline|\bparts?\b/];
const MOTORS = [/\bmot\b|\bmt\b|motoris|motor\b|somfy|automate|glydea/];

// Anchored code prefixes — the strongest signal there is.
const CODE_PREFIXES = [
  ['Curtains & Sheers',  /^curt\b/],
  ['Roman Blinds',       /^roman\b/],
  ['Venetians',          /^ven\b/],
  ['Verticals',          /^vert\b/],
  ['Shutters',           /^shut\b/],
  ['External & Awnings', /^ext\b/],
  ['Roller Blinds',      /^rb\s*\d*\b/],
];

const test = (rules, hay) => rules.some(re => re.test(hay));

export function categorizeProduct(name = '', code = '') {
  const codeHay  = code.toLowerCase().trim();
  const titleHay = name.toLowerCase();
  const allHay   = `${codeHay} ${titleHay}`;

  if (test(SERVICE, allHay)) return 'Service & Install';
  // "MOT RB40…" / "MT VEN…" are the motorised version of the product.
  const codeCore = codeHay.replace(/^(mot|mt)\s+/, '');
  for (const [category, re] of CODE_PREFIXES) {
    if (re.test(codeCore)) return category;
  }
  if (test(PARTS, codeHay)) return 'Parts & Accessories';
  for (const [category, re] of PRODUCTS) {
    if (re.test(codeHay)) return category;
  }
  if (test(PARTS, titleHay)) return 'Parts & Accessories';
  for (const [category, re] of PRODUCTS) {
    if (re.test(titleHay)) return category;
  }
  if (test(MOTORS, allHay)) return 'Motors & Controls';
  return 'Other';
}
