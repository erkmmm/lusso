/**
 * Reading a "choose one" the way a customer reads it.
 *
 * Shared by the customer's quote page, which renders this, and the quote
 * builder, which shows a staff member what it will produce before they send
 * it. One copy of the rules, because the whole point of the hint in the editor
 * is that it is the same answer the customer gets — a second implementation
 * that agreed today and drifted next month would be worse than no hint.
 */

/**
 * What actually differs between the options in a "choose one".
 *
 * A choice block is two or three near-identical sentences:
 *
 *   Lusso 40mm Chain-Operated Blockout Roller Blind
 *   Lusso 40mm Battery-Operated Blockout Roller Blind
 *
 * Six of the seven words are shared, and the one that decides it is buried in
 * the middle of both. Read side by side that is a spot-the-difference puzzle,
 * and the customer has to solve it once per choice — twelve times on a quote
 * like QT-9883.
 *
 * So pull the shared words out to a heading over the block, and leave each
 * card holding only its own word. Word-wise, not character-wise: a character
 * diff cuts mid-word and leaves "Chain-Operated" / "Battery-Operated" as
 * "Ch" / "Batt", which is worse than the sentence it replaced.
 *
 * Returns null whenever the result would not be an improvement — nothing
 * meaningful shared, or some option left with nothing to call itself. The
 * caller then renders the full names exactly as before. Being wrong here
 * renames the thing someone is buying, so it declines easily.
 */
const splitWords = (str) => String(str || '').trim().split(/\s+/).filter(Boolean);

export function optionDiff(labels) {
  const lists = labels.map(splitWords);
  if (lists.length < 2 || lists.some(l => l.length === 0)) return null;

  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const shortest = Math.min(...lists.map(l => l.length));

  let pre = 0;
  while (pre < shortest && lists.every(l => eq(l[pre], lists[0][pre]))) pre++;

  let suf = 0;
  while (suf < shortest - pre
         && lists.every(l => eq(l[l.length - 1 - suf], lists[0][lists[0].length - 1 - suf]))) suf++;

  const mids = lists.map(l => l.slice(pre, l.length - suf).join(' '));

  // Not enough in common to be worth a heading, or an option whose whole name
  // is shared — "Roller Blind" and "Roller Blind Deluxe" would leave the first
  // card blank.
  if (pre + suf < 2) return null;
  if (mids.some(m => !m)) return null;

  const head = lists[0].slice(0, pre).join(' ');
  const tail = suf ? lists[0].slice(lists[0].length - suf).join(' ') : '';
  return { shared: [head, tail].filter(Boolean).join(' '), mids };
}

/**
 * What the extra money actually buys, in words a customer uses.
 *
 * "+$360" is a cost. On its own it asks someone to price a difference they
 * have not been told the shape of. These are matched against the differing
 * words only, so a line reading "Battery-Operated" gets the battery sentence
 * and nothing else on the card has to change.
 *
 * Deliberately short list: a benefit we are not sure of is worse than none,
 * because it goes out over the business's name on a priced quotation.
 */
const OPTION_BENEFITS = [
  // No app, on either of these. App control comes from the Automate hub, which
  // is a separate line on the quote when it is there at all — promising it with
  // the motor sells something the customer has not bought.
  [/wire[-\s]?free|wirefree|battery|rechargeable|li-?ion/i, 'Remote control, rechargeable. No electrician needed.'],
  [/hard[-\s]?wired|\b240\s?v\b|mains/i,                   'Remote control, wired to the mains by an electrician.'],
  [/motoris|motorized/i,                                    'Remote control — nothing to reach for.'],
  [/chain/i,                                                'Hand-operated side chain, with a child-safety tensioner.'],
  [/\bwand\b/i,                                             'Hand-operated wand.'],
  [/\bcord\b/i,                                             'Hand-operated cord.'],
  [/\bmanual\b/i,                                           'Hand-operated.'],
];
export const benefitFor = (text) => (OPTION_BENEFITS.find(([re]) => re.test(String(text || ''))) || [])[1] || '';

/**
 * The part of a shared description the shared heading has not already said.
 *
 * These descriptions open by restating the product — "Blockout lusso 40mm
 * blockout roller blind with Rev roll heading, Reveal fix" under a heading
 * that already reads "Lusso 40mm Blockout Roller Blind". Printed as-is it
 * reads as a stutter, and the only part carrying new information is the tail.
 *
 * Only leading words are dropped, and only while every one of them is already
 * in the heading: the moment a word appears that the heading does not have,
 * the rest is kept verbatim. Specifications are not ours to paraphrase.
 */
const bareWord = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
export function descriptionTail(desc, heading) {
  const known = new Set(splitWords(heading).map(bareWord));
  const words = splitWords(desc);
  let i = 0;
  while (i < words.length && known.has(bareWord(words[i]))) i++;
  let rest = words.slice(i);
  if (rest.length && /^(with|in|and|on)$/i.test(rest[0])) rest = rest.slice(1);
  if (!rest.length) return '';
  const out = rest.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}
