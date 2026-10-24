/**
 * Shared logic for bringing a supplier price list into the price library.
 *
 * Two importers feed the same library — the Quotient CSV one and the supplier
 * PDF reader — and they used to answer "is this already here?" differently:
 * the PDF reader flagged a row as a duplicate on name OR code, then at import
 * time decided insert-vs-update on code ALONE. Nearly every fabric in the
 * library has no code, so a row shown as "duplicate" would have been inserted
 * as a second copy. Matching lives here now so the two cannot disagree.
 *
 * The other half is the question an importer should actually be asking. A
 * price-list refresh is mostly rows that have not moved; asking someone to
 * confirm all 299 is asking them to confirm none of them. So what CHANGED is
 * computed up front, and only that is offered for import.
 */

/** Fields worth comparing, in the order they're worth reading. */
export const DIFF_FIELDS = [
  { key: 'costPrice',     label: 'Cost',       money: true },
  { key: 'sellPrice',     label: 'Sell',       money: true },
  { key: 'fabricWidthMm', label: 'Roll width', unit: 'mm' },
  { key: 'supplier',      label: 'Supplier'  },
  { key: 'category',      label: 'Category'  },
  { key: 'unitType',      label: 'Unit'      },
];

/**
 * Loose equality for price-list values.
 *
 * Numbers are compared as numbers: a stored price arrives from the database as
 * a string ("30.0000"), and comparing that to 30 as text marks every row on the
 * sheet as changed, which defeats the point of looking for changes at all.
 */
export const sameValue = (a, b) => {
  const an = Number(a), bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return Math.abs(an - bn) < 0.005;
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
};

const lc = (v) => String(v ?? '').trim().toLowerCase();

/**
 * The library item this incoming row refers to, by code first then name.
 *
 * Code is the stronger signal, but most of this library has none — the fabric
 * ranges are identified by name — so name has to count, and has to count the
 * same way at every step.
 */
export function matchExistingItem(existing = [], incoming = {}) {
  const code = lc(incoming.itemCode);
  const name = lc(incoming.itemName);
  if (code) {
    const byCode = existing.find(p => lc(p.itemCode) && lc(p.itemCode) === code);
    if (byCode) return { item: byCode, on: 'code' };
  }
  if (name) {
    const byName = existing.find(p => lc(p.itemName) === name);
    if (byName) return { item: byName, on: 'name' };
  }
  return null;
}

/**
 * What this incoming row would actually change about the item it matched.
 *
 * Only fields the sheet SUPPLIES are compared, because those are the only ones
 * an update writes — a column the sheet doesn't carry is not a change to zero,
 * it is simply absent.
 *
 * `ignore` is for fields that did not come from the price list at all. The PDF
 * reader applies one supplier and one category to every row from form inputs
 * above the table, so comparing them would mark all 300 rows "changed" because
 * the operator typed the supplier slightly differently this time — burying the
 * two prices that actually moved.
 */
export function diffAgainstExisting(existing, incoming, { ignore = [] } = {}) {
  if (!existing) return [];
  const out = [];
  for (const f of DIFF_FIELDS) {
    if (ignore.includes(f.key)) continue;
    const to = incoming?.[f.key];
    if (to === undefined || to === null || to === '') continue;
    const from = f.key === 'unitType' ? (existing.unitType ?? existing.unit) : existing[f.key];
    if (sameValue(from, to)) continue;
    out.push({ ...f, from: from ?? null, to });
  }
  return out;
}

/** Changed / unchanged / new, plus how the prices moved. Used for the summary. */
export function summariseImport(rows = []) {
  const s = { changed: 0, unchanged: 0, fresh: 0, rises: 0, drops: 0 };
  for (const r of rows) {
    if (!r.existing) { s.fresh++; continue; }
    if (!r.changes?.length) { s.unchanged++; continue; }
    s.changed++;
    const cost = r.changes.find(c => c.key === 'costPrice');
    if (cost) { if (Number(cost.to) > Number(cost.from)) s.rises++; else s.drops++; }
  }
  return s;
}
