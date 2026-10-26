export function isSafeBackupKey(key) {
  return typeof key === 'string' &&
    key.startsWith('malik-') &&
    !/session|token|password|credential|secret/i.test(key);
}
