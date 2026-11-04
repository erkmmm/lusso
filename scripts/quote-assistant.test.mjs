import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierCostPerUnit, parseSupplierMatches, quotePreparationIssues, buildQuotingBrief } from '../src/lib/quoteAssistant.js';
const line = { id: 'a', location: 'Dining A', productNameSnapshot: 'Battery-operated roller blind', widthMm: 1000, dropMm: 2000, quantity: 2, fabricColour: 'Vibe Ice' };
const costs = { a: { lineTotal: 1100, labour: 60, margin: 42.5 } };
test('GST and quantity are converted once from supplier line total to unit cost', () => {
  assert.equal(supplierCostPerUnit(1100, 2, true), 500);
  assert.equal(supplierCostPerUnit(1100, 2, false), 550);
  assert.throws(() => supplierCostPerUnit('', 2, false));
  assert.throws(() => supplierCostPerUnit(10, 0, true));
});
test('AI prices must cite exact supplied evidence and an existing opening', () => {
  const source = 'Dining A total $1,100.00';
  const match = { lineId: 'a', lineTotal: 1100, evidence: source };
  assert.equal(parseSupplierMatches(JSON.stringify({ matches: [match] }), [line], source).matches[0].lineTotal, 1100);
  for (const bad of [{...match,lineId:'other'}, {...match,evidence:'invented'}, {...match,lineTotal:999}, {...match,lineTotal:null}]) {
    assert.throws(() => parseSupplierMatches(JSON.stringify({matches:[bad]}), [line], source));
  }
  assert.throws(() => parseSupplierMatches(JSON.stringify({matches:[match,match]}), [line], source));
});
test('draft preparation requires real costs, explicit labour, source and review', () => {
  assert.equal(quotePreparationIssues([line], costs, { reference:'BUZ 123', reviewed:true }).length, 0);
  assert.ok(quotePreparationIssues([line], {a:{...costs.a,labour:''}}, {reference:'123',reviewed:true}).some(x=>x.includes('labour')));
  assert.ok(quotePreparationIssues([line], costs, {reference:'123',reviewed:true,sourceSheetCurrent:false}).some(x=>x.includes('changed')));
  assert.ok(quotePreparationIssues([line], costs).length >= 2);
});
test('brief preserves each original spec and does not turn historic job assumptions into rules', () => {
  const brief=JSON.parse(buildQuotingBrief({job:{jobNumber:'LUS-1'},customer:{name:'Matt'},sheet:{id:'s',lineItems:[{...line,notes:'check measure before order',attachedLining:true}]}}));
  assert.equal(brief.openings[0].quantity,2);
  assert.equal(brief.openings[0].notes,'check measure before order');
  assert.equal(brief.openings[0].supplier,'BUZ');
  assert.ok(brief.purpose.includes('Do not send or order'));
  assert.equal(JSON.stringify(brief.rules).includes('60'),false);
});
