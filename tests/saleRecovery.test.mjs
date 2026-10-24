import test from 'node:test';
import assert from 'node:assert/strict';
import { applySaleToCustomerAccounts } from '../src/saleRecovery.mjs';

test('customer sale accounting is idempotent by order ID', () => {
  const customers = [{ name: 'A Customer', spent: 10, dueBalance: 5, visits: 2 }];
  const sale = { orderId: 'MP-1', customerName: 'A Customer', payment: 'Cash', amount: 25 };
  const once = applySaleToCustomerAccounts(customers, sale);
  const twice = applySaleToCustomerAccounts(once, sale);
  assert.deepEqual(once, twice);
  assert.equal(twice[0].spent, 35);
  assert.equal(twice[0].dueBalance, 5);
  assert.equal(twice[0].visits, 3);
  assert.deepEqual(twice[0].processedSaleOrderIds, ['MP-1']);
});

test('customer due updates balance without counting the amount as spent', () => {
  const customers = [{ name: 'A Customer', spent: 10, dueBalance: 5, visits: 2 }];
  const updated = applySaleToCustomerAccounts(customers, {
    orderId: 'MP-2', customerName: 'A Customer', payment: 'Customer Due', amount: 25
  });
  assert.equal(updated[0].spent, 10);
  assert.equal(updated[0].dueBalance, 30);
  assert.equal(updated[0].visits, 3);
});

test('walk-in sales do not modify named customer accounts', () => {
  const customers = [{ name: 'Walk-in Customer', spent: 0, visits: 0 }];
  assert.deepEqual(applySaleToCustomerAccounts(customers, {
    orderId: 'MP-3', customerName: 'Walk-in Customer', payment: 'Cash', amount: 25
  }), customers);
});

test('missing local array storage uses the supplied in-memory fallback', async () => {
  const { readStoredArray } = await import('../src/saleRecovery.mjs');
  const fallback = [{ id: 'MP-4' }];
  assert.equal(readStoredArray({ getItem: () => null }, 'malik-orders', fallback), fallback);
});

test('malformed local array storage is rejected instead of being replaced with an empty array', async () => {
  const { readStoredArray } = await import('../src/saleRecovery.mjs');
  assert.throws(
    () => readStoredArray({ getItem: () => '{broken' }, 'malik-customers', []),
    /invalid JSON/
  );
  assert.throws(
    () => readStoredArray({ getItem: () => '{"customer":"A"}' }, 'malik-customers', []),
    /must be an array/
  );
});
