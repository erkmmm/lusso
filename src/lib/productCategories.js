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
 *   2. The CODE's product match — codes are clean, so "MOT VEN" lands in
 *      Venetians and "MOT RB40 Block" in Roller Blinds: motorised items
 *      belong to their underlying product, not a generic Motorised bucket.
 *   3. Parts & accessories (clips, remotes, hubs, chargers …) — checked
 *      before title-product words so "The Clip" isn't a roller blind…
 *   4. The TITLE's product match — …while a roller blind whose description
 *      mentions "bottom clips" stays a roller blind via its code in step 2.
 *   5. Pure motor items with no underlying product → Motors & Controls.
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

const test = (rules, hay) => rules.some(re => re.test(hay));

export function categorizeProduct(name = '', code = '') {
  const codeHay  = code.toLowerCase();
  const titleHay = name.toLowerCase();
  const allHay   = `${codeHay} ${titleHay}`;

  if (test(SERVICE, allHay)) return 'Service & Install';
  for (const [category, re] of PRODUCTS) {
    if (re.test(codeHay)) return category;
  }
  if (test(PARTS, allHay)) return 'Parts & Accessories';
  for (const [category, re] of PRODUCTS) {
    if (re.test(titleHay)) return category;
  }
  if (test(MOTORS, allHay)) return 'Motors & Controls';
  return 'Other';
}
