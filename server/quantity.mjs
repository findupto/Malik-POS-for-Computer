export function hasAtMostThreeDecimalPlaces(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 1e-6;
}
