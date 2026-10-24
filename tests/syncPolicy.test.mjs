import test from 'node:test';
import assert from 'node:assert/strict';
import { canPushEntity } from '../server/syncPolicy.mjs';

test('administrators and managers can sync all entity types', () => {
  assert.equal(canPushEntity('admin', 'products'), true);
  assert.equal(canPushEntity('manager', 'products'), true);
});

test('cashiers can sync sales and operational records', () => {
  for (const entity of ['orders', 'timecharges', 'timechargesessions', 'cashentries', 'audittrail', 'attendance']) {
    assert.equal(canPushEntity('cashier', entity), true, entity);
  }
});

test('cashiers cannot overwrite catalog or staff administration records', () => {
  for (const entity of ['products', 'staff', 'suppliers', 'locations', 'settings']) {
    assert.equal(canPushEntity('cashier', entity), false, entity);
  }
});

test('unknown roles and unapproved entities are denied', () => {
  assert.equal(canPushEntity('guest', 'orders'), false);
  assert.equal(canPushEntity('cashier', 'orders;staff'), false);
  assert.equal(canPushEntity('cashier', ''), false);
});
