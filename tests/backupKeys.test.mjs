import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeBackupKey } from '../src/backupKeys.mjs';

test('allows ordinary Malik POS data keys', () => {
  for (const key of ['malik-orders', 'malik-products', 'malik-storeName']) {
    assert.equal(isSafeBackupKey(key), true, key);
  }
});

test('excludes credentials and session data from export and restore', () => {
  for (const key of [
    'malik-syncSession', 'malik-session', 'malik-apiToken',
    'malik-passwordHash', 'malik-googleCredential', 'malik-clientSecret'
  ]) {
    assert.equal(isSafeBackupKey(key), false, key);
  }
});

test('rejects non-Malik keys and malformed key types', () => {
  for (const key of ['orders', '', null, undefined, 42, {}, 'other-token']) {
    assert.equal(isSafeBackupKey(key), false);
  }
});
