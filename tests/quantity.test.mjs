import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAtMostThreeDecimalPlaces } from '../server/quantity.mjs';

test('accepts quantities representable at three-decimal precision', () => {
  for (const value of [0, 1, 0.1, 0.125, 12.345, 1000000]) {
    assert.equal(hasAtMostThreeDecimalPlaces(value), true, String(value));
  }
});

test('rejects quantities that would be silently rounded when stored', () => {
  for (const value of [0.0001, 1.0004, 2.12345, NaN, Infinity, -Infinity]) {
    assert.equal(hasAtMostThreeDecimalPlaces(value), false, String(value));
  }
});
