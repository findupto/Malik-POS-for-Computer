import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearReconciledSaleTransactions,
  getPendingSaleTransactions,
  reconcilePendingSaleTransactions,
  recordSaleTransaction
} from '../src/transactionLedger.mjs';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    read(key) { return values.has(key) ? JSON.parse(values.get(key)) : null; }
  };
}

const order = (overrides = {}) => ({
  id: 'order-123',
  customer: 'Walk-in Customer',
  items: [{ id: 'p1', sku: 'SKU-1', name: 'Tea', qty: 2, price: 100 }],
  total: 200,
  discount: 0,
  tax: 0,
  serviceCharges: 0,
  ...overrides
});
const ok = data => ({ ok: true, status: 200, json: async () => data });

test('shared sale request is saved to the recovery outbox before network submission', async () => {
  const storage = createStorage();
  let savedBeforeFetch = false;
  const result = await recordSaleTransaction({
    baseUrl: 'https://pos.example.test',
    token: 'session-token',
    order: order(),
    payment: 'Cash',
    storage,
    makeId: () => '11111111-1111-4111-8111-111111111111',
    fetchImpl: async (_url, options) => {
      savedBeforeFetch = Boolean(storage.read('malik-transactionOutbox')?.['order-123']);
      assert.equal(JSON.parse(options.body).idempotencyKey, '11111111-1111-4111-8111-111111111111');
      return ok({ transaction: { id: 'server-1' } });
    }
  });
  assert.equal(savedBeforeFetch, true);
  assert.equal(result.idempotencyKey, '11111111-1111-4111-8111-111111111111');
  assert.equal(getPendingSaleTransactions(storage).length, 1);
});

test('network failures preserve the original payload and retry with the same idempotency key', async () => {
  const storage = createStorage();
  const makeId = () => '22222222-2222-4222-8222-222222222222';
  await assert.rejects(recordSaleTransaction({
    baseUrl: 'https://pos.example.test', token: 'token', order: order(), payment: 'Cash',
    storage, makeId, fetchImpl: async () => { throw new Error('connection lost'); }
  }), /connection lost/);
  const original = storage.read('malik-transactionOutbox')['order-123'];
  await recordSaleTransaction({
    baseUrl: 'https://pos.example.test', token: 'token',
    order: order({ total: 999, items: [{ id: 'p2', name: 'Changed item', qty: 1, price: 999 }] }),
    payment: 'Card', storage, makeId,
    fetchImpl: async (_url, options) => {
      const replayed = JSON.parse(options.body);
      assert.deepEqual(replayed, original);
      return ok({ transaction: { id: 'server-1' } });
    }
  });
});

test('server rejection keeps the saved sale for operator recovery', async () => {
  const storage = createStorage();
  await assert.rejects(recordSaleTransaction({
    baseUrl: 'https://pos.example.test', token: 'token', order: order(), payment: 'Cash',
    storage, makeId: () => '33333333-3333-4333-8333-333333333333',
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'conflict' }) })
  }), /conflict/);
  assert.equal(storage.read('malik-transactionOutbox')['order-123'].orderId, 'order-123');
});

test('recovery clearing removes only the exact idempotency-key version', () => {
  const storage = createStorage({ 'malik-transactionOutbox': JSON.stringify({
    'order-123': { orderId: 'order-123', idempotencyKey: 'old-key' },
    'order-456': { orderId: 'order-456', idempotencyKey: 'keep-key' }
  }) });
  clearReconciledSaleTransactions([
    { orderId: 'order-123', idempotencyKey: 'new-key' },
    { orderId: 'order-456', idempotencyKey: 'keep-key' }
  ], storage);
  assert.deepEqual(storage.read('malik-transactionOutbox'), {
    'order-123': { orderId: 'order-123', idempotencyKey: 'old-key' }
  });
});

test('reconciliation requires both matching order ID and idempotency key', async () => {
  const storage = createStorage({ 'malik-transactionOutbox': JSON.stringify({
    'order-123': { orderId: 'order-123', idempotencyKey: '44444444-4444-4444-8444-444444444444', items: [], tenders: [] }
  }) });
  const result = await reconcilePendingSaleTransactions({
    baseUrl: 'https://pos.example.test', token: 'token', storage,
    fetchImpl: async () => ok({ transactions: [
      { order_id: 'order-123', idempotency_key: 'different-key', id: 'wrong' },
      { order_id: 'order-456', idempotency_key: '44444444-4444-4444-8444-444444444444', id: 'wrong-order' }
    ] })
  });
  assert.deepEqual(result, []);
});
