import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateBackupEntries } = require('../electron/backupValidation.cjs');

test('accepts a non-empty backup with unique safe Malik POS keys', () => {
  assert.equal(validateBackupEntries([
    { key: 'malik-orders', value: '[{"id":"o-1"}]' },
    { key: 'malik-products', value: '[]' }
  ]), null);
});

test('rejects empty, missing, or oversized entry collections', () => {
  assert.match(validateBackupEntries([]), /between 1 and 500/i);
  assert.match(validateBackupEntries(null), /between 1 and 500/i);
  assert.match(validateBackupEntries(Array.from({ length: 501 }, (_, i) => ({ key: 'malik-' + i, value: '[]' })), /between 1 and 500/i);
});

test('rejects malformed or sensitive entries rather than silently dropping them', () => {
  for (const entries of [
    [{ key: 'malik-orders', value: '[]' }, { key: 'other', value: 'data' }],
    [{ key: 'malik-session-token', value: 'secret' }],
    [{ key: 'malik-orders', value: 42 }],
    [{ key: 'malik-orders' }],
    [null],
    [{ key: 'malik-' + 'x'.repeat(201), value: '[]' }]
  ]) {
    assert.match(validateBackupEntries(entries), /invalid or sensitive/i);
  }
});

test('rejects duplicate storage keys so backups cannot ambiguously restore data', () => {
  assert.match(validateBackupEntries([
    { key: 'malik-orders', value: '[]' },
    { key: 'malik-orders', value: '[{"id":"different"}]' }
  ]), /duplicate keys/i);
});
