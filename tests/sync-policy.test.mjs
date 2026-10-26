import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canPushEntity,
  hasValidSyncRecordIdentity,
  isValidSyncPayload
} from '../server/syncPolicy.mjs';

test('admins and managers can push supported entity names', () => {
  assert.equal(canPushEntity('admin', 'products'), true);
  assert.equal(canPushEntity('manager', 'products'), true);
});

test('cashiers can write only the explicitly permitted operational entities', () => {
  for (const entity of ['orders', 'timecharges', 'timechargesessions', 'cashentries', 'audittrail', 'attendance']) {
    assert.equal(canPushEntity('cashier', entity), true, entity);
  }
  for (const entity of ['products', 'customers', 'suppliers', 'expenses', 'staff', 'locations']) {
    assert.equal(canPushEntity('cashier', entity), false, entity);
  }
  assert.equal(canPushEntity('unknown-role', 'orders'), false);
});

test('delete events accept only an absent or null payload', () => {
  assert.equal(isValidSyncPayload('delete', null), true);
  assert.equal(isValidSyncPayload('delete', undefined), true);
  assert.equal(isValidSyncPayload('delete', {}), false);
});

test('upsert events require a non-null object payload', () => {
  assert.equal(isValidSyncPayload('upsert', {}), true);
  assert.equal(isValidSyncPayload('upsert', { id: 'abc' }), true);
  for (const payload of [null, undefined, [], 'record', 1]) {
    assert.equal(isValidSyncPayload('upsert', payload), false);
  }
  assert.equal(isValidSyncPayload('unknown', {}), false);
});

test('identity-less legacy payloads remain compatible', () => {
  assert.equal(hasValidSyncRecordIdentity({ name: 'Legacy record' }, 'record-1'), true);
});

test('record identity must agree across id and uuid fields and with event identity', () => {
  assert.equal(hasValidSyncRecordIdentity({ id: 'a' }, 'a'), true);
  assert.equal(hasValidSyncRecordIdentity({ uuid: 7 }, '7'), true);
  assert.equal(hasValidSyncRecordIdentity({ id: 'a', uuid: 'a' }, 'a'), true);
  assert.equal(hasValidSyncRecordIdentity({ id: 'a' }, 'b'), false);
  assert.equal(hasValidSyncRecordIdentity({ id: 'a', uuid: 'b' }, 'a'), false);
});

test('rejects malformed record identities', () => {
  for (const payload of [
    null, [], 'record', { id: '' }, { id: '  ' }, { id: {} },
    { id: 'x'.repeat(201) }, { uuid: true }
  ]) {
    assert.equal(hasValidSyncRecordIdentity(payload, 'record-1'), false);
  }
});
