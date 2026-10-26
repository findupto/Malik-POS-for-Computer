const SENSITIVE_KEY = /session|token|password|credential|secret/i;

function validateBackupEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) {
    return 'Backup must contain between 1 and 500 entries.';
  }
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.key !== 'string' || entry.key.length > 200 ||
        !entry.key.startsWith('malik-') || SENSITIVE_KEY.test(entry.key) ||
        typeof entry.value !== 'string') {
      return 'Backup contains an invalid or sensitive entry.';
    }
    if (seen.has(entry.key)) return 'Backup contains duplicate keys.';
    seen.add(entry.key);
  }
  return null;
}

module.exports = { validateBackupEntries };
