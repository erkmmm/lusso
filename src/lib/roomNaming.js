/**
 * The A / B / C convention for more than one covering in the same room.
 *
 * A room with one window is just "Bed 5". The moment a second lands in it,
 * neither is "the" Bed 5 window any more — so the first is retroactively
 * renamed "Bed 5 A" and the new one becomes "Bed 5 B". Leaving the first bare
 * and calling the second "Bed 5 A" would read as if there were an unlabelled
 * window somewhere, and the workroom would have to guess which is which.
 *
 * Applies to auto-naming only. A name someone typed by hand is left exactly as
 * they typed it — renaming under the cursor would be maddening.
 */

// Case-insensitive on purpose. New labels are always written uppercase, but
// plenty were typed by hand as "North bed 2 a" — and both splitting a room
// apart and extending its series have to recognise those, or a lowercase room
// silently starts a second parallel series alongside the one already there.
const SUFFIX_RE = /^(.*?)\s+([A-Za-z]{1,2})$/;
const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
const key = (s) => norm(s).toLowerCase();

/** 0 → A, 1 → B … 25 → Z, 26 → AA. Enough for any real room. */
export function letterAt(index) {
  let n = index, out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** A → 0, B → 1 … AA → 26. Inverse of `letterAt`. */
export function indexOfLetter(letter) {
  let n = 0;
  for (const ch of String(letter || '').toUpperCase()) {
    if (ch < 'A' || ch > 'Z') return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/**
 * Work out what to call a new covering in `base`, and what (if anything) has to
 * be renamed to keep the series consistent.
 *
 * @param {string} base      the room name the plan suggested, e.g. "Bed 5"
 * @param {Array<{id: string, label: string}>} existing  everything already named
 * @returns {{label: string, renames: Array<{id: string, to: string}>}}
 */
export function nextRoomLabel(base, existing = []) {
  const b = norm(base);
  if (!b) return { label: '', renames: [] };
  const bKey = key(b);

  const bare = [];        // labelled exactly `base`
  const suffixed = [];    // labelled `base X`
  for (const e of existing) {
    const label = norm(e.label);
    if (!label) continue;
    if (key(label) === bKey) { bare.push(e); continue; }
    const m = label.match(SUFFIX_RE);
    if (m && key(m[1]) === bKey) {
      const idx = indexOfLetter(m[2]);
      if (idx >= 0) suffixed.push({ ...e, index: idx });
    }
  }

  // First one in this room — no suffix needed, and none wanted.
  if (!bare.length && !suffixed.length) return { label: b, renames: [] };

  // Highest letter in play, so a re-added window doesn't reuse a retired one.
  const highest = suffixed.reduce((max, e) => Math.max(max, e.index), -1);

  // The room had unsuffixed ones. They become A, B, C…; the new one takes the
  // letter after them. `letterAt(1)` was hard-coded here, which was right for
  // the single-bare case the takeoff produces and collided with the second
  // entry for any other — a caller with three bare lines got a fourth also
  // called B.
  if (bare.length && !suffixed.length) {
    return {
      label: `${b} ${letterAt(bare.length)}`,
      renames: bare.map((e, i) => ({ id: e.id, to: `${b} ${letterAt(i)}` })),
    };
  }

  // A series already exists. Anything still bare joins it at the end, then the
  // new one takes the next letter after that.
  const renames = bare.map((e, i) => ({ id: e.id, to: `${b} ${letterAt(highest + 1 + i)}` }));
  return { label: `${b} ${letterAt(highest + 1 + bare.length)}`, renames };
}

/**
 * Pull a room and its A / B / C reference back apart: "Bed 5 A" → Bed 5, A.
 *
 * The letter is not stored anywhere separate — `nextRoomLabel` writes it into
 * the label itself, and that label travels as the line item's `location` all
 * the way to the purchase order. Reading it back out is what lets the quote
 * show one heading per room instead of one per window.
 *
 * Returns `letter: ''` when there is no suffix to take.
 */
export function splitRoomLabel(label) {
  const raw = norm(label);
  const m = raw.match(SUFFIX_RE);
  if (!m) return { room: raw, letter: '', index: -1 };
  const index = indexOfLetter(m[2]);
  if (index < 0 || !norm(m[1])) return { room: raw, letter: '', index: -1 };
  return { room: norm(m[1]), letter: m[2].toUpperCase(), index };
}

/**
 * Capitalise a room's first letter, leave everything else alone.
 *
 * Rooms are typed in a hurry on site — "north master northeast", "butlers
 * pantry" — and then printed on a quote the customer reads. Only the first
 * letter is touched: title-casing the lot would fight names that are
 * deliberately cased ("Bed 2 A", "TV room") and there is no way to tell those
 * from a typo.
 */
export const capitaliseRoom = (s) => {
  const t = norm(s);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

/** "Bed 5" + "B" → "Bed 5 B". The inverse of `splitRoomLabel`, for POs etc. */
export const formatRoomRef = (room, ref) => (ref ? `${norm(room)} ${ref}` : norm(room));

/**
 * Group line items into rooms, and each room into lettered entries.
 *
 * The letters are READ from the data, never renumbered. A room that already
 * has A, B and D keeps that gap, because the workroom is holding a purchase
 * order that says D and renaming it here would send someone to the wrong
 * window. Only rooms whose locations were typed by hand with no letters at all
 * get positional ones.
 *
 * @param {Array}  items
 * @param {Object} opts
 * @param {Function} opts.locationOf  (item) => string, default `item.location`
 * @param {Function} opts.entryKeyOf  (item) => string|null. Items in the same
 *   room sharing a key collapse into ONE lettered entry — three motor options
 *   for one window are window B, not windows B, C and D.
 * @param {string} opts.fallbackRoom  heading for items with no location
 * @returns {Array<{room: string, entries: Array<{ref: string, key: string, items: Array}>}>}
 */
export function groupByRoom(items = [], opts = {}) {
  const locationOf = opts.locationOf || (it => it?.location || '');
  const entryKeyOf = opts.entryKeyOf || (() => null);
  const fallback   = opts.fallbackRoom || 'General';

  const parsed = items.map((item, i) => {
    const full = norm(locationOf(item)) || fallback;
    return { item, i, full, split: splitRoomLabel(full) };
  });

  // A suffix only means "window X of room Y" if something else is in room Y.
  // Otherwise a lone "Unit A" or "Living Room TV" would lose half its name to
  // a letter nobody meant.
  const roomKeyOf = (p) => key(p.split.letter ? p.split.room : p.full);
  const tally = new Map();
  parsed.forEach(p => { const k = roomKeyOf(p); tally.set(k, (tally.get(k) || 0) + 1); });
  parsed.forEach(p => {
    if (p.split.letter && tally.get(roomKeyOf(p)) < 2) p.split = { room: p.full, letter: '', index: -1 };
  });

  // Measure-sheet order carries through to the quote as `sortOrder`, so the
  // rooms and the windows inside them come out in the order they were measured.
  const seq = (p) => { const n = Number(p.item?.sortOrder); return Number.isFinite(n) ? n : p.i; };
  const order = [...parsed].sort((a, b) => (seq(a) - seq(b)) || (a.i - b.i));

  const byRoom = new Map();
  for (const p of order) {
    const rk = roomKeyOf(p);
    let room = byRoom.get(rk);
    if (!room) {
      room = { room: capitaliseRoom(p.split.letter ? p.split.room : p.full), entries: [], byKey: new Map() };
      byRoom.set(rk, room);
    }
    // The letter IS the window's identity, so everything carrying it lands in
    // one entry — a blind and a curtain both measured at "Bed 2 A" are two
    // lines on window A, not windows A and B. Only where no letter was ever
    // written does an entry fall back to one-per-line (or one per choice
    // group, which is a single decision about a single window).
    const ek = entryKeyOf(p.item);
    const eKey = p.split.letter ? `ref:${p.split.letter}`
      : (ek == null ? `item:${p.i}` : `group:${ek}`);
    let entry = room.byKey.get(eKey);
    if (!entry) {
      entry = { key: eKey, ref: p.split.letter, items: [] };
      room.byKey.set(eKey, entry);
      room.entries.push(entry);
    }
    entry.items.push(p.item);
    if (!entry.ref && p.split.letter) entry.ref = p.split.letter;
  }

  return [...byRoom.values()].map(({ room, entries }) => {
    // One window in a room needs no letter — that is the same rule the plan
    // takeoff names by, so "Bed 5" stays "Bed 5" on the quote and the PO both.
    if (entries.length > 1) {
      const used = new Set(entries.map(e => e.ref).filter(Boolean));
      let next = 0;
      for (const e of entries) {
        if (e.ref) continue;
        while (used.has(letterAt(next))) next++;
        e.ref = letterAt(next);
        used.add(e.ref);
      }
    } else {
      entries.forEach(e => { e.ref = ''; });
    }
    return { room, entries };
  });
}
