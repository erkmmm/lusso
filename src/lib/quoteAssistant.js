// This workflow prepares drafts. Supplier evidence is data, never authority to
// send a quote, place an order, change specifications or invent missing prices.
export const SUPPLIER_PORTALS = {
  BUZ: 'https://go.buzmanager.com/Sales/NewSale',
  FHA: 'https://online.fhawholesale.com.au/Order/PurchaseOrderHeaderDetails',
};
export const QUOTING_RULES = [
  'Use BUZ for roller blinds and FHA for curtains; keep supplier work as quotations or drafts.',
  'CRM material and labour costs are ex GST. Preserve existing margins and manual selling-price overrides.',
  'Include remotes and chargers in BUZ. Lusso adds them automatically: exclude their component costs from covering costs to avoid double counting.',
  'A motorised room uses one remote: 15-channel for multiple blinds, 1-channel for one. Battery chargers: one per four blinds rounded up; none for 240V.',
  'Use existing curtain making and fitting rates. Never reuse a previous job’s labour, discount, dimensions or fabric choices as defaults.',
  'Confirm heading, lining, fixing, opening direction, bracket arrangement and measurement allowances. Do not infer them from another job.',
  'Only attach customer-approved warranty/care documents for the actual selected product. Do not invent warranty eligibility.',
];
export function supplierForLine(line) {
  const text = `${line.productNameSnapshot || ''} ${line.productType || ''}`;
  if (/curtain|drapery/i.test(text)) return 'FHA';
  if (/roller/i.test(text)) return 'BUZ';
  return '';
}
export function supplierCostPerUnit(lineTotal, quantity, includesGst) {
  const amount = Number(lineTotal), qty = Number(quantity);
  if (lineTotal === '' || lineTotal == null || !Number.isFinite(amount) || amount < 0
    || !Number.isFinite(qty) || qty <= 0) throw new Error('Enter a valid supplier line total and quantity.');
  return Math.round(amount / qty / (includesGst ? 1.1 : 1) * 10000) / 10000;
}
export function parseSupplierMatches(reply, lines, source) {
  const text = String(reply).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.matches)) throw new Error('The assistant did not return a price match list. Try again or enter the costs below.');
  const allowed = new Set(lines.map(l => l.id));
  const seen = new Set();
  const matches = parsed.matches.map(match => {
    if (!allowed.has(match.lineId) || seen.has(match.lineId)) throw new Error('The price matches contain an unknown or duplicate opening. Review the supplier text.');
    seen.add(match.lineId);
    const evidence = String(match.evidence || '').trim();
    const amount = Number(match.lineTotal);
    if (!evidence || !source.includes(evidence) || match.lineTotal === '' || match.lineTotal == null
      || !Number.isFinite(amount) || amount < 0) throw new Error('A price match has no verifiable supplier evidence. Enter that cost manually.');
    const numbers = evidence.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || [];
    if (!numbers.some(n => Number(n) === amount)) throw new Error('A suggested cost does not appear in its supplier evidence. Enter that cost manually.');
    return { lineId: match.lineId, lineTotal: amount, evidence };
  });
  return { matches, questions: Array.isArray(parsed.questions) ? parsed.questions.map(String) : [] };
}
export function quotePreparationIssues(lines, costs, { reference, reviewed, sourceSheetCurrent = true } = {}) {
  const issues = [];
  if (!sourceSheetCurrent) issues.push('The measure sheet changed. Reload this workspace before preparing the quote.');
  if (!lines.length) issues.push('Choose a measure sheet with items to quote.');
  if (!String(reference || '').trim()) issues.push('Record the supplier quote reference or pricing source.');
  if (!reviewed) issues.push('Confirm that you have reviewed specifications, costs and accessory exclusions.');
  for (const line of lines) {
    const label = line.location || 'Unnamed opening';
    const cost = costs[line.id] || {};
    if (!supplierForLine(line)) issues.push(`${label}: this first version supports roller blinds and curtains.`);
    if (!(Number(line.widthMm) > 0) || !(Number(line.dropMm) > 0)) issues.push(`${label}: record width and drop on the measure sheet.`);
    if (!(Number(line.quantity || 1) > 0)) issues.push(`${label}: quantity must be positive.`);
    if (!line.fabricColour?.trim()) issues.push(`${label}: confirm the fabric and colour on the measure sheet.`);
    if (cost.lineTotal === '' || cost.lineTotal == null || !(Number(cost.lineTotal) > 0)) issues.push(`${label}: enter the complete covering supplier cost.`);
    if (cost.labour === '' || cost.labour == null || !Number.isFinite(Number(cost.labour)) || Number(cost.labour) < 0) issues.push(`${label}: confirm labour per unit (enter 0 only if none applies).`);
    if (cost.margin === '' || cost.margin == null || !Number.isFinite(Number(cost.margin)) || Number(cost.margin) < 0 || Number(cost.margin) >= 100) issues.push(`${label}: confirm a margin from 0 to below 100%.`);
  }
  return issues;
}
export function buildQuotingBrief({ job, customer, sheet, instructions = '' }) {
  return JSON.stringify({
    purpose: 'Prepare a draft quote for review only. Do not send or order.',
    jobNumber: job.jobNumber, customer: customer?.name, siteAddress: customer?.address,
    measureSheetId: sheet.id, measureSheetUpdatedAt: sheet.updatedAt,
    instructions, rules: QUOTING_RULES,
    openings: (sheet.lineItems || []).map(line => ({ ...line, supplier: supplierForLine(line) })),
  }, null, 2);
}
