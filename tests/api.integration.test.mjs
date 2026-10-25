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

  const deniedLocationCreate = await request('/api/admin/locations', {
    token: cashierToken, method: 'POST',
    body: { name: 'Forbidden Branch' }
  });
  assert.equal(deniedLocationCreate.status, 403, 'cashiers cannot create locations');
  const invalidLocation = await request('/api/admin/locations', {
    token: adminToken, method: 'POST',
    body: { name: 'Invalid Timezone Branch', timezone: 'Not/A_Timezone' }
  });
  assert.equal(invalidLocation.status, 400);
  const branch = await request('/api/admin/locations', {
    token: adminToken, method: 'POST',
    body: { name: 'Integration Branch ' + crypto.randomUUID().slice(0, 8), timezone: 'Asia/Karachi' }
  });
  assert.equal(branch.status, 201);
  assert.equal(branch.data.location.timezone, 'Asia/Karachi');
  const branchStaff = await request('/api/admin/users', {
    token: adminToken, method: 'POST',
    body: { username: 'branch-admin-' + crypto.randomUUID().slice(0, 8), displayName: 'Branch Administrator', role: 'admin', password: 'test-only-branch-password-123', locationId: branch.data.location.id }
  });
  assert.equal(branchStaff.status, 201);
  const branchLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: branchStaff.data.user.username, password: 'test-only-branch-password-123' }
  });
  assert.equal(branchLogin.status, 200);
  const branchMe = await request('/api/me', { token: branchLogin.data.token });
  assert.equal(branchMe.status, 200);
  assert.equal(branchMe.data.locationId, branch.data.location.id, 'branch staff must be assigned to the created branch');
  const branchInventory = await request('/api/inventory', { token: branchLogin.data.token });
  assert.equal(branchInventory.status, 200);
  assert.equal(branchInventory.data.inventory.length, 0, 'new branch inventory must be location-scoped');
  const branchOverview = await request('/api/admin/overview?locationId=' + encodeURIComponent(branch.data.location.id), { token: adminToken });
  assert.equal(branchOverview.status, 200);
  assert.equal(branchOverview.data.locationId, branch.data.location.id);
  assert.equal(branchOverview.data.sales.transactionCount, 0, 'branch overview must not include another location sales');
  const invalidBranchOverview = await request('/api/admin/overview?locationId=not-a-uuid', { token: adminToken });
  assert.equal(invalidBranchOverview.status, 400);

  const branchOpeningStock = await request('/api/inventory/initialize', {
    token: branchLogin.data.token, method: 'POST',
    body: { productId: 'branch-only-' + crypto.randomUUID(), sku: 'BRANCH-ONLY', productName: 'Branch-only product', quantity: 4 }
  });
  assert.equal(branchOpeningStock.status, 201);
  const branchOverviewWithStock = await request('/api/admin/overview?locationId=' + encodeURIComponent(branch.data.location.id), { token: adminToken });
  assert.equal(branchOverviewWithStock.status, 200);
  assert.equal(branchOverviewWithStock.data.inventory.trackedProducts, 1, 'selected branch overview must use that branch inventory');
  assert.equal(branchOverviewWithStock.data.inventory.unitsOnHand, 4);
  assert.equal(branchOverviewWithStock.data.activeStaff, 1, 'selected branch overview must count staff at that branch');


  for (const invalidCursor of ['-1', '1.5', 'Infinity']) {
    const invalidPull = await request('/api/sync/pull?after=' + encodeURIComponent(invalidCursor), { token: adminToken });
    assert.equal(invalidPull.status, 400, 'invalid sync cursor ' + invalidCursor + ' must be rejected');
  }

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

  const teaAdjustmentKey = crypto.randomUUID();
  const teaOpening = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: teaAdjustmentKey, productId: 'tea-1', sku: 'TEA-1', productName: 'Tea', quantityDelta: 5, reason: 'Integration test opening stock' }
  });
  assert.equal(teaOpening.status, 201);
  const breadOpening = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), productId: 'bread-1', sku: 'BREAD-1', productName: 'Bread', quantityDelta: 4, reason: 'Integration test opening stock' }
  });
  assert.equal(breadOpening.status, 201);
  const setTeaReorderPoint = await request('/api/inventory/reorder-point', {
    token: adminToken, method: 'POST',
    body: { productId: 'tea-1', reorderPoint: 6 }
  });
  assert.equal(setTeaReorderPoint.status, 200);
  assert.equal(Number(setTeaReorderPoint.data.inventory.reorder_point), 6);
  const cashierReorderPoint = await request('/api/inventory/reorder-point', {
    token: cashierToken, method: 'POST',
    body: { productId: 'tea-1', reorderPoint: 8 }
  });
  assert.equal(cashierReorderPoint.status, 403);
  const invalidReorderPoint = await request('/api/inventory/reorder-point', {
    token: adminToken, method: 'POST',
    body: { productId: 'tea-1', reorderPoint: 1.2345 }
  });
  assert.equal(invalidReorderPoint.status, 400);
  const missingReorderPoint = await request('/api/inventory/reorder-point', {
    token: adminToken, method: 'POST',
    body: { productId: 'not-tracked', reorderPoint: 2 }
  });
  assert.equal(missingReorderPoint.status, 404);

  const adjustmentRetryMismatch = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: teaAdjustmentKey, productId: 'tea-1', sku: 'TEA-1', productName: 'Tea', quantityDelta: 6, reason: 'Changed retry payload' }
  });
  assert.equal(adjustmentRetryMismatch.status, 409, 'same adjustment idempotency key with changed details must be rejected');

  const overpaidOrderId = 'overpaid-sale-' + crypto.randomUUID();
  const overpaid = await request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: {
      idempotencyKey: crypto.randomUUID(),
      orderId: overpaidOrderId,
      customerName: 'Integration Customer',
      items: [{ productId: '', sku: 'OVERPAY', productName: 'Overpayment validation', quantity: 1, unitPrice: 100 }],
      discountAmount: 0, taxAmount: 0, serviceChargeAmount: 0, deliveryFee: 0,
      tenders: [{ method: 'Cash', amount: 101 }]
    }
  });
  assert.equal(overpaid.status, 400, 'server must reject tenders that exceed the sale total');
  const rejectedOverpaymentLookup = await request('/api/transactions?limit=10&orderId=' + encodeURIComponent(overpaidOrderId), { token: cashierToken });
  assert.equal(rejectedOverpaymentLookup.data.transactions.length, 0, 'rejected overpayment must not create a ledger entry');

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

  // Two registers can retry the same uncertain sale at once; the shared idempotency key
  // must create one transaction and deduct stock only once.
  const retryProductId = 'retry-' + crypto.randomUUID();
  const retryOpening = await request('/api/inventory/adjustments', {
    token: adminToken, method: 'POST',
    body: { idempotencyKey: crypto.randomUUID(), productId: retryProductId, sku: 'RETRY', productName: 'Idempotent Retry Test', quantityDelta: 5, reason: 'Concurrent idempotent retry test opening stock' }
  });
  assert.equal(retryOpening.status, 201);
  const retryKey = crypto.randomUUID();
  const retryOrderId = 'retry-sale-' + crypto.randomUUID();
  const retryBody = {
    idempotencyKey: retryKey,
    orderId: retryOrderId,
    customerName: 'Integration Customer',
    items: [{ productId: retryProductId, sku: 'RETRY', productName: 'Idempotent Retry Test', quantity: 2, unitPrice: 10 }],
    discountAmount: 0, taxAmount: 0, serviceChargeAmount: 0, deliveryFee: 0,
    tenders: [{ method: 'Cash', amount: 20 }]
  };
  const retryResults = await Promise.all([
    request('/api/transactions', { token: cashierToken, method: 'POST', body: retryBody }),
    request('/api/transactions', { token: cashierToken, method: 'POST', body: retryBody })
  ]);
  assert.deepEqual(retryResults.map(result => result.status).sort(), [200, 201]);
  assert.equal(retryResults.find(result => result.status === 200).data.status, 'duplicate');
  const mismatchedRetry = await request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: { ...retryBody, orderId: retryOrderId + '-different', items: [{ ...retryBody.items[0], quantity: 1 }] }
  });
  assert.equal(mismatchedRetry.status, 409, 'same key with different sale details must be rejected');
  const retryInventoryAfterMismatch = await request('/api/inventory', { token: cashierToken });
  assert.equal(Number(retryInventoryAfterMismatch.data.inventory.find(item => item.product_id === retryProductId).quantity), 3,
    'mismatched idempotency retry must not deduct stock again');
  const retryInventory = await request('/api/inventory', { token: cashierToken });
  assert.equal(Number(retryInventory.data.inventory.find(item => item.product_id === retryProductId).quantity), 3);
  const retryLedger = await request('/api/transactions?limit=10&orderId=' + encodeURIComponent(retryOrderId), { token: cashierToken });
  assert.equal(retryLedger.status, 200);
  assert.equal(retryLedger.data.transactions.length, 1);
  assert.equal(retryLedger.data.transactions[0].idempotency_key, retryKey, 'exact order lookup returns the key needed for safe recovery');

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
  const mismatchedRefund = await request('/api/transactions/' + sale.data.transaction.id + '/refunds', {
    token: adminToken, method: 'POST',
    body: { ...refundBody, amount: 25, items: [{ productId: 'tea-1', productName: 'Tea', quantity: 1 }] }
  });
  assert.equal(mismatchedRefund.status, 409, 'same refund idempotency key with changed amount must be rejected');
  const mismatchedRefundReason = await request('/api/transactions/' + sale.data.transaction.id + '/refunds', {
    token: adminToken, method: 'POST',
    body: { ...refundBody, reason: 'Different reason' }
  });
  assert.equal(mismatchedRefundReason.status, 409, 'same refund idempotency key with changed reason must be rejected');
  const ownerOverview = await request('/api/admin/overview', { token: adminToken });
  assert.equal(ownerOverview.status, 200);
  assert.equal(ownerOverview.data.sales.currency, 'PKR');
  assert.ok(ownerOverview.data.sales.transactionCount >= 1);
  assert.ok(ownerOverview.data.sales.grossSales >= 265);
  assert.ok(ownerOverview.data.sales.refundsCount >= 1);
  assert.equal(ownerOverview.data.sales.netSales, Number((ownerOverview.data.sales.grossSales - ownerOverview.data.sales.refunded).toFixed(2)));
  assert.ok(ownerOverview.data.inventory.trackedProducts >= 2);
  assert.ok(Number.isInteger(ownerOverview.data.inventory.outOfStockCount));
  assert.ok(Array.isArray(ownerOverview.data.inventory.lowStockProducts));
  assert.ok(ownerOverview.data.inventory.lowStockProducts.length <= 100);
  assert.ok(Number.isInteger(ownerOverview.data.inventory.lowStockCount));
  assert.ok(Array.isArray(ownerOverview.data.inventory.lowStockProducts));
  assert.ok(ownerOverview.data.inventory.lowStockProducts.some(item => item.product_id === 'tea-1' && Number(item.reorder_point) === 6));
  assert.ok(ownerOverview.data.activeStaff >= 2);
  assert.ok(Array.isArray(ownerOverview.data.recentActivity));
  const cashierOverview = await request('/api/admin/overview', { token: cashierToken });
  assert.equal(cashierOverview.status, 403, 'cashiers must not access owner financial overview');
  const invalidOverviewDate = await request('/api/admin/overview?from=not-a-date', { token: adminToken });
  assert.equal(invalidOverviewDate.status, 400);
  const excessiveOverviewRange = await request('/api/admin/overview?from=2024-01-01&to=2025-01-01', { token: adminToken });
  assert.equal(excessiveOverviewRange.status, 400);

  const inventoryAfterRefund = await request('/api/inventory', { token: cashierToken });
  assert.equal(Number(inventoryAfterRefund.data.inventory.find(item => item.product_id === 'tea-1').quantity), 4);
  assert.equal(Number(inventoryAfterRefund.data.inventory.find(item => item.product_id === 'tea-1').reorder_point), 6);

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
    token: cashierToken, method: 'POST', body: saleBody
  });
  assert.equal(duplicateSale.status, 200);
  assert.equal(duplicateSale.data.status, 'duplicate');
  assert.equal(duplicateSale.data.transaction.id, sale.data.transaction.id);
  const changedSalePayload = await request('/api/transactions', {
    token: cashierToken, method: 'POST',
    body: { ...saleBody, items: [{ ...saleBody.items[0], productName: 'Changed retry payload' }, saleBody.items[1]] }
  });
  assert.equal(changedSalePayload.status, 409, 'same key with changed line details must be rejected');
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

  const malformedSyncEvents = await request('/api/sync/push', {
    token: adminToken, method: 'POST', body: { events: [null] }
  });
  assert.equal(malformedSyncEvents.status, 400, 'null sync events should be rejected as client input, not crash the API');
  const malformedRecordId = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{
      eventId: crypto.randomUUID(), entity: 'orders', recordId: { id: 'unexpected-object' },
      operation: 'upsert', payload: { id: 'unexpected-object' }, expectedSequence: null
    }] }
  });
  assert.equal(malformedRecordId.status, 400, 'recordId must be a bounded string, not a coerced object');
  const malformedExpectedSequence = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{
      eventId: crypto.randomUUID(), entity: 'orders', recordId: 'invalid-sequence-' + crypto.randomUUID(),
      operation: 'upsert', payload: { id: 'invalid-sequence' }, expectedSequence: 'not-a-number'
    }] }
  });
  assert.equal(malformedExpectedSequence.status, 400, 'expectedSequence must be null or a non-negative safe integer');
  const malformedOccurredAt = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{
      eventId: crypto.randomUUID(), entity: 'orders', recordId: 'invalid-timestamp-' + crypto.randomUUID(),
      operation: 'upsert', payload: { id: 'invalid-timestamp' }, expectedSequence: null, occurredAt: 'not-a-date'
    }] }
  });
  assert.equal(malformedOccurredAt.status, 400, 'occurredAt must be null or a valid date-time string');

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

  const mismatchedEventRetry = await request('/api/sync/push', {
    token: adminToken, method: 'POST',
    body: { events: [{ eventId: firstEventId, entity: 'orders', recordId, operation: 'upsert', payload: { id: recordId, total: 101 }, expectedSequence: null }] }
  });
  assert.equal(mismatchedEventRetry.status, 409);

  const racedEventId = crypto.randomUUID();
  const racedRecordId = 'integration-race-' + crypto.randomUUID();
  const race = await Promise.all([
    request('/api/sync/push', {
      token: adminToken, method: 'POST',
      body: { events: [{ eventId: racedEventId, entity: 'orders', recordId: racedRecordId, operation: 'upsert', payload: { id: racedRecordId, total: 15 } }] }
    }),
    request('/api/sync/push', {
      token: adminToken, method: 'POST',
      body: { events: [{ eventId: racedEventId, entity: 'orders', recordId: racedRecordId + '-other', operation: 'upsert', payload: { id: racedRecordId + '-other', total: 16 } }] }
    })
  ]);
  assert.equal(race.filter(result => result.status === 200).length, 1,
    'only one distinct event payload may claim a shared event ID');
  assert.equal(race.filter(result => result.status === 409).length, 1,
    'a concurrent event ID collision with different details must be rejected');

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

  // Exercise the shared PostgreSQL login throttle last, because all test
  // requests originate from this integration-test process's client address.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failedLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'missing-login-user', password: 'wrong-test-password' }
    });
    assert.equal(failedLogin.status, 401, 'attempts below the configured threshold should return generic credentials errors');
  }
  const throttledLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'missing-login-user', password: 'wrong-test-password' }
  });
  assert.equal(throttledLogin.status, 429, 'the shared database counter must throttle the next attempt');
});
