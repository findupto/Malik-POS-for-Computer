import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderId } from '../src/orderIds.mjs';

test('order IDs include the full base-36 timestamp and a random suffix', () => {
  const id = createOrderId([], { now: () => 1_800_000_000_000, makeId: () => 'a1b2c3d4-xxxx' });
  assert.equal(id, 'MP-MYWPIWW0-A1B2C3D4');
});

test('order IDs retry if a generated ID already exists locally', () => {
  const existing = [{ id: 'MP-MYWPIWW0-A1B2C3D4' }];
  const values = ['a1b2c3d4-xxxx', 'e5f6g7h8-yyyy'];
  const id = createOrderId(existing, {
    now: () => 1_800_000_000_000,
    makeId: () => values.shift()
  });
  assert.equal(id, 'MP-MYWPIWW0-E5F6G7H8');
});

test('order IDs remain unique for orders created at the same millisecond', () => {
  const first = createOrderId([], { now: () => 1_800_000_000_000, makeId: () => 'register1' });
  const second = createOrderId([ { id: first } ], { now: () => 1_800_000_000_000, makeId: () => 'register2' });
  assert.notEqual(first, second);
});
