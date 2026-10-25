export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_MAX_TRACKED_IPS = 10_000;

export function checkLoginRateLimit(attempts, key, now = Date.now()) {
  let prior = attempts.get(key);
  if (prior && now - prior.startedAt >= LOGIN_WINDOW_MS) {
    attempts.delete(key);
    prior = undefined;
  }

  // Bound memory if a server is exposed to many unique client addresses.
  if (!prior && attempts.size >= LOGIN_MAX_TRACKED_IPS) {
    for (const [trackedKey, attempt] of attempts) {
      if (now - attempt.startedAt >= LOGIN_WINDOW_MS) attempts.delete(trackedKey);
    }
    if (attempts.size >= LOGIN_MAX_TRACKED_IPS) {
      return { limited: true, reason: 'capacity' };
    }
  }

  if (!prior) {
    prior = { startedAt: now, count: 0 };
    attempts.set(key, prior);
  }
  if (prior.count >= LOGIN_MAX_ATTEMPTS) return { limited: true, reason: 'attempts' };
  return { limited: false };
}

export function recordLoginFailure(attempts, key) {
  const prior = attempts.get(key);
  if (prior) prior.count += 1;
}

export function clearLoginFailures(attempts, key) {
  attempts.delete(key);
}
