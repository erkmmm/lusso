import { groupByRoom } from './roomNaming';

/**
 * The shape a quote's line items take on screen: rooms → windows → blocks.
 *
 * Used by BOTH the customer's quote page and the staff quote builder, so what
 * someone assembles is laid out exactly the way the customer will read it —
 * same rooms, same A / B / C, same "choose one" groupings — without having to
 * open a preview to find out.
 */

/** "motor-upgrade" → "Motor Upgrade". Blank for an unnamed group. */
export const prettyGroup = (id) => (!id || id === '__default__')
  ? ''
  : String(id).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/**
 * Split one window's lines into the blocks that get rendered.
 *
 * A window can carry more than one line — a blind and a curtain measured at
 * the same opening — and it can carry a "choose one" set. Each choice group
 * becomes a single block the customer answers once; everything else is a block
 * of its own, in the order it was measured.
 */
function toBlocks(items) {
  const out = [];
  const byGroup = new Map();
  items.forEach((li, i) => {
    if (li.type === 'Multiple Choice') {
      const gid = li.choiceGroupId || '__default__';
      let block = byGroup.get(gid);
      if (!block) {
        const name = prettyGroup(gid);
        block = {
          key: `choice:${gid}`, kind: 'choice', required: false, items: [],
          eyebrow: name ? `Choose one — ${name.toLowerCase()}` : 'Choose one',
        };
        byGroup.set(gid, block);
        out.push(block);
      }
      block.items.push(li);
      // "Customer must choose one" is set per line in the builder; a group
      // counts as required if any of its lines carries the flag.
      block.required = block.required || !!li.choiceRequired;
      return;
    }
    const optional = li.type === 'Optional';
    out.push({
      key: `line:${li.id || i}`, kind: optional ? 'optional' : 'included',
      required: false, items: [li],
      eyebrow: optional ? 'Optional — add if you want it' : '',
    });
  });
  return out;
}

/**
 * @param {Array} lineItems  a quote's line items
 * @returns {Array<{room: string, entries: Array<{ref, key, items, blocks}>}>}
 */
export function quoteSections(lineItems = []) {
  return groupByRoom(lineItems, {
    // Where no letter was ever written, alternatives for one window are still
    // that window — a choice group takes one entry, not one per option.
    entryKeyOf: (li) => li.type === 'Multiple Choice' ? (li.choiceGroupId || '__default__') : null,
    // A remote or a charger is not a window and must not take a window letter.
    refless: (li) => li.type === 'Part',
  }).map(({ room, entries }) => ({
    room,
    entries: entries.map(entry => ({ ...entry, blocks: toBlocks(entry.items) })),
  }));
}

/** Every choice block still waiting on an answer, across the whole quote. */
export const unansweredChoices = (sections, selectedIds = []) => sections
  .flatMap(r => r.entries).flatMap(e => e.blocks)
  .filter(b => b.kind === 'choice' && b.required && !b.items.some(li => selectedIds.includes(li.id)));

/**
 * What one room still wants from the customer.
 *
 * Both views label the room heading from this, so the editor cannot say
 * "2 items" while the customer's copy says "1 to choose" about the same room.
 *
 * `open` counts every unanswered choice, required or not. Whether Accept
 * unlocks is a separate question — that is `unansweredChoices`, which counts
 * only the required ones — but for finding your way around a long quote, an
 * unanswered choice is somewhere to go back to either way.
 */
export function roomDecisionStatus(entries = [], selectedIds = []) {
  const blocks    = entries.flatMap(e => e.blocks || []);
  const choices   = blocks.filter(b => b.kind === 'choice');
  const optionals = blocks.filter(b => b.kind === 'optional');
  const open      = choices.filter(b => !b.items.some(li => selectedIds.includes(li.id))).length;
  const added     = optionals.filter(b => selectedIds.includes(b.items[0]?.id)).length;

  if (open)            return { text: `${open} to choose`, open };
  if (choices.length)  return { text: 'All chosen', open: 0 };
  if (optionals.length) return { text: `${added} of ${optionals.length} added`, open: 0 };
  return { text: `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`, open: 0 };
}
