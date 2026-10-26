import test from 'node:test';
import assert from 'node:assert/strict';
import { hasValidSessionClaims } from '../server/sessionClaims.mjs';

const now = 1_800_000_000;
const validClaims = {
  sub: 'staff-123',
  locationId: 'location-123',
  exp: now + 60,
  role: 'cashier'
};

test('accepts structurally valid, unexpired session claims', () => {
  assert.equal(hasValidSessionClaims(validClaims, now), true);
});

test('rejects missing or non-object claims', () => {
  for (const claims of [null, undefined, 'token', 42, [], {}]) {
    assert.equal(hasValidSessionClaims(claims, now), false);
  }
});

test('rejects sessions without a subject or location scope', () => {
  assert.equal(hasValidSessionClaims({ ...validClaims, sub: '' }, now), false);
  assert.equal(hasValidSessionClaims({ ...validClaims, locationId: null }, now), false);
});

test('rejects missing, malformed, or expired expiration timestamps', () => {
  assert.equal(hasValidSessionClaims({ ...validClaims, exp: undefined }, now), false);
  assert.equal(hasValidSessionClaims({ ...validClaims, exp: '1800000060' }, now), false);
  assert.equal(hasValidSessionClaims({ ...validClaims, exp: now }, now), false);
  assert.equal(hasValidSessionClaims({ ...validClaims, exp: now - 1 }, now), false);
});

test('rejects non-integer expiration timestamps', () => {
  assert.equal(hasValidSessionClaims({ ...validClaims, exp: now + 0.5 }, now), false);
  assert.equal(hasValidSessionClaims({ ...validClaims, exp: Number.MAX_SAFE_INTEGER + 1 }, now), false);
});
