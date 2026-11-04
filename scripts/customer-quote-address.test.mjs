import test from 'node:test';
import assert from 'node:assert/strict';
import { customerQuoteAddressUpdates as updates, projectQuoteAddressUpdates } from '../src/lib/customerQuoteAddress.js';
const before = { id: 'matt', address: 'Hollywell' };
const after = { id: 'matt', address: '21 Magellan Ave, Holleywell' };
const quote = { id: 'q', customerId: 'matt', siteAddress: 'Hollywell', grandTotal: 13441.41,
  status: 'Draft', lineItems: [{ id: 'curtain', unitCostPrice: 999 }], attachments: [{ id: 'warranty' }] };
test('drafts follow customer corrections while historical customer versions remain unchanged', () => {
  const [changed]=updates([quote],before,after,'now');
  assert.deepEqual(changed,{...quote,siteAddress:after.address,updatedAt:'now'});
  assert.equal(changed.lineItems,quote.lineItems);
  for(const status of ['Sent','Viewed','Accepted'])assert.deepEqual(updates([{...quote,status}],before,after,'now'),[]);
});
test('legacy sent quotes freeze their previously inherited address',()=>{
 const [changed]=updates([{...quote,status:'Sent',siteAddress:''}],before,after,'now');assert.equal(changed.siteAddress,before.address);
});
test('project address corrections affect inherited drafts only',()=>{
 const old={id:'j',siteAddress:'Site A'},next={...old,siteAddress:'Site B'};
 const inherited={...quote,jobId:'j',siteAddress:'Site A'};
 const result=projectQuoteAddressUpdates([inherited,{...inherited,id:'manual',siteAddress:'Other site'},{...inherited,id:'sent',status:'Sent'}],old,next,before,'now');
 assert.deepEqual(result,[{...inherited,siteAddress:'Site B',updatedAt:'now'}]);
 assert.equal(updates([{...quote,jobId:'j'}],before,after,'now',[next])[0].siteAddress,'Site B');
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
