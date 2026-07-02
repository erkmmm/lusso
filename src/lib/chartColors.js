/**
 * Calm, premium categorical palettes for the dashboard charts.
 * Muted tones, never neon — tuned to Lusso's brand.
 */

// Where colour is just identity (job types, generic breakdowns).
export const CHART_COLORS = [
  '#2E6E65', // teal
  '#46618F', // slate blue
  '#C0873A', // amber (brand-leaning)
  '#9C6B8E', // plum
  '#6E8B6A', // sage
  '#B5654A', // terracotta
  '#5B6B7A', // steel
  '#8A7A5C', // taupe
];

// Pipeline progression: cool (early) → green (done). Reads as forward motion,
// not an arbitrary rainbow. 11 stops for the job status ladder.
export const PIPELINE_RAMP = [
  '#8A93A3', '#6E7E9B', '#556E9A', '#46618F', '#3E6E86',
  '#2E6E65', '#3C7A57', '#5A8A4A', '#C0873A', '#A9772F', '#3B6D3A',
];
