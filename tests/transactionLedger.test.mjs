import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSaleTransaction } from '../src/transactionLedger.mjs';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    inspect: key => values.get(key)
  };
}

const order = {
  id: 'MP-1234567', customer: 'Walk-in Customer', total: 250, discount: 10,
  tax: 5, serviceCharges: 0, serviceType: 'Dine-in', items: [
    { id: 1, sku: 'A1', name: 'Tea', qty: 2, price: 100 },
    { id: 2, sku: 'B2', name: 'Cake', qty: 1, price: 50 }
  ]
};

test('shared sale payload uses server endpoint and persists one idempotency key for retries', async () => {
  const storage = fakeStorage();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 201, json: async () => ({ status: 'created' }) };
  };
  const args = { baseUrl: 'http://127.0.0.1:8787/', token: 'token', order, payment: 'Cash', storage, fetchImpl, makeId: () => '11111111-1111-4111-8111-111111111111' };
  await recordSaleTransaction(args);
  await recordSaleTransaction(args);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/transactions');
  const first = JSON.parse(calls[0].options.body);
  const second = JSON.parse(calls[1].options.body);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.items.length, 2);
  assert.equal(first.items.reduce((n, item) => n + item.quantity * item.unitPrice, 0), 250);
  assert.equal(first.discountAmount, 10);
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
});

test('customer due is recorded without a false cash tender', async () => {
  const storage = fakeStorage();
  let sent;
  await recordSaleTransaction({
    baseUrl: 'http://localhost:8787', token: 'token', order, payment: 'Customer Due', storage,
    makeId: () => '22222222-2222-4222-8222-222222222222',
    fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ status: 'created' }) }; }
  });
  assert.deepEqual(sent.tenders, []);
});

test('server rejection is surfaced so checkout can remain pending', async () => {
  await assert.rejects(() => recordSaleTransaction({
    baseUrl: 'http://localhost:8787', token: 'token', order, payment: 'Cash', storage: fakeStorage(),
    makeId: () => '33333333-3333-4333-8333-333333333333',
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'Order already exists' }) })
  }), /Order already exists/);
});
