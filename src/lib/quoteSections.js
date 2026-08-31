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
  }).map(({ room, entries }) => ({
    room,
    entries: entries.map(entry => ({ ...entry, blocks: toBlocks(entry.items) })),
  }));
}

/** Every choice block still waiting on an answer, across the whole quote. */
export const unansweredChoices = (sections, selectedIds = []) => sections
  .flatMap(r => r.entries).flatMap(e => e.blocks)
  .filter(b => b.kind === 'choice' && b.required && !b.items.some(li => selectedIds.includes(li.id)));
