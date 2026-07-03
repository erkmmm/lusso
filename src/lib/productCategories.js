/**
 * Product categorisation for dashboard analytics.
 *
 * Imported Quotient line items have near-unique titles (room descriptions),
 * so grouping by name produces one "product" per line. Their item codes are
 * structured though (CURT Ripple, RB 40 Block, MOT RB40, Shut Therm, VEN B,
 * SERV Labor…) — these keyword rules roll code + title up into readable
 * categories. Native Lusso quotes match via their product-type names.
 *
 * Order matters: first match wins (services/accessories before product words,
 * motorised before plain rollers).
 */
const RULES = [
  ['Service & Install',    /\b(serv|labou?r|removal|install(ation)? only|repair|call ?out|freight|delivery)\b/],
  ['Accessories & Remotes',/\b(rem(ote)?s?|hub|wand|charger|battery pack|acmeda ch|somfy|automate|bridge|link)\b|^rem\b/],
  ['Motorised Blinds',     /^mot\b|\bmotoris|motor\b|\bmt\b/],
  ['Curtains & Sheers',    /^curt\b|curtain|sheer|ripple|wave ?fold|s-?fold|knife pleat|pencil pleat|drape|reverse pleat/],
  ['Roman Blinds',         /roman/],
  ['Roller Blinds',        /^rb\b|^rb\d|roller|dual blind|block ?out blind|screen blind|sunscreen/],
  ['Venetians',            /^ven\b|venetian/],
  ['Verticals',            /^vert\b|vertical/],
  ['Shutters',             /^shut\b|shutter|therm/],
  ['External & Awnings',   /^ext\b|awning|folding arm|straight drop|widescreen|zip ?screen|patio|outdoor/],
  ['Pleated & Cellular',   /pleated|cellular|honeycomb/],
  ['Tracks & Pelmets',     /track|pelmet|rod\b|bracket/],
];

export function categorizeProduct(name = '', code = '') {
  const hay = `${code} ${name}`.toLowerCase();
  for (const [category, re] of RULES) {
    if (re.test(hay)) return category;
  }
  return 'Other';
}
