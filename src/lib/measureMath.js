/**
 * Arithmetic in a measurement field.
 *
 * Measuring on site is full of sums: a 1200 opening plus 50 overlap each side,
 * a 2400 drop less a 15mm floor clearance, a wall split into three equal
 * blinds. Doing those in your head over a tape measure is where wrong numbers
 * come from, and a wrong number here is a blind that has to be remade.
 *
 * So the field takes the sum and keeps the answer: type `1200+50+50` and the
 * line carries 1300, with the working kept beside it so the sheet can still be
 * checked later.
 *
 * Parsed rather than evaluated. `eval` and `new Function` on anything a user
 * typed is a door this app has no reason to open, and a recursive-descent
 * parser for four operators is thirty lines — it also lets us reject
 * nonsense precisely instead of discovering it as an exception.
 */

/** Characters a phone or a spreadsheet habit produces for the same operators. */
const NORMALISE = [
  [/[×✕✖]/g, '*'],
  [/[÷]/g, '/'],
  [/[–—−]/g, '-'],   // en dash, em dash, true minus
  [/[,\s]/g, ''],    // thousands separators and stray spaces
];

/** Does this look like a sum rather than a plain number someone typed? */
export const looksLikeExpression = (raw) => {
  const s = String(raw ?? '');
  // A leading minus is a negative number, not an operation — and anything with
  // a bracket is a sum whichever way you read it.
  return /[+*/×÷()]/.test(s) || /\d\s*[-–—−]/.test(s);
};

/**
 * Evaluate a measurement expression.
 *
 * @returns {number|null} the result, or null when the input is not a complete,
 *   valid sum. Null means "leave what they typed alone" — a half-finished
 *   `1200+` must not silently become 1200.
 */
export function evaluateMeasure(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  NORMALISE.forEach(([re, to]) => { s = s.replace(re, to); });
  if (!/^[0-9.()+\-*/]+$/.test(s)) return null;

  let i = 0;
  const peek = () => s[i];
  const eat = (c) => { if (s[i] === c) { i += 1; return true; } return false; };

  // expr := term (('+' | '-') term)*
  function expr() {
    let left = term();
    if (left === null) return null;
    for (;;) {
      if (eat('+')) { const r = term(); if (r === null) return null; left += r; }
      else if (eat('-')) { const r = term(); if (r === null) return null; left -= r; }
      else return left;
    }
  }

  // term := factor (('*' | '/') factor)*
  function term() {
    let left = factor();
    if (left === null) return null;
    for (;;) {
      if (eat('*')) { const r = factor(); if (r === null) return null; left *= r; }
      else if (eat('/')) {
        const r = factor();
        // Dividing by nothing is a typo, not a measurement. Refusing beats
        // writing Infinity onto a line somebody will try to order.
        if (r === null || r === 0) return null;
        left /= r;
      } else return left;
    }
  }

  // factor := '-'? ( number | '(' expr ')' )
  function factor() {
    if (eat('-')) { const v = factor(); return v === null ? null : -v; }
    if (eat('(')) {
      const v = expr();
      if (v === null || !eat(')')) return null;
      return v;
    }
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i += 1;
    if (i === start) return null;
    const n = Number(s.slice(start, i));
    return Number.isFinite(n) ? n : null;
  }

  const value = expr();
  // Trailing junk means the sum was not finished: `1200+` parses a 1200 and
  // then stops with an operator still in hand.
  if (value === null || i !== s.length || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Resolve a typed measurement into what the line should store and show.
 *
 * Millimetres are whole numbers on a measure sheet — a tape does not read
 * 1283.33 — so a division that lands between them is rounded, and the working
 * stays visible so the rounding is never a surprise.
 *
 * @returns {{value: string, expression: string}|null} null when there is
 *   nothing to change, so a plain number is left exactly as typed.
 */
export function resolveMeasureEntry(raw) {
  if (!looksLikeExpression(raw)) return null;
  const n = evaluateMeasure(raw);
  if (n === null || n <= 0) return null;
  return { value: String(Math.round(n)), expression: String(raw).trim() };
}
