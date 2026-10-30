/**
 * What a quote is worth as it stands, before the customer has answered it.
 *
 * A quote built entirely from "choose one" groups has nothing selected until
 * someone opens the link and picks — so every figure derived from it was $0.
 * The quotes list showed a twelve-window office fit-out as $0, the dashboard
 * counted it as $0 of pipeline, and the stored grand_total said the same.
 *
 * But the quote is not worth nothing: the options it opens with are the
 * options the customer will see ticked, and that total is a real number the
 * business can forecast on. `preselected` is what makes a line default-on
 * (see the "Tick this one by default" control in the quote builder), and this
 * turns those defaults into the selection the figures are computed against.
 *
 * ── Where this must NOT be used ────────────────────────────────────────────
 * The customer's own quote page. That page owns a live selection: it seeds
 * from the defaults on open and then follows the ticks, including a group the
 * customer deliberately cleared with "prefer none of these for now". Applying
 * defaults on top of that would quietly re-add an option they had just taken
 * off and leave the total disagreeing with the page's own radio buttons.
 *
 * Everywhere else — the list, the dashboard, the builder, the stored totals —
 * wants this.
 */

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Which "choose one" block a line belongs to.
 *
 * The same split quoteSections makes: a group is one decision about one
 * window, so it is identified by the window (its location, which carries the
 * A / B / C) plus the group name where one was given.
 */
const groupKeyOf = (li) => `${norm(li.location)}::${li.choiceGroupId || '__default__'}`;

/**
 * The selection a quote's figures should be computed against.
 *
 * @param {Array} lineItems
 * @param {Array} selectedIds  what the customer has actually chosen, if anything
 * @returns {Array<string>} ids — the customer's answers, plus the defaults for
 *   anything they have not answered
 */
export function effectiveSelectedIds(lineItems = [], selectedIds = []) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const chosen = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  if (!items.some(li => li?.preselected)) return [...chosen];

  // A group the customer HAS answered keeps their answer, default or not —
  // picking the battery option must not leave the chain one counted too.
  const answered = new Set();
  items.forEach(li => {
    if (li?.type === 'Multiple Choice' && chosen.has(li.id)) answered.add(groupKeyOf(li));
  });

  const out = new Set(chosen);
  items.forEach(li => {
    if (!li?.preselected) return;
    if (li.type === 'Multiple Choice') {
      if (!answered.has(groupKeyOf(li))) out.add(li.id);
    } else if (li.type === 'Optional' && chosen.size === 0) {
      // An optional has no group to answer, so "untouched" can only be read
      // from the customer having touched nothing at all. Once they have
      // ticked anything, their list is taken as complete.
      out.add(li.id);
    }
  });
  return [...out];
}

/** True when the quote carries defaults, i.e. this module has anything to do. */
export const hasPreselected = (lineItems = []) =>
  (Array.isArray(lineItems) ? lineItems : []).some(li => li?.preselected);
