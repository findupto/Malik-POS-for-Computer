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

/**
 * When an upsert payload includes its own identity, it must agree with the
 * event's recordId. Identity-less legacy payloads remain supported.
 */
export function hasValidSyncRecordIdentity(payload, recordId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = ['id', 'uuid'].filter(key => Object.hasOwn(payload, key));
  if (!keys.length) return true;
  const values = keys.map(key => payload[key]);
  if (values.some(value => !['string', 'number'].includes(typeof value) ||
      !String(value).trim() || String(value).length > 200)) return false;
  const normalized = values.map(String);
  return normalized.every(value => value === normalized[0]) &&
    normalized[0] === String(recordId);
}
