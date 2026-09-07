/**
 * Replays the 2026-09-07 data loss against the guards, in the same order it
 * happened. These are the regressions that must never come back.
 */
let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);
};

// ── The scorer + guard, mirrored from src/store/data.js ──────────────────────
const sheetContentScore = (sheet) => {
  let n = 0;
  for (const li of sheet?.lineItems || []) {
    if (String(li.location || '').trim())     n++;
    if (String(li.widthMm  || '').trim())     n++;
    if (String(li.dropMm   || '').trim())     n++;
    if (String(li.fabricColour || '').trim()) n++;
    if (li.productTypeId || li.pricedItemId)  n++;
    if ((li.photoPaths || []).length)         n += 2;
  }
  return n;
};
const wouldDestroyContent = (incoming, stored) => {
  if (!stored) return false;
  const s = sheetContentScore(stored), i = sheetContentScore(incoming);
  if (s === 0) return false;
  return (i === 0 && s > 0) || i < s / 3;
};

const blank = () => ({ id: 'x', lineItems: [{ id: 'a', location: '', widthMm: '', dropMm: '',
  fabricColour: '', productTypeId: '', pricedItemId: null, photoPaths: [] }] });
const line = (n) => ({ id: `l${n}`, location: `Room ${n}`, widthMm: '1800', dropMm: '2400',
  fabricColour: 'Arctic White', productTypeId: 'pt-1', photoPaths: [] });
const house = (n) => ({ id: 'x', lineItems: Array.from({ length: n }, (_, i) => line(i + 1)) });

// ── THE INCIDENT ────────────────────────────────────────────────────────────
t('a measured house scores > 0',            sheetContentScore(house(14)) > 0, true);
t('the blank sheet scores 0',               sheetContentScore(blank()), 0);
t('INCIDENT: blank over a house is refused', wouldDestroyContent(blank(), house(14)), true);
t('INCIDENT: blank over one measured line is refused', wouldDestroyContent(blank(), house(1)), true);

// ── Legitimate edits must still go through ──────────────────────────────────
t('adding a line is fine',                  wouldDestroyContent(house(15), house(14)), false);
t('editing in place is fine',               wouldDestroyContent(house(14), house(14)), false);
t('deleting 1 of 14 is fine',               wouldDestroyContent(house(13), house(14)), false);
t('deleting half is fine',                  wouldDestroyContent(house(7),  house(14)), false);
t('deleting down to a third is fine',       wouldDestroyContent(house(5),  house(14)), false);
t('deleting 13 of 14 is refused w/o allowShrink', wouldDestroyContent(house(1), house(14)), true);
t('first save of a new sheet is fine',      wouldDestroyContent(house(3), null), false);
t('blank over blank is fine',               wouldDestroyContent(blank(), blank()), false);
t('a fresh blank sheet can be created',     wouldDestroyContent(blank(), null), false);

// ── SAFETY GUARD 3: hydration must not let a thin server row win ────────────
const guard3 = (sb, loc) => {
  const s = sheetContentScore(sb), l = sheetContentScore(loc);
  return l > 0 && s < l / 3;   // true = keep local
};
t('GUARD3: blank server row never replaces a measured local one', guard3(blank(), house(14)), true);
t('GUARD3: a fuller server row is accepted', guard3(house(14), house(14)), false);
t('GUARD3: a slightly smaller server row is accepted', guard3(house(12), house(14)), false);
t('GUARD3: no local content = server wins', guard3(house(14), blank()), false);

// ── The journal must keep the richest version, not just the newest ──────────
const trimKeeps = (versions, max) => {
  const best = versions.reduce((a, b) => (b.score > a.score ? b : a), versions[0]);
  const keep = new Set([best.key, ...versions.slice(0, max - 1).map(v => v.key)]);
  return [...keep];
};
// 40 blank autosaves after one good one — the good one must survive.
const good = { key: 'good', at: 1, score: 70 };
const blanks = Array.from({ length: 45 }, (_, i) => ({ key: `b${i}`, at: 100 + i, score: 0 }));
const newestFirst = [...blanks].reverse().concat(good);
t('journal pins the richest version through 45 blank saves',
  trimKeeps(newestFirst, 40).includes('good'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
