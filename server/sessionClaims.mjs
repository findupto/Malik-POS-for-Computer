export function hasValidSessionClaims(claims, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Boolean(
    claims &&
    typeof claims === 'object' &&
    !Array.isArray(claims) &&
    typeof claims.sub === 'string' &&
    claims.sub.trim().length > 0 &&
    claims.sub.length <= 200 &&
    typeof claims.locationId === 'string' &&
    claims.locationId.trim().length > 0 &&
    claims.locationId.length <= 200 &&
    Number.isSafeInteger(claims.exp) &&
    claims.exp > nowSeconds
  );
}
