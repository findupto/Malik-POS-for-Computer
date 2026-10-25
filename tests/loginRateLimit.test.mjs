import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_MAX_TRACKED_IPS,
  LOGIN_WINDOW_MS,
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure
} from '../server/loginRateLimit.mjs';

test('login limiter permits attempts below the limit and blocks the next one', () => {
  const attempts = new Map();
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
    assert.equal(checkLoginRateLimit(attempts, 'client-a', 1000).limited, false);
    recordLoginFailure(attempts, 'client-a');
  }
  assert.deepEqual(checkLoginRateLimit(attempts, 'client-a', 1001), { limited: true, reason: 'attempts' });
});

test('login limiter resets a client after the window expires', () => {
  const attempts = new Map([['client-a', { startedAt: 1000, count: LOGIN_MAX_ATTEMPTS }]]);
  assert.equal(checkLoginRateLimit(attempts, 'client-a', 1000 + LOGIN_WINDOW_MS).limited, false);
  assert.deepEqual(attempts.get('client-a'), { startedAt: 1000 + LOGIN_WINDOW_MS, count: 0 });
});

test('successful login can clear a client rate-limit record', () => {
  const attempts = new Map([['client-a', { startedAt: 1000, count: 4 }]]);
  clearLoginFailures(attempts, 'client-a');
  assert.equal(attempts.has('client-a'), false);
});

test('limiter prunes expired entries and caps tracked client addresses', () => {
  const attempts = new Map();
  for (let i = 0; i < LOGIN_MAX_TRACKED_IPS; i += 1) {
    attempts.set('expired-' + i, { startedAt: 0, count: 1 });
  }
  assert.equal(checkLoginRateLimit(attempts, 'fresh-client', LOGIN_WINDOW_MS + 1).limited, false);
  assert.equal(attempts.size, 1);

  for (let i = 0; i < LOGIN_MAX_TRACKED_IPS; i += 1) {
    attempts.set('active-' + i, { startedAt: LOGIN_WINDOW_MS + 1, count: 1 });
  }
  assert.deepEqual(checkLoginRateLimit(attempts, 'overflow-client', LOGIN_WINDOW_MS + 2), { limited: true, reason: 'capacity' });
  assert.equal(attempts.size, LOGIN_MAX_TRACKED_IPS);
});
