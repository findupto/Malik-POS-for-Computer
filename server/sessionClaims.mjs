export function hasValidSessionClaims(claims, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Boolean(
    claims &&
    typeof claims === 'object' &&
    claims.sub &&
    claims.locationId &&
    Number.isSafeInteger(claims.exp) &&
    claims.exp > nowSeconds
  );
}
