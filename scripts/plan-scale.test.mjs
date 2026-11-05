import test from 'node:test';
import assert from 'node:assert/strict';
import { calibratedPage } from '../src/lib/planScale.js';

test('rotated pages without calibration stay unscaled without changing saved rotation', () => {
  const page = { pageNumber: 1, rotation: 90, pxPerMm: null, scaleLabel: '' };
  for (const value of [null, undefined, '', 0, -1, Infinity, 'invalid']) {
    assert.equal(calibratedPage([{ ...page, pxPerMm: value }], 1), null);
  }
  assert.equal(calibratedPage([page], 2), null);
  assert.equal(calibratedPage(undefined, 1), null);
  assert.equal(page.rotation, 90);
  assert.equal(page.pxPerMm, null);
});

test('calibrated pages retain metadata and provide a numeric scale', () => {
  const page = { pageNumber: 2, rotation: 270, pxPerMm: 0.25, scaleLabel: '1:100' };
  assert.deepEqual(calibratedPage([page], 2), page);
  const legacy = calibratedPage([{ ...page, pxPerMm: '0.25' }], 2);
  assert.equal(legacy.pxPerMm.toFixed(3), '0.250');
  assert.equal(legacy.rotation, 270);
});
