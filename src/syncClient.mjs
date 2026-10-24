const DEFAULT_SYNC_ENTITIES = [
  { key: 'orders', entity: 'orders', collection: true },
  { key: 'products', entity: 'products', collection: true },
  { key: 'customers', entity: 'customers', collection: true },
  { key: 'expenses', entity: 'expenses', collection: true },
  { key: 'cashEntries', entity: 'cashentries', collection: true },
  { key: 'timeChargeSessions', entity: 'timechargesessions', collection: true },
  { key: 'attendance', entity: 'attendance', collection: true },
  { key: 'auditTrail', entity: 'audittrail', collection: true },
  { key: 'suppliers', entity: 'suppliers', collection: true }
];
const BASELINE_KEY = 'malik-syncBaseline';
const CONFLICTS_KEY = 'malik-syncConflicts';
const CURSOR_KEY = 'malik-syncCursor';
const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('This device cannot create secure sync event IDs. Update the browser or desktop app.');
};
const stable = value => JSON.stringify(value);
function readJson(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function roleAllowed(role, entity) {
  return role === 'admin' || role === 'manager' ||
    (role === 'cashier' && ['orders','timechargesessions','cashentries','attendance','audittrail'].includes(entity));
}
function currentRecords(storage, def) {
  const parsed = readJson(storage, 'malik-' + def.key, def.collection ? [] : null);
  const values = def.collection ? (Array.isArray(parsed) ? parsed : []) : (parsed == null ? [] : [{ id: 'singleton', value: parsed }]);
  return Object.fromEntries(values.map((record, i) => [String(record?.id ?? record?.uuid ?? i), record]));
}
function writeCurrentRecords(storage, def, records) {
  if (def.collection) storage.setItem('malik-' + def.key, JSON.stringify(Object.values(records)));
  else storage.setItem('malik-' + def.key, JSON.stringify(records.singleton?.value ?? null));
}
function captureBaseline(storage, definitions = DEFAULT_SYNC_ENTITIES, preserve = new Set(), role = 'admin') {
  const previous = readJson(storage, BASELINE_KEY, {});
  const next = { ...previous };
  for (const def of definitions) {
    if (!roleAllowed(role, def.entity)) continue;
    const now = currentRecords(storage, def);
    const old = previous[def.entity] || {};
    next[def.entity] = {};
    for (const [id, value] of Object.entries(now)) {
      if (preserve.has(def.entity + ':' + id)) {
        if (Object.hasOwn(old, id)) next[def.entity][id] = old[id];
      } else {
        next[def.entity][id] = value;
      }
    }
    for (const [id, value] of Object.entries(old)) {
      if (preserve.has(def.entity + ':' + id) && !Object.hasOwn(now, id)) next[def.entity][id] = value;
    }
  }
  storage.setItem(BASELINE_KEY, JSON.stringify(next));
  return next;
}

export function buildSnapshotEvents(storage, role = 'admin', definitions = DEFAULT_SYNC_ENTITIES) {
  const baseline = readJson(storage, BASELINE_KEY, null);
  const events = [];
  for (const def of definitions) {
    if (!roleAllowed(role, def.entity)) continue;
    const current = currentRecords(storage, def);
    const previous = baseline?.[def.entity] || {};
    for (const [recordId, payload] of Object.entries(current)) {
      if (!Object.hasOwn(previous, recordId) || stable(previous[recordId]) !== stable(payload)) {
        events.push({ eventId: uuid(), entity: def.entity, recordId, operation: 'upsert', payload, occurredAt: new Date().toISOString() });
      }
    }
    if (baseline) {
      for (const recordId of Object.keys(previous)) {
        if (!Object.hasOwn(current, recordId)) events.push({ eventId: uuid(), entity: def.entity, recordId, operation: 'delete', occurredAt: new Date().toISOString() });
      }
    }
  }
  return events;
}

export function applyPulledEvents(storage, events, cursorKey = CURSOR_KEY, definitions = DEFAULT_SYNC_ENTITIES) {
  const byEntity = new Map(definitions.map(def => [def.entity, def]));
  const grouped = new Map();
  let nextCursor = Number(storage.getItem(cursorKey) || 0);
  for (const event of events || []) {
    const sequence = Number(event.sequence);
    if (Number.isSafeInteger(sequence)) nextCursor = Math.max(nextCursor, sequence);
    const def = byEntity.get(event.entity);
    if (!def) continue;
    if (!grouped.has(def.key)) grouped.set(def.key, { def, records: currentRecords(storage, def) });
    const records = grouped.get(def.key).records;
    if (event.operation === 'delete') delete records[String(event.record_id)];
    else if (def.collection && event.payload && typeof event.payload === 'object') records[String(event.record_id)] = event.payload;
    else if (!def.collection) records.singleton = { id: 'singleton', value: event.payload };
  }
  for (const { def, records } of grouped.values()) writeCurrentRecords(storage, def, records);
  storage.setItem(cursorKey, String(nextCursor));
  return nextCursor;
}

export function resolveSyncConflict(storage, conflictId, choice, definitions = DEFAULT_SYNC_ENTITIES) {
  const conflicts = readJson(storage, CONFLICTS_KEY, []);
  const conflict = conflicts.find(item => item.id === conflictId);
  if (!conflict) throw new Error('This sync conflict no longer exists.');
  if (choice !== 'local' && choice !== 'remote') throw new Error('Choose local or remote data.');
  if (choice === 'remote') {
    const event = conflict.remoteEvent;
    applyPulledEvents(storage, [{ ...event, sequence: Number(storage.getItem(CURSOR_KEY) || 0) }], CURSOR_KEY, definitions);
    captureBaseline(storage, definitions);
  }
  storage.setItem(CONFLICTS_KEY, JSON.stringify(conflicts.filter(item => item.id !== conflictId)));
  return conflict;
}

export async function loginToSyncApi(baseUrl, username, password, fetchImpl = fetch) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Enter the API URL including http:// or https://.');
  const response = await fetchImpl(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error || 'Sign-in failed.');
  return { baseUrl: base, token: data.token, user: data.user };
}

export async function syncSnapshot({ baseUrl, token, storage, role = 'admin', fetchImpl = fetch }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!token) throw new Error('Sign in to the sync server first.');
  if (!/^https?:\/\//i.test(base)) throw new Error('Enter the API URL including http:// or https://.');
  const authHeaders = { Authorization: 'Bearer ' + token };
  const baseline = readJson(storage, BASELINE_KEY, null);
  const pending = buildSnapshotEvents(storage, role);
  const pendingByKey = new Map(pending.map(event => [event.entity + ':' + event.recordId, event]));
  const existingConflicts = readJson(storage, CONFLICTS_KEY, []);
  const conflictKeys = new Set(existingConflicts.map(item => item.entity + ':' + item.recordId));
  let cursor = Number(storage.getItem(CURSOR_KEY) || 0);
  let downloaded = 0;
  let nextConflicts = [...existingConflicts];

  for (let page = 0; page < 20; page++) {
    const previousCursor = cursor;
    const response = await fetchImpl(base + '/api/sync/pull?after=' + encodeURIComponent(cursor), { headers: authHeaders });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Download failed.');
    const batch = data.events || [];
    const safeBatch = [];
    for (const event of batch) {
      const key = event.entity + ':' + event.record_id;
      const localEvent = pendingByKey.get(key);
      const remoteValue = event.operation === 'delete' ? undefined : event.payload;
      const localValue = localEvent?.operation === 'delete' ? undefined : localEvent?.payload;
      if (localEvent && !conflictKeys.has(key) && stable(remoteValue) !== stable(localValue)) {
        const conflict = { id: uuid(), entity: event.entity, recordId: String(event.record_id), local: localValue, remote: remoteValue, remoteEvent: event, detectedAt: new Date().toISOString() };
        nextConflicts.push(conflict);
        conflictKeys.add(key);
      }
      if (!conflictKeys.has(key)) safeBatch.push(event);
    }
    applyPulledEvents(storage, safeBatch);
    cursor = Math.max(cursor, ...batch.map(event => Number(event.sequence) || 0));
    storage.setItem(CURSOR_KEY, String(cursor));
    downloaded += batch.length;
    if (batch.length < 500 || cursor <= previousCursor) break;
  }
  storage.setItem(CONFLICTS_KEY, JSON.stringify(nextConflicts));

  const outgoing = pending.filter(event => !conflictKeys.has(event.entity + ':' + event.recordId));
  let uploaded = 0;
  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  for (let offset = 0; offset < outgoing.length; offset += 100) {
    const response = await fetchImpl(base + '/api/sync/push', { method: 'POST', headers, body: JSON.stringify({ events: outgoing.slice(offset, offset + 100) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload failed.');
    uploaded += Number(data.accepted || 0);
  }
  captureBaseline(storage, DEFAULT_SYNC_ENTITIES, conflictKeys, role);
  return { uploaded, downloaded, cursor, conflicts: nextConflicts.length };
}
