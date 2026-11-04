import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../src/store/db.js', import.meta.url), 'utf8');
const guard = source.slice(source.indexOf('const RETIRED_SETTINGS_VALUES'), source.indexOf('/**\n * Mirror the local settings'));
const vet = vm.runInNewContext(guard.replace('export function', 'function') + '\nvetBusinessSettings');
const existing = { businessName: 'Lusso', businessPhone: '0400 000 000', businessEmail: 'sales@example.com', businessAddress: 'Address', businessABN: 'ABN', paymentDetails: { bsb: '084-004', accountNumber: '1234', creditCardNote: 'Keep' }, warrantyText: 'Keep warranty' };
test('bank patch preserves live business details, warranty and unrelated payment fields', () => {
  const result = vet({ paymentDetails: { bsb: '014527', accountNumber: '498279909', accountName: 'Lusso Fashion for Windows' } }, existing, { partial: true });
  assert.equal(result.ok, true);
  assert.equal(result.payload.businessPhone, existing.businessPhone);
  assert.equal(result.payload.warrantyText, existing.warrantyText);
  assert.equal(result.payload.paymentDetails.creditCardNote, 'Keep');
  assert.equal(result.payload.paymentDetails.accountNumber, '498279909');
});
test('explicit retired placeholder remains rejected for partial saves', () => {
  assert.equal(vet({ businessPhone: '03 9000 1234' }, existing, { partial: true }).ok, false);
});
test('legacy full writes retain missing-field protection', () => {
  assert.equal(vet({ paymentDetails: { bsb: '014527' } }, existing).ok, false);
});
test('unchanged stale fields in remote row cannot prevent a bank-only correction', () => {
  assert.equal(vet({ paymentDetails: { bsb: '014527' } }, { ...existing, businessPhone: '03 9000 1234' }, { partial: true }).ok, true);
});
