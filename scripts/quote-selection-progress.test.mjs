import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteSections, quoteSelectionProgress } from '../src/lib/quoteSections.js';

const options = Array.from({ length: 12 }, (_, i) => ['chain', 'battery', '240v'].map(operation => ({
  id: `${i}-${operation}`, type: 'Multiple Choice', location: `Office ${i + 1}`,
  productNameSnapshot: `${operation} Roller Blind`,
}))).flat();
const hub = { id: 'hub', type: 'Optional', location: 'Smart control', productNameSnapshot: 'WiFi hub' };
const remotes = [{ id: 'remote', type: 'Part', location: 'Office 1', productNameSnapshot: 'Remote' }];
const defaults = options.filter(li => li.id.endsWith('chain')).map(li => li.id);

test('12 three-way blind choices and an optional hub show 12 of 12 choices, not 12 of 37', () => {
  assert.deepEqual(quoteSelectionProgress(quoteSections([...options, hub]), defaults), {
    choicesMade: 12, choiceCount: 12, extrasAdded: 0, extraCount: 1,
  });
});

test('switching operation leaves the choice count unchanged; adding the hub only changes extras', () => {
  const selected = defaults.filter(id => id !== '0-chain').concat('0-240v', 'hub');
  assert.deepEqual(quoteSelectionProgress(quoteSections([...options, hub, ...remotes]), selected), {
    choicesMade: 12, choiceCount: 12, extrasAdded: 1, extraCount: 1,
  });
});

test('unanswered choices reduce completion, without counting alternatives or quantities', () => {
  const lines = options.map(li => ({ ...li, quantity: 4 }));
  assert.deepEqual(quoteSelectionProgress(quoteSections(lines), defaults.slice(1)), {
    choicesMade: 11, choiceCount: 12, extrasAdded: 0, extraCount: 0,
  });
});

test('distinct groups at the same opening remain distinct decisions', () => {
  const lines = ['blind', 'curtain'].flatMap(group => ['manual', 'motor'].map(op => ({
    id: `${group}-${op}`, location: 'Master', type: 'Multiple Choice', choiceGroupId: group,
  })));
  assert.deepEqual(quoteSelectionProgress(quoteSections(lines), ['blind-motor']), {
    choicesMade: 1, choiceCount: 2, extrasAdded: 0, extraCount: 0,
  });
});

test('optional-only and included-only quotes have no phantom choices', () => {
  assert.deepEqual(quoteSelectionProgress(quoteSections([hub]), ['hub']), {
    choicesMade: 0, choiceCount: 0, extrasAdded: 1, extraCount: 1,
  });
  assert.deepEqual(quoteSelectionProgress(quoteSections([...remotes, { id: 'blind', type: 'Required' }]), []), {
    choicesMade: 0, choiceCount: 0, extrasAdded: 0, extraCount: 0,
  });
});
