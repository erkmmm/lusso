/**
 * When the next post lands.
 *
 * The drip is a list of slots — "two at 9am, two at 2pm" — in the business's own
 * timezone. Lusso stores that as a JSON file in a repo and lets a GitHub Action
 * decide, hourly, whether the hour it woke in is a slot. Nothing can say what
 * date a given queued page will publish on; the Content page can only divide the
 * queue depth by a posts-per-day figure and call it "N days of drip".
 *
 * Here the slot is resolved to an actual timestamp the moment a post is queued,
 * so the app shows the date each page lands rather than an estimate of it — and
 * a date the user can then drag to whenever they like.
 *
 * No date library: Intl already knows every timezone's offset, and adding one to
 * do arithmetic we can do in twenty lines is a dependency to keep current.
 */

/** How far the zone is from UTC at that instant, in milliseconds. */
function offsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  // `hour` comes back as 24 at midnight under hour12:false, which Date.UTC would
  // roll into the next day and put the offset a full day out.
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

/** The instant that is `hour`:00 on the given local calendar day in `timeZone`. */
function slotInstant(year, month, day, hour, timeZone) {
  const guess = Date.UTC(year, month, day, hour, 0, 0);
  // Correct the guess by the offset in force at the guess. One pass is exact
  // everywhere except the hour a DST transition lands in, where it is off by an
  // hour — a publishing time, not a booking, so an hour either way is survivable.
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

/** That instant's calendar parts in `timeZone`, so we can walk local days. */
function localParts(date, timeZone) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { year: +p.year, month: +p.month - 1, day: +p.day };
}

/**
 * The first slot with room in it, at or after `from`.
 *
 * @param {{hour:number,count:number}[]} slots
 * @param {string} timeZone
 * @param {(string|Date)[]} taken  scheduled_for of everything already booked
 * @param {Date} [from]
 * @returns {Date|null} null when the slot list is empty — nothing to schedule into
 */
export function nextFreeSlot(slots, timeZone, taken = [], from = new Date()) {
  const ordered = [...(slots || [])]
    .filter(s => Number.isFinite(s?.hour) && s?.count > 0)
    .sort((a, b) => a.hour - b.hour);
  if (!ordered.length) return null;

  // Bucketed by exact instant: a slot is full when it already holds `count`.
  const used = new Map();
  for (const t of taken) {
    if (!t) continue;
    const k = new Date(t).getTime();
    used.set(k, (used.get(k) || 0) + 1);
  }

  const start = localParts(from, timeZone);
  // 120 local days is four months of runway. A queue deeper than that is a
  // problem to surface, not to silently schedule into next year.
  for (let d = 0; d < 120; d++) {
    for (const slot of ordered) {
      const when = slotInstant(start.year, start.month, start.day + d, slot.hour, timeZone);
      if (when <= from) continue;
      if ((used.get(when.getTime()) || 0) < slot.count) return when;
    }
  }
  return null;
}

/** Posts a day, the way the publisher counts them. */
export const perDay = (slots) =>
  (slots || []).reduce((n, s) => n + (Number(s?.count) || 0), 0);
