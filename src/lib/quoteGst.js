const cents = value => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

// Imported accepted documents may round tax on each line. Opt in explicitly
// so existing Lusso quotes retain their original subtotal-based calculation.
export function quoteGst(taxableLines, rate, discountFactor = 1, roundPerLine = false) {
  if (roundPerLine) return cents(taxableLines.reduce((sum, value) => sum + cents(value * discountFactor * rate / 100), 0));
  return taxableLines.reduce((sum, value) => sum + value, 0) * discountFactor * rate / 100;
}
