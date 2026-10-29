/**
 * The colours a covering is drawn in, wherever it is drawn.
 *
 * Its own module because three different renderers need these and none of them
 * should need each other: the client schedule builds the palette, the quote
 * snapshot bakes it into the customer's plan images, and the annotated export
 * burns it into the PDF the builder and the installer work from. The export
 * previously carried its own hardcoded copy of the fallback grey, so retuning
 * the palette moved the quote and left the builder's drawing on the old one —
 * two documents describing the same windows in different colours.
 *
 * Deliberately free of imports so a pure drawing module can use it without
 * pulling the store in behind it.
 */

// Held at roughly even lightness (~48%) and a half-step back on saturation, so
// no one covering shouts over the others and the set reads as chosen rather
// than defaulted — the previous palette put full-strength blue and rose beside
// a muted teal, which on a near-monochrome quote looked like stock colours.
//
// Ordered for colour blindness, not for prettiness: teal then terracotta,
// because blue-orange is the one pairing that survives every common form of
// it. The old order led with teal, amber, blue, violet, rose, which collapses
// to near-identical pins under deuteranopia — and the pin is the only thing
// tying a run on the drawing to its line on the quote.
//
// Not muted any further. These sit on a white architectural drawing at about
// eight pixels on a phone, and past this they stop being tellable apart, which
// is the entire job.
export const PIN_PALETTE = [
  '#2E6F6B', '#B5673C', '#41548C', '#8E7A2B', '#7B4670',
  '#56702F', '#3C7490', '#A6504F', '#574B82', '#6B6257',
];

// Warm, to sit in the brand's neutral family. The old #94a3b8 was a cool slate
// that read faintly blue next to everything else on the page.
export const UNSPECIFIED = '#9A958C';

/** The colour for one product, or the neutral when it has no entry. */
export const colourFor = (palette, productName) =>
  (productName && palette.get(productName)) || UNSPECIFIED;
