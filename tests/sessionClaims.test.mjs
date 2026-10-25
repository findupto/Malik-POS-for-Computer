import test from 'node:test';
import assert from 'node:assert/strict';
import { hasValidSessionClaims } from '../server/sessionClaims.mjs';

const now = 1_800_000_000;

test('accepts a session with subject, location, and a future integer expiration', () => {
  assert.equal(hasValidSessionClaims({ sub: 'staff-1', locationId: 'location-1', exp: now + 1 }, now), true);
});

test('rejects missing, malformed, or expired session claims', () => {
  for (const claims of [
    null,
    {},
    { sub: 'staff-1', locationId: 'location-1' },
    { sub: 'staff-1', locationId: 'location-1', exp: String(now + 100) },
    { sub: 'staff-1', locationId: 'location-1', exp: now },
    { sub: 'staff-1', locationId: 'location-1', exp: now - 1 },
    { sub: 'staff-1', exp: now + 100 },
    { locationId: 'location-1', exp: now + 100 }
  ]) {
    assert.equal(hasValidSessionClaims(claims, now), false, JSON.stringify(claims));
  }
});
