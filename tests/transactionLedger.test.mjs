import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSaleTransaction, reconcilePendingSaleTransactions, clearReconciledSaleTransactions, recordRefundTransaction, initializeServerInventory, fetchServerInventory, fetchInventoryMovements, recordInventoryAdjustment, getPendingSaleTransactions } from '../src/transactionLedger.mjs';

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

test('uncertain shared sale is durably queued and retries the exact original payload', async () => {
  const storage = fakeStorage();
  const calls = [];
  const args = {
    baseUrl: 'http://localhost:8787', token: 'token', order, payment: 'Cash', storage,
    makeId: () => '12121212-1212-4212-8212-121212121212',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (calls.length === 1) throw new Error('connection reset after request');
      return { ok: true, status: 200, json: async () => ({ status: 'duplicate' }) };
    }
  };
  await assert.rejects(() => recordSaleTransaction(args), /connection reset/);
  const queued = JSON.parse(storage.inspect('malik-transactionOutbox'));
  assert.equal(queued[order.id].idempotencyKey, '12121212-1212-4212-8212-121212121212');
  const changedOrder = { ...order, total: 999, items: [{ id: 99, name: 'Changed item', qty: 1, price: 999 }] };
  await recordSaleTransaction({ ...args, order: changedOrder, payment: 'Card' });
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.ok(JSON.parse(storage.inspect('malik-transactionOutbox'))[order.id], 'successful retry stays queued until local completion is persisted');
  clearReconciledSaleTransactions([{ orderId: order.id, idempotencyKey: JSON.parse(storage.inspect('malik-transactionOutbox'))[order.id].idempotencyKey }], storage);
  assert.deepEqual(JSON.parse(storage.inspect('malik-transactionOutbox')), {});
});

test('reconciliation requires an exact server order and idempotency-key match', async () => {
  const storage = fakeStorage({
    'malik-transactionOutbox': JSON.stringify({
      'MP-FOUND': { orderId: 'MP-FOUND', idempotencyKey: 'key-found', occurredAt: '2026-10-24T10:00:00.000Z', tenders: [{ method: 'Cash', amount: 25 }] },
      'MP-MISMATCH': { orderId: 'MP-MISMATCH', idempotencyKey: 'key-local', tenders: [] },
      'MP-MISSING': { orderId: 'MP-MISSING', idempotencyKey: 'key-missing', tenders: [] }
    })
  });
  const calls = [];
  const reconciled = await reconcilePendingSaleTransactions({
    baseUrl: 'http://localhost:8787', token: 'token', storage,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      const id = new URL(url).searchParams.get('orderId');
      const transactions = id === 'MP-FOUND'
        ? [{ order_id: id, idempotency_key: 'key-found', total: 25, occurred_at: '2026-10-24T10:00:00.000Z' }]
        : id === 'MP-MISMATCH'
          ? [{ order_id: id, idempotency_key: 'key-from-another-register', total: 99, occurred_at: '2026-10-24T10:00:00.000Z' }]
          : [];
      return { ok: true, status: 200, json: async () => ({ transactions }) };
    }
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(calls[0].url.searchParams.get('orderId'), 'MP-FOUND');
  assert.deepEqual(reconciled.map(item => item.orderId), ['MP-FOUND']);
  assert.equal(reconciled[0].payment, 'Cash');
  assert.deepEqual(JSON.parse(storage.inspect('malik-transactionOutbox')), {
    'MP-FOUND': { orderId: 'MP-FOUND', idempotencyKey: 'key-found', occurredAt: '2026-10-24T10:00:00.000Z', tenders: [{ method: 'Cash', amount: 25 }] },
    'MP-MISMATCH': { orderId: 'MP-MISMATCH', idempotencyKey: 'key-local', tenders: [] },
    'MP-MISSING': { orderId: 'MP-MISSING', idempotencyKey: 'key-missing', tenders: [] }
  });
  clearReconciledSaleTransactions([{ orderId: 'MP-FOUND', idempotencyKey: 'key-found' }], storage);
  assert.deepEqual(JSON.parse(storage.inspect('malik-transactionOutbox')), {
    'MP-MISMATCH': { orderId: 'MP-MISMATCH', idempotencyKey: 'key-local', tenders: [] },
    'MP-MISSING': { orderId: 'MP-MISSING', idempotencyKey: 'key-missing', tenders: [] }
  });
});

test('outbox clearing never deletes a replacement request with a different key', () => {
  const storage = fakeStorage({ 'malik-transactionOutbox': JSON.stringify({ 'MP-1': { orderId: 'MP-1', idempotencyKey: 'new-key' } }) });
  clearReconciledSaleTransactions([{ orderId: 'MP-1', idempotencyKey: 'old-key' }], storage);
  assert.deepEqual(JSON.parse(storage.inspect('malik-transactionOutbox')), { 'MP-1': { orderId: 'MP-1', idempotencyKey: 'new-key' } });
});

test('pending shared sale summary lists only safe retry metadata', async () => {
  const storage = fakeStorage({
    'malik-transactionOutbox': JSON.stringify({
      'MP-PENDING': {
        orderId: 'MP-PENDING', idempotencyKey: 'key-1', occurredAt: '2026-10-24T10:00:00.000Z',
        items: [{ productName: 'Tea' }, { productName: 'Cake' }],
        tenders: [{ amount: 25 }]
      },
      'bad-entry': { orderId: 'different-id', idempotencyKey: 'key-2', items: [], tenders: [] }
    })
  });
  assert.deepEqual(getPendingSaleTransactions(storage), [{
    orderId: 'MP-PENDING', occurredAt: '2026-10-24T10:00:00.000Z', itemCount: 2, total: 25
  }]);
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


test('rejected shared sale remains in the durable outbox for recovery', async () => {
  const storage = fakeStorage();
  const key = '33333333-3333-4333-8333-333333333333';
  await assert.rejects(() => recordSaleTransaction({
    baseUrl: 'http://localhost:8787', token: 'expired-token', order, payment: 'Cash', storage,
    makeId: () => key,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Session expired' }) })
  }), /Session expired/);
  const queued = JSON.parse(storage.inspect('malik-transactionOutbox'));
  assert.equal(queued[order.id].idempotencyKey, key);
  assert.equal(queued[order.id].items.length, order.items.length);
});

test('shared refund is recorded server-first and retries with the same key', async () => {
  const storage = fakeStorage();
  const calls = [];
  const order = { id: 'MP-7654321', total: 100, items: [] };
  const refund = { amount: '25', method: 'Cash', reason: 'Wrong item', reference: 'receipt 1', returnItems: [{ productId: 'tea-1', productName: 'Tea', quantity: '1' }], restock: true };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/api/transactions?orderId=')) {
      const lookup = new URL(url);
      assert.equal(lookup.searchParams.get('orderId'), order.id, 'refund lookup must target the exact original sale');
      assert.equal(lookup.searchParams.get('limit'), '1', 'exact sale lookup should not depend on recent transaction history');
      return { ok: true, json: async () => ({ transactions: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', order_id: order.id, total: 100 }] }) };
    }
    return { ok: true, status: 201, json: async () => ({ status: 'created' }) };
  };
  const args = { baseUrl: 'http://localhost:8787', token: 'token', order, refund, storage, fetchImpl, makeId: () => '44444444-4444-4444-8444-444444444444' };
  await recordRefundTransaction(args);
  await recordRefundTransaction(args);
  const posts = calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[0].options.body).idempotencyKey, JSON.parse(posts[1].options.body).idempotencyKey);
  assert.equal(JSON.parse(posts[0].options.body).method, 'Cash');
  assert.equal(JSON.parse(posts[0].options.body).restock, true);
  assert.deepEqual(JSON.parse(posts[0].options.body).items, [{ productId: 'tea-1', productName: 'Tea', quantity: 1 }]);
});

test('inventory initialization never overwrites an existing server balance', async () => {
  const calls = [];
  const results = await initializeServerInventory({
    baseUrl: 'http://localhost:8787', token: 'token',
    products: [{ id: 9, name: 'Milk', sku: 'MILK', stock: 12 }],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ status: 'already_initialized', inventory: { product_id: '9', quantity: 4 } }) };
    }
  });
  assert.equal(results[0].status, 'already_initialized');
  assert.equal(results[0].quantity, 4);
  assert.equal(JSON.parse(calls[0].options.body).quantity, 12);
  assert.equal(calls[0].url, 'http://localhost:8787/api/inventory/initialize');
});

test('fetch server inventory returns the server balances', async () => {
  const inventory = await fetchServerInventory({
    baseUrl: 'http://localhost:8787', token: 'token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ inventory: [{ product_id: '1', quantity: '3' }] }) })
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].quantity, '3');
});


test('shared inventory adjustment sends reason, signed delta and stable idempotency key', async () => {
  const calls = [];
  const result = await recordInventoryAdjustment({
    baseUrl: 'http://localhost:8787',
    token: 'token',
    product: { id: 'tea-1', name: 'Tea', sku: 'TEA-1' },
    quantityDelta: -1.5,
    reason: 'Damaged stock',
    idempotencyKey: '44444444-4444-4444-8444-444444444444',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 201, json: async () => ({ status: 'created' }) };
    }
  });
  assert.equal(result.status, 'created');
  assert.equal(calls[0].url, 'http://localhost:8787/api/inventory/adjustments');
  assert.equal(JSON.parse(calls[0].options.body).quantityDelta, -1.5);
  assert.equal(JSON.parse(calls[0].options.body).reason, 'Damaged stock');
  assert.equal(JSON.parse(calls[0].options.body).idempotencyKey, '44444444-4444-4444-8444-444444444444');
});

test('shared inventory adjustment surfaces server stock rejection', async () => {
  await assert.rejects(
    recordInventoryAdjustment({
      baseUrl: 'http://localhost:8787',
      token: 'token',
      product: { id: 'tea-1', name: 'Tea' },
      quantityDelta: -99,
      reason: 'Count correction',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'Adjustment would make stock negative.' }) })
    }),
    /Adjustment would make stock negative/
  );
});


test('inventory movement history helper sends bounded limit and optional product filter', async () => {
  const calls = [];
  const movements = [{ id: 'move-1', product_id: 'tea-1', quantity_delta: '-1' }];
  const result = await fetchInventoryMovements({
    baseUrl: 'http://localhost:8787',
    token: 'token',
    limit: 500,
    productId: 'tea-1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ movements }) };
    }
  });
  assert.deepEqual(result, movements);
  assert.equal(calls[0].url, 'http://localhost:8787/api/inventory/movements?limit=200&productId=tea-1');
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
});

test('inventory movement history helper surfaces API errors', async () => {
  await assert.rejects(
    fetchInventoryMovements({
      baseUrl: 'http://localhost:8787',
      token: 'token',
      fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'Not authorized' }) })
    }),
    /Not authorized/
  );
});

test('malformed transaction outbox is preserved and blocks new sale writes', async () => {
  const corrupt = '{broken recovery data';
  const storage = fakeStorage({ 'malik-transactionOutbox': corrupt });
  await assert.rejects(
    recordSaleTransaction({
      baseUrl: 'http://localhost:8787',
      token: 'token',
      order,
      payment: 'Cash',
      storage,
      makeId: () => '55555555-5555-4555-8555-555555555555',
      fetchImpl: async () => { throw new Error('fetch must not be called'); }
    }),
    /invalid JSON/
  );
  assert.equal(storage.inspect('malik-transactionOutbox'), corrupt);
  assert.equal(storage.inspect('malik-transactionIdempotency'), undefined);
});

test('malformed transaction outbox is reported instead of being presented as empty', () => {
  const storage = fakeStorage({ 'malik-transactionOutbox': '[]' });
  assert.throws(() => getPendingSaleTransactions(storage), /must be an object/);
});
