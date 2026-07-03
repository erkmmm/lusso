/**
 * Quotient quote-history import — pure mapping logic (no store access, so it
 * is unit-testable in Node and reusable from the import page).
 *
 * Input: rows from two Quotient export types, uploaded in any number of files:
 *   • "Summary of Quotes"          — one row per quote (customer, total, status, dates)
 *   • "Price Items within Quotes"  — one row per line item, joined by quote number
 *
 * Verified against real exports: the summary "Total value" is tax-exclusive
 * and equals the sum of item totals (item-level discounts are already baked
 * into "Item total"; unselected "Optional" items are excluded), minus the
 * rare "Overall discount" percentage.
 */

const money = (s) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// ── File classification ────────────────────────────────────────────────────────
// Decide what a CSV is from its header row.
export function classifyQuotientCsv(headers) {
  const h = new Set(headers.map(x => x.toLowerCase()));
  if (h.has('quote number') && h.has('item title')) return 'items';
  if (h.has('quote number') && h.has('quote title') && h.has('total value')) return 'summary';
  return 'unknown';
}

// ── Status mapping ─────────────────────────────────────────────────────────────
// "Awaiting Acceptance" maps to Waiting (truthful — the customer never
// decided; the dashboard's pipeline metric applies its own recency window so
// decade-old Waiting quotes don't inflate it). Withdrawn maps to Declined.
const STATUS_MAP = {
  'accepted':            'Accepted',
  'declined':            'Declined',
  'expired':             'Expired',
  'awaiting acceptance': 'Waiting',
  'withdrawn':           'Declined',
  'draft':               'Draft',
  'sent':                'Sent',
};

function toIso(s) {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Plan builder ───────────────────────────────────────────────────────────────
/**
 * @param summaryRows  merged rows (objects) from all summary CSVs
 * @param itemRows     merged rows (objects) from all item CSVs
 * @param existing     { customers: [{id,name,email}], quoteNumbers: Set<string> }
 * @returns { newCustomers, quotes, stats, warnings }
 */
export function buildQuotientImportPlan(summaryRows, itemRows, existing) {
  const warnings = [];

  // Dedupe summaries by quote number (overlapping exports: last row wins).
  const byNumber = new Map();
  summaryRows.forEach(r => { if (r['Quote number']) byNumber.set(String(r['Quote number']), r); });

  // Group items by quote number, preserving order.
  const itemsByQuote = new Map();
  itemRows.forEach(r => {
    const n = String(r['Quote number'] || '');
    if (!n) return;
    if (!itemsByQuote.has(n)) itemsByQuote.set(n, []);
    itemsByQuote.get(n).push(r);
  });

  // Existing customer lookup: email first, then exact name (case-insensitive).
  const custByEmail = new Map();
  const custByName  = new Map();
  existing.customers.forEach(c => {
    if (c.email) custByEmail.set(c.email.trim().toLowerCase(), c.id);
    if (c.name)  custByName.set(c.name.trim().toLowerCase(), c.id);
  });

  const newCustomers = [];           // customers to create
  const newCustByKey = new Map();    // key -> planned customer id
  const quotes = [];
  let skippedExisting = 0, matchedCustomers = 0;
  const years = {};

  for (const [num, s] of byNumber) {
    const quoteNumber = `QNT-${num}`;
    if (existing.quoteNumbers.has(quoteNumber)) { skippedExisting++; continue; }

    // ── Customer ──
    const name  = (s['For name'] || `${s['First name'] || ''} ${s['Last name'] || ''}`.trim() || 'Unknown customer').trim();
    const email = (s['Email'] || '').trim();
    const key   = (email || name).toLowerCase();
    let customerId = custByEmail.get(email.toLowerCase()) || custByName.get(name.toLowerCase()) || newCustByKey.get(key);
    if (customerId) {
      if (!newCustByKey.has(key)) matchedCustomers++;
    } else {
      customerId = `qnt-cust-${key.replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
      newCustByKey.set(key, customerId);
      newCustomers.push({
        id: customerId,
        name,
        email,
        phone: '',
        source: 'Quotient Import',
        notes: 'Imported from Quotient quote history.',
      });
    }

    // ── Line items ──
    const raw = (itemsByQuote.get(num) || []).filter(r => (r['Item title'] || '').trim() || money(r['Item total']) !== 0);
    if (!raw.length) warnings.push(`Quote ${quoteNumber}: no line items found in the item files.`);
    const overallDisc = money(s['Overall discount']); // percent, rare
    const selectedIds = [];
    const lineItems = raw.map((r, i) => {
      const id  = `qnt-${num}-li-${i}`;
      const opt = (r['Optional'] || '').trim().toLowerCase();
      const type = opt ? 'Optional' : 'Required';
      if (opt === 'optional, selected') selectedIds.push(id);
      const qty = money(r['Quantity']) || 1;
      // Item total already reflects item-level discounts; per-unit sell derives
      // from it. Overall discount (quote-level %) is folded in proportionally.
      let unitSell = money(r['Item total']) / qty;
      if (overallDisc) unitSell = unitSell * (1 - overallDisc / 100);
      return {
        id,
        type,
        productNameSnapshot: (r['Item title'] || '').trim() || 'Item',
        description: (r['Item code'] || '').trim(),
        quantity: qty,
        unitCostPrice: money(r['Cost price']),
        labourCost: 0,
        marginPercent: 0,
        manualSellPrice: Math.round(unitSell * 100) / 100,
        taxable: true,
        sortOrder: i,
      };
    });

    // ── Reconciliation (ex-GST): selected items must match the summary total.
    // The export's "Total value" already includes the overall discount, and we
    // folded that discount into the unit prices above — so compare directly.
    const computed = lineItems
      .filter(li => li.type === 'Required' || selectedIds.includes(li.id))
      .reduce((t, li) => t + li.manualSellPrice * li.quantity, 0);
    const expected = money(s['Total value']);
    if (raw.length && Math.abs(computed - expected) > 1) {
      warnings.push(`Quote ${quoteNumber}: items total $${computed.toFixed(2)} ≠ Quotient total $${expected.toFixed(2)} — imported as-is, check in Quotient.`);
    }

    // ── Status + dates ──
    const rawStatus = (s['Quote status'] || '').trim();
    const status = STATUS_MAP[rawStatus.toLowerCase()] || 'Expired';
    const sentAt = toIso(s['Sent when']);
    const lastChange = toIso(s['Last status change']) || sentAt;
    const year = (sentAt || '').slice(0, 4) || 'unknown';
    years[year] = (years[year] || 0) + 1;

    quotes.push({
      id: `qnt-${num}`,
      quoteNumber,
      title: (s['Quote title'] || '').trim() || `Quotient quote ${num}`,
      status,
      customerId,
      jobId: null,
      salesperson: (s['From name'] || '').trim(),
      expiryDate: (s['Expiry date'] || '').slice(0, 10) || null,
      depositType: 'None',
      depositValue: 0,
      includesGST: true,
      gstRate: 10,
      sentAt,
      acceptedAt: status === 'Accepted' ? lastChange : null,
      declinedAt: status === 'Declined' ? lastChange : null,
      lineItems,
      selectedLineItemIds: selectedIds,
      source: 'Quotient Import',
      importNote: rawStatus !== status ? `Quotient status was "${rawStatus}".` : '',
      createdAt: sentAt || lastChange || new Date(0).toISOString(),
      updatedAt: lastChange || sentAt || new Date(0).toISOString(),
    });
  }

  // Item rows whose quote never appears in any summary file.
  const orphanNums = [...itemsByQuote.keys()].filter(n => !byNumber.has(n));
  if (orphanNums.length) {
    warnings.push(`${orphanNums.length} quote number(s) appear in item files but not in any summary file (e.g. ${orphanNums.slice(0, 5).join(', ')}) — these were skipped. Upload the matching "Summary of Quotes" export(s).`);
  }

  return {
    newCustomers,
    quotes,
    warnings,
    stats: {
      totalInFiles: byNumber.size,
      toImport: quotes.length,
      skippedExisting,
      newCustomers: newCustomers.length,
      matchedCustomers,
      byYear: years,
      byStatus: quotes.reduce((m, q) => { m[q.status] = (m[q.status] || 0) + 1; return m; }, {}),
      totalValue: quotes.reduce((t, q) => t + q.lineItems
        .filter(li => li.type === 'Required' || q.selectedLineItemIds.includes(li.id))
        .reduce((s, li) => s + li.manualSellPrice * li.quantity, 0), 0),
    },
  };
}
