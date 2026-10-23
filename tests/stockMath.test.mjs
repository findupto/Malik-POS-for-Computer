import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeightedAverageCost, purchaseBalance, daysPastDue } from '../src/stockMath.mjs';

test('weighted average cost combines existing inventory and receipt cost', () => {
  assert.equal(calculateWeightedAverageCost(10, 2, 5, 20), 40 / 15);
  assert.equal(calculateWeightedAverageCost(0, 0, 4, 18), 4.5);
});

test('weighted average cost rejects invalid quantities and costs', () => {
  assert.throws(() => calculateWeightedAverageCost(-1, 2, 5, 20), RangeError);
  assert.throws(() => calculateWeightedAverageCost(10, 2, 0, 20), RangeError);
  assert.throws(() => calculateWeightedAverageCost(10, 2, 5, Infinity), RangeError);
});

test('purchase balance never goes below zero', () => {
  assert.equal(purchaseBalance(120, 45), 75);
  assert.equal(purchaseBalance(120, 120), 0);
  assert.equal(purchaseBalance(120, 130), 0);
  assert.throws(() => purchaseBalance(-1, 0), RangeError);
});

test('days past due only counts open invoices overdue by calendar date', () => {
  assert.equal(daysPastDue('2026-10-20', '2026-10-23', 10), 3);
  assert.equal(daysPastDue('2026-10-23', '2026-10-23', 10), 0);
  assert.equal(daysPastDue('2026-10-24', '2026-10-23', 10), 0);
  assert.equal(daysPastDue('2026-10-20', '2026-10-23', 0), 0);
});
