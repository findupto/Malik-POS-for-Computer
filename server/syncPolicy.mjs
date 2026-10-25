export const cashierWritableEntities = new Set([
  'orders',
  'timecharges',
  'timechargesessions',
  'cashentries',
  'audittrail',
  'attendance'
]);

export function canPushEntity(role, entity) {
  if (role === 'admin' || role === 'manager') return true;
  return role === 'cashier' && cashierWritableEntities.has(String(entity || '').toLowerCase());
}

export function isValidSyncPayload(operation, payload) {
  if (operation === 'delete') return payload === undefined || payload === null;
  return operation === 'upsert' && payload !== null && typeof payload === 'object' && !Array.isArray(payload);
}
