import test from 'node:test';
import assert from 'node:assert/strict';
import { canPushEntity, hasValidSyncRecordIdentity, isValidSyncPayload } from '../server/syncPolicy.mjs';

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

test('sync upserts require an object payload, not arrays or null', () => {
  assert.equal(isValidSyncPayload('upsert', { id: 'p-1' }), true);
  assert.equal(isValidSyncPayload('upsert', []), false);
  assert.equal(isValidSyncPayload('upsert', null), false);
  assert.equal(isValidSyncPayload('upsert', undefined), false);
  assert.equal(isValidSyncPayload('delete', undefined), true);
  assert.equal(isValidSyncPayload('delete', { ignored: true }), false);
});

test('sync payload identity must agree with recordId when present', () => {
  assert.equal(hasValidSyncRecordIdentity({ id: 'o-1' }, 'o-1'), true);
  assert.equal(hasValidSyncRecordIdentity({ uuid: 'o-1' }, 'o-1'), true);
  assert.equal(hasValidSyncRecordIdentity({ id: 'o-1', uuid: 'o-1' }, 'o-1'), true);
  assert.equal(hasValidSyncRecordIdentity({ total: 20 }, 'o-1'), true, 'legacy identity-less payloads remain supported');
  assert.equal(hasValidSyncRecordIdentity({ id: 'o-2' }, 'o-1'), false);
  assert.equal(hasValidSyncRecordIdentity({ uuid: 'o-2' }, 'o-1'), false);
  assert.equal(hasValidSyncRecordIdentity({ id: 'o-1', uuid: 'o-2' }, 'o-1'), false);
  assert.equal(hasValidSyncRecordIdentity({ id: '' }, 'o-1'), false);
  assert.equal(hasValidSyncRecordIdentity({ id: 'x'.repeat(201) }, 'x'.repeat(201)), false);
});
