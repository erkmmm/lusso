/**
 * Budget estimate for a plan takeoff.
 *
 * A takeoff has sizes and product types but no fabric, no control, no supplier
 * — so it cannot be priced properly. What it CAN do is answer the question
 * actually being asked on site: "roughly what is this job worth?"
 *
 * The rate comes from the business's own history: the median $/m² actually
 * charged for that product type across past quotes. That beats a hand-entered
 * rate card because it drifts with real pricing on its own, and it's honest
 * about uncertainty — the spread of past quotes becomes the range shown.
 *
 * This is explicitly a BUDGET number. It never writes to a quote.
 */
import { getQuotes, getPricedItems, getProductTypes, linePricing } from '../store/data';

const MIN_SAMPLES = 4;           // below this the median is noise
const MAX_AGE_DAYS = 540;        // ~18 months; older pricing is stale
const OUTLIER_LO = 0.05;         // trim the tails before taking a median
const OUTLIER_HI = 0.95;

const median = (sorted) => {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Median $/m² per product type, keyed by BOTH product type id and lowercased
 * name — takeoff items carry an id, historic quote lines often only carry the
 * name snapshot.
 */
export function buildRateCard() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const buckets = new Map();

  const push = (key, rate) => {
    if (!key || !(rate > 0) || !Number.isFinite(rate)) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(rate);
  };

  for (const q of getQuotes() || []) {
    if (q.deletedAt) continue;
    const when = Date.parse(q.updatedAt || q.createdAt || '') || 0;
    if (when && when < cutoff) continue;
    for (const li of q.lineItems || []) {
      const w = Number(li.widthMm) || 0;
      const d = Number(li.dropMm) || 0;
      if (!(w > 0) || !(d > 0)) continue;
      const areaSqm = (w * d) / 1_000_000;
      if (areaSqm < 0.15) continue;               // sample/accessory lines
      const sell = li.unitCostPrice !== undefined
        ? linePricing(li).finalSell
        : (Number(li.unitPrice) || 0) + (Number(li.labourCost) || 0);
      if (!(sell > 0)) continue;
      const rate = sell / areaSqm;
      if (rate < 20 || rate > 4000) continue;     // clearly not a per-window price
      if (li.productTypeId) push(`id:${li.productTypeId}`, rate);
      const name = (li.productNameSnapshot || li.productType || '').trim().toLowerCase();
      if (name) push(`name:${name}`, rate);
    }
  }

  const card = new Map();
  for (const [key, rates] of buckets) {
    if (rates.length < MIN_SAMPLES) continue;
    const sorted = [...rates].sort((a, b) => a - b);
    const lo = quantile(sorted, OUTLIER_LO);
    const hi = quantile(sorted, OUTLIER_HI);
    const trimmed = sorted.filter(r => r >= lo && r <= hi);
    if (!trimmed.length) continue;
    card.set(key, {
      rate: median(trimmed),
      low: quantile(trimmed, 0.25),
      high: quantile(trimmed, 0.75),
      samples: rates.length,
      source: 'history',
    });
  }

  // Fall back to the priced-items library for types never quoted by size.
  for (const p of getPricedItems() || []) {
    const rate = Number(p.pricePerSqm) || 0;
    if (!(rate > 0)) continue;
    const keys = [p.productTypeId ? `id:${p.productTypeId}` : null,
                  p.productType ? `name:${String(p.productType).toLowerCase()}` : null].filter(Boolean);
    for (const k of keys) {
      if (card.has(k)) continue;
      card.set(k, { rate, low: rate * 0.85, high: rate * 1.15, samples: 0, source: 'price list' });
    }
  }
  return card;
}

/** Look a rate up by product type id, falling back to the type's name. */
export function rateFor(card, productTypeId, productName) {
  if (!card) return null;
  if (productTypeId && card.has(`id:${productTypeId}`)) return card.get(`id:${productTypeId}`);
  const name = (productName || '').trim().toLowerCase();
  if (name && card.has(`name:${name}`)) return card.get(`name:${name}`);
  return null;
}

/**
 * Estimate a set of takeoff items.
 * Items without a product type, or whose type has no history, are counted as
 * "unpriced" rather than silently valued at zero — a number the user can't see
 * the holes in is worse than no number.
 */
export function estimateTakeoff(items = [], card = null) {
  const rates = card || buildRateCard();
  const types = getProductTypes ? (getProductTypes() || []) : [];
  const typeName = (id) => types.find(t => t.id === id)?.name || '';

  let low = 0, mid = 0, high = 0, pricedCount = 0;
  const unpriced = [];

  for (const it of items) {
    const w = Number(it.widthMm) || 0;
    const d = Number(it.dropMm) || 0;
    const qty = Math.max(1, Number(it.quantity) || 1);
    const name = it.productNameSnapshot || typeName(it.productTypeId);
    const r = rateFor(rates, it.productTypeId, name);
    if (!(w > 0) || !(d > 0) || !r) {
      unpriced.push(it);
      continue;
    }
    // Makers charge a minimum size — a tiny window doesn't cost a tiny amount.
    const areaSqm = Math.max(0.5, (w * d) / 1_000_000);
    low  += r.low  * areaSqm * qty;
    mid  += r.rate * areaSqm * qty;
    high += r.high * areaSqm * qty;
    pricedCount += qty;
  }

  return {
    low, mid, high,
    pricedCount,
    unpricedCount: unpriced.length,
    unpriced,
    hasRates: rates.size > 0,
  };
}

export const fmtMoney = (n) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
