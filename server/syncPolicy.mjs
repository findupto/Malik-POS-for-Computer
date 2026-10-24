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
