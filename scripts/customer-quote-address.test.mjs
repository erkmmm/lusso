import test from 'node:test';
import assert from 'node:assert/strict';
import { customerQuoteAddressUpdates as updates } from '../src/lib/customerQuoteAddress.js';
const before = { id: 'matt', address: 'Hollywell' };
const after = { id: 'matt', address: '21 Magellan Ave, Holleywell' };
const quote = { id: 'q', customerId: 'matt', siteAddress: 'Hollywell', grandTotal: 13441.41,
  status: 'Draft', lineItems: [{ id: 'curtain', unitCostPrice: 999 }], attachments: [{ id: 'warranty' }] };
test('customer correction updates inherited address on drafts, sent and accepted quotes', () => {
  for (const status of ['Draft', 'Sent', 'Viewed', 'Accepted']) {
    const [changed] = updates([{ ...quote, status }], before, after, 'now');
    assert.deepEqual(changed, { ...quote, status, siteAddress: after.address, updatedAt: 'now' });
    assert.equal(changed.lineItems, quote.lineItems);
    assert.equal(changed.attachments, quote.attachments);
  }
});
test('different sites, other customers and deleted quotes are preserved', () => {
  assert.deepEqual(updates([{ ...quote, siteAddress: 'Separate investment property' },
    { ...quote, customerId: 'carole' }, { ...quote, deletedAt: 'then' }], before, after, 'now'), []);
});
test('blank quote addresses inherit corrections and matching ignores case and whitespace', () => {
  const result = updates([{ ...quote, siteAddress: null }, { ...quote, id: 'q2', siteAddress: '  HOLLYWELL  ' }], before, after, 'now');
  assert.equal(result.length, 2);
  assert.ok(result.every(q => q.siteAddress === after.address));
});
test('new customers, unrelated edits and unchanged addresses do not rewrite quotes', () => {
  assert.deepEqual(updates([quote], undefined, after, 'now'), []);
  assert.deepEqual(updates([quote], before, { id: 'matt', phone: '123' }, 'now'), []);
  assert.deepEqual(updates([quote], before, { ...before, address: ' HOLLYWELL ' }, 'now'), []);
});
test('explicitly clearing a client address clears inherited sites only', () => {
  assert.equal(updates([quote], before, { ...before, address: '' }, 'now')[0].siteAddress, '');
  assert.equal(quote.siteAddress, 'Hollywell');
});
