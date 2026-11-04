import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMotorisedCovering,
  isBatteryPowered,
  motorisationAccessories,
  withMotorisationAccessories,
} from '../src/lib/motorisationAccessories.js';

const blind = (id, operation, location = 'Office 3 A', extra = {}) => ({
  id, type: 'Multiple Choice', quantity: 1, location,
  productNameSnapshot: `Lusso 40mm ${operation} Verosol Silver Screen Roller Blind`,
  description: `203 dark grey lusso 40mm ${operation.toLowerCase()} verosol silver screen roller blind with Rev roll heading, Reveal fix`,
  ...extra,
});
const roles = (lines) => lines.map(li => [li.autoKind, li.location, li.quantity]);

test('240V product names are powered coverings without a battery', () => {
  for (const operation of ['240V-Operated', '240v-operated', '240V', '240 V', '240VAC']) {
    const line = blind(operation, operation);
    assert.equal(isMotorisedCovering(line), true, operation);
    assert.equal(isBatteryPowered(line), false, operation);
  }
});

const quote = ['A', 'B'].flatMap(ref => ['Chain-Operated', 'Battery-Operated', '240V-Operated'].map(op =>
  blind(`${ref}-${op}`, op, `Office 3 ${ref}`)));
const selected = op => quote.filter(li => li.productNameSnapshot.includes(op)).map(li => li.id);

test('switching the same opening from battery to 240V keeps its remote and removes its charger', () => {
  const battery = motorisationAccessories(quote, ['A-Battery-Operated']);
  const mains = motorisationAccessories(quote, ['A-240V-Operated']);
  assert.deepEqual(roles(battery), [['remote', 'Office 3', 1], ['charger', 'Whole job', 1]]);
  assert.deepEqual(roles(mains), [['remote', 'Office 3', 1]]);
  assert.equal(mains[0].productNameSnapshot, battery[0].productNameSnapshot);
});

test('two 240V blinds in one room use the same 15-channel handset as two battery blinds', () => {
  const battery = motorisationAccessories(quote, selected('Battery-Operated'));
  const mains = motorisationAccessories(quote, selected('240V-Operated'));
  assert.deepEqual(roles(mains), [['remote', 'Office 3', 1]]);
  assert.equal(mains[0].productNameSnapshot, battery[0].productNameSnapshot);
  assert.match(mains[0].productNameSnapshot, /15 Channel/);
});

test('mixed operations share one room remote; only battery quantity counts toward chargers', () => {
  const lines = [
    blind('battery', 'Battery-Operated', 'Office 3 A', { quantity: 4 }),
    blind('mains', '240V-Operated', 'Office 3 B', { quantity: 8 }),
    blind('other', '240V-Operated', 'Office 4'),
  ];
  assert.deepEqual(roles(motorisationAccessories(lines, lines.map(li => li.id))), [
    ['remote', 'Office 3', 1], ['remote', 'Office 4', 1], ['charger', 'Whole job', 1],
  ]);
});

test('manual and unselected motor alternatives add nothing', () => {
  assert.deepEqual(motorisationAccessories(quote, selected('Chain-Operated')), []);
  assert.deepEqual(motorisationAccessories(quote, []), []);
});

test('240V components and accessories are not treated as blinds', () => {
  for (const name of ['240V Motor', '240V Remote Control', '240V Roller Blind Motor', '240V Hub', '240V Transformer']) {
    assert.equal(isMotorisedCovering({ productNameSnapshot: name }), false, name);
  }
  assert.equal(isMotorisedCovering(blind('part', '240V-Operated', 'Office 3', { type: 'Part' })), false);
});

test('manual remote lines and the existing approval gate still prevent automatic additions', () => {
  const remote = { id: 'remote', type: 'Part', productNameSnapshot: 'Acmeda 15-Channel Remote' };
  assert.deepEqual(motorisationAccessories([...quote, remote], selected('240V-Operated')), []);
  for (const approval of ['pending', 'added', 'declined']) {
    assert.deepEqual(motorisationAccessories(quote, selected('240V-Operated'), null, approval), []);
  }
});

test('resolving the quote repeatedly does not duplicate 240V remotes', () => {
  const once = withMotorisationAccessories(quote, selected('240V-Operated'));
  const twice = withMotorisationAccessories(once, selected('240V-Operated'));
  assert.deepEqual(twice, once);
  assert.equal(once.length, quote.length + 1);
});
