import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAtMostThreeDecimalPlaces } from '../server/quantity.mjs';

test('accepts integer and fractional quantities up to three decimal places', () => {
  for (const quantity of [0, 1, -1, 0.1, 1.2, 1.23, 1.234, '2.125', '0.001', 1000000]) {
    assert.equal(hasAtMostThreeDecimalPlaces(quantity), true, String(quantity));
  }
});

test('rejects non-finite, non-numeric, and over-precision quantities', () => {
  for (const quantity of [NaN, Infinity, -Infinity, 'not-a-number', 0.0001, 1.0004, 1.2345, '0.0009']) {
    assert.equal(hasAtMostThreeDecimalPlaces(quantity), false, String(quantity));
  }
});

test('handles floating point representation at three decimal places', () => {
  assert.equal(hasAtMostThreeDecimalPlaces(0.1 + 0.2), true);
  assert.equal(hasAtMostThreeDecimalPlaces(1.001), true);
  assert.equal(hasAtMostThreeDecimalPlaces(1.0009), false);
});
