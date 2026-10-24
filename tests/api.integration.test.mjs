import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import crypto from 'node:crypto';

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const host = '127.0.0.1';
const port = Number(process.env.TEST_API_PORT || 18787);
const baseUrl = `http://${host}:${port}`;
const adminUsername = 'integration-admin';
const adminPassword = 'test-only-admin-password-123';
let child;
let adminToken;
let cashierToken;

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

test('PostgreSQL API integration: auth, idempotency, concurrency and role checks', { skip: !enabled, timeout: 45_000 }, async t => {
  child = spawn(process.execPath, ['--env-file-if-exists=server/.env', 'server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'integration-test-secret-key-at-least-32-characters-long',
      BOOTSTRAP_ADMIN_USERNAME: adminUsername,
      BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
      DEFAULT_LOCATION_NAME: 'Integration Test Location',
      HOST: host,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        delay(3000)
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });

  let healthy = false;
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) { healthy = true; break; }
    } catch {}
    await delay(250);
  }
  assert.equal(healthy, true, `API did not become healthy. Logs: ${logs}`);

  const login = await request('/api/auth/login', { method: 'POST', body: { username: adminUsername, password: adminPassword } });
  assert.equal(login.status, 200);
  adminToken = login.data.token;
  assert.ok(adminToken);

  const created = await request('/api/admin/users', {
    token: adminToken,
    method: 'POST',
    body: { username: 'integration-cashier', displayName: 'Integration Cashier', role: 'cashier', password: 'test-only-cashier-password-123' }
  });
  assert.equal(created.status, 201);
  const cashierLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'integration-cashier', password: 'test-only-cashier-password-123' }
  });
  assert.equal(cashierLogin.status, 200);
  cashierToken = cashierLogin.data.token;

  const initKey = crypto.randomUUID();
  const firstInitialization = await request('/api/inventory/initialize', {
    token: adminToken, method: 'POST',
    body: { productId: 'init-once-' + crypto.randomUUID(), sku: 'INIT', productName: 'Initialization Test', quantity: 7 }
  });
  assert.equal(firstInitialization.status, 201);
  const existingInitialization = await request('/api/inventory/initialize', {
    token: adminToken, method: 'POST',
    body: { productId: firstInitialization.data.inventory.product_id, sku: 'INIT', productName: 'Initialization Test', quantity: 99 }
  });
  assert.equal(existingInitialization.status, 200);
  assert.equal(existingInitialization.data.status, 'already_initialized');
  assert.equal(Number(existingInitialization.data.inventory.quantity), 7);
  const cashierInitialization = await request('/api/inventory/initialize', {
    token: cashierToken, method: 'POST',
    body: { productId: 'cashier-init', sku: 'NO', productName: 'Not allowed', quantity: 1 }
  });
  assert.equal(cashierInitialization.status, 403);

  const teaOpening = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), productId: 'tea-1', sku: 'TEA-1', productName: 'Tea', quantityDelta: 5, reason: 'Integration test opening stock' }
  });
  assert.equal(teaOpening.status, 201);
  const breadOpening = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), productId: 'bread-1', sku: 'BREAD-1', productName: 'Bread', quantityDelta: 4, reason: 'Integration test opening stock' }
  });
  assert.equal(breadOpening.status, 201);

  const saleKey = crypto.randomUUID();
  const saleOrderId = 'integration-sale-' + crypto.randomUUID();
  const saleBody = {
    idempotencyKey: saleKey,
    orderId: saleOrderId,
    customerName: 'Integration Customer',
    items: [
      { productId: 'tea-1', sku: 'TEA-1', productName: 'Tea', quantity: 2, unitPrice: 100 },
      { productId: 'bread-1', sku: 'BREAD-1', productName: 'Bread', quantity: 1, unitPrice: 50 }
    ],
    discountAmount: 10,
    taxAmount: 5,
    serviceChargeAmount: 0,
    deliveryFee: 20,
    tenders: [{ method: 'Cash', amount: 165, reference: 'test-cash' }]
  };
  const sale = await request('/api/transactions', { token: cashierToken, method: 'POST', body: saleBody });
  assert.equal(sale.status, 201);
  assert.equal(Number(sale.data.transaction.total), 265);
  const inventoryAfterSale = await request('/api/inventory', { token: cashierToken });
  assert.equal(inventoryAfterSale.status, 200);
  assert.equal(Number(inventoryAfterSale.data.inventory.find(item => item.product_id === 'tea-1').quantity), 3);
  assert.equal(Number(inventoryAfterSale.data.inventory.find(item => item.product_id === 'bread-1').quantity), 3);

  const refundKey = crypto.randomUUID();
  const refundBody = {
    idempotencyKey: refundKey, amount: 50, method: 'Cash', reason: 'Integration test return',
    restock: true, items: [{ productId: 'tea-1', productName: 'Tea', quantity: 1 }]
  };
  const refund = await request('/api/transactions/' + sale.data.transaction.id + '/refunds', {
    token: adminToken, method: 'POST', body: refundBody
  });
  assert.equal(refund.status, 201);
  assert.equal(Number(refund.data.refund.amount), 50);
  const duplicateRefund = await request('/api/transactions/' + sale.data.transaction.id + '/refunds', {
    token: adminToken, method: 'POST', body: refundBody
  });
  assert.equal(duplicateRefund.status, 200);
  assert.equal(duplicateRefund.data.status, 'duplicate');
  const inventoryAfterRefund = await request('/api/inventory', { token: cashierToken });
  assert.equal(Number(inventoryAfterRefund.data.inventory.find(item => item.product_id === 'tea-1').quantity), 4);

  const movementHistory = await request('/api/inventory/movements?limit=500', { token: cashierToken });
  assert.equal(movementHistory.status, 200);
  assert.ok(movementHistory.data.movements.length <= 200);
  const teaMovements = movementHistory.data.movements.filter(item => item.product_id === 'tea-1');
  assert.ok(teaMovements.some(item => item.reference_type === 'sale' && Number(item.quantity_delta) === -2));
  assert.ok(teaMovements.some(item => item.reference_type === 'refund' && Number(item.quantity_delta) === 1));
  assert.ok(teaMovements.some(item => item.reference_type === 'adjustment' && item.reason === 'Integration test opening stock'));
  const filteredMovements = await request('/api/inventory/movements?limit=10&productId=tea-1', { token: cashierToken });
  assert.equal(filteredMovements.status, 200);
  assert.ok(filteredMovements.data.movements.every(item => item.product_id === 'tea-1'));

  const excessiveRefund = await request('/api/transactions/' + sale.data.transaction.id + '/refunds', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), amount: 220, method: 'Cash', reason: 'Must exceed remaining amount' }
  });
  assert.equal(excessiveRefund.status, 409);
  const cashierRefund = await request('/api/transactions/' + sale.data.transaction.id + '/refunds', {
    token: cashierToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), amount: 1, method: 'Cash', reason: 'Role test' }
  });
  assert.equal(cashierRefund.status, 403);
  const duplicateSale = await request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: { ...saleBody, items: [{ productId: 'tea-1', sku: 'TEA-1', productName: 'Changed retry payload', quantity: 2, unitPrice: 100 }, { productId: 'bread-1', sku: 'BREAD-1', productName: 'Bread', quantity: 1, unitPrice: 50 }] }
  });
  assert.equal(duplicateSale.status, 200);
  assert.equal(duplicateSale.data.status, 'duplicate');
  assert.equal(duplicateSale.data.transaction.id, sale.data.transaction.id);
  const inventoryAfterDuplicateSale = await request('/api/inventory', { token: cashierToken });
  assert.equal(Number(inventoryAfterDuplicateSale.data.inventory.find(item => item.product_id === 'tea-1').quantity), 4);
  const insufficientStock = await request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: {
      ...saleBody,
      idempotencyKey: crypto.randomUUID(),
      orderId: 'insufficient-stock-' + crypto.randomUUID(),
      items: [{ productId: 'tea-1', sku: 'TEA-1', productName: 'Tea', quantity: 99, unitPrice: 100 }],
      discountAmount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      deliveryFee: 0,
      tenders: [{ method: 'Cash', amount: 9900 }]
    }
  });
  assert.equal(insufficientStock.status, 409);

  // Two registers race to sell more stock than is available in aggregate.
  const concurrentProductId = 'race-' + crypto.randomUUID();
  const concurrentOpening = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), productId: concurrentProductId, sku: 'RACE', productName: 'Concurrent Sale Test', quantityDelta: 5, reason: 'Concurrent sale test opening stock' }
  });
  assert.equal(concurrentOpening.status, 201);
  const makeConcurrentSale = (suffix) => request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: {
      idempotencyKey: crypto.randomUUID(),
      orderId: 'concurrent-sale-' + suffix + '-' + crypto.randomUUID(),
      items: [{ productId: concurrentProductId, sku: 'RACE', productName: 'Concurrent Sale Test', quantity: 4, unitPrice: 10 }],
      discountAmount: 0, taxAmount: 0, serviceChargeAmount: 0, deliveryFee: 0,
      tenders: [{ method: 'Cash', amount: 40 }]
    }
  });
  const concurrentResults = await Promise.all([makeConcurrentSale('a'), makeConcurrentSale('b')]);
  assert.deepEqual(concurrentResults.map(result => result.status).sort(), [201, 409]);
  const concurrentBalance = await request('/api/inventory', { token: cashierToken });
  assert.equal(Number(concurrentBalance.data.inventory.find(item => item.product_id === concurrentProductId).quantity), 1);
  const concurrentMovements = await request('/api/inventory/movements?limit=200&productId=' + encodeURIComponent(concurrentProductId), { token: cashierToken });
  assert.equal(concurrentMovements.status, 200);
  assert.equal(concurrentMovements.data.movements.filter(item => item.reference_type === 'sale').length, 1);

  const invalidSale = await request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: { ...saleBody, idempotencyKey: crypto.randomUUID(), orderId: 'invalid-discount-' + crypto.randomUUID(), discountAmount: 99999 }
  });
  assert.equal(invalidSale.status, 400);
  const transactions = await request('/api/transactions?limit=10', { token: cashierToken });
  assert.equal(transactions.status, 200);
  assert.ok(transactions.data.transactions.some(item => item.order_id === saleOrderId));
  const exactOrderLookup = await request('/api/transactions?limit=1&orderId=' + encodeURIComponent(saleOrderId), { token: cashierToken });
  assert.equal(exactOrderLookup.status, 200);
  assert.equal(exactOrderLookup.data.transactions.length, 1);
  assert.equal(exactOrderLookup.data.transactions[0].order_id, saleOrderId);
  const missingOrderLookup = await request('/api/transactions?limit=1&orderId=does-not-exist', { token: cashierToken });
  assert.equal(missingOrderLookup.status, 200);
  assert.equal(missingOrderLookup.data.transactions.length, 0);

  const recordId = 'integration-order-' + crypto.randomUUID();
  const firstEventId = crypto.randomUUID();
  const first = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{ eventId: firstEventId, entity: 'orders', recordId, operation: 'upsert', payload: { id: recordId, total: 100 }, expectedSequence: null }] }
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.results[0].status, 'applied');

  const duplicate = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{ eventId: firstEventId, entity: 'orders', recordId, operation: 'upsert', payload: { id: recordId, total: 100 }, expectedSequence: null }] }
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.results[0].status, 'duplicate');

  const staleWrite = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{ eventId: crypto.randomUUID(), entity: 'orders', recordId, operation: 'upsert', payload: { id: recordId, total: 999 }, expectedSequence: null }] }
  });
  assert.equal(staleWrite.status, 409);

  const denied = await request('/api/sync/push', {
    token: cashierToken, method: 'POST',
    body: { events: [{ eventId: crypto.randomUUID(), entity: 'products', recordId: 'restricted-product', operation: 'upsert', payload: { id: 'restricted-product' }, expectedSequence: null }] }
  });
  assert.equal(denied.status, 403);

  const pulled = await request('/api/sync/pull?after=0', { token: adminToken });
  assert.equal(pulled.status, 200);
  assert.ok(pulled.data.events.some(event => event.record_id === recordId && event.operation === 'upsert'));
});
