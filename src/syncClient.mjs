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
const OUTBOX_KEY = 'malik-syncOutbox';
const CURSOR_KEY = 'malik-syncCursor';
const VERSIONS_KEY = 'malik-syncVersions';
const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('This device cannot create secure sync event IDs. Update the browser or desktop app.');
};
const stable = value => JSON.stringify(value);
function readJson(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) ?? fallback;
  } catch {
    throw new Error(`Saved sync metadata "${key}" is unreadable. Its contents were preserved; do not clear app data before recovery.`);
  }
}
function readOutbox(storage) {
  const raw = storage.getItem(OUTBOX_KEY);
  if (raw == null) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error('Saved sync outbox is unreadable. Its contents were preserved; do not clear app data before recovery.');
  }
  if (!Array.isArray(parsed) || parsed.some(event => {
    if (!event || typeof event !== 'object' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.eventId || '') || typeof event.entity !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(event.entity) || typeof event.recordId !== 'string' || !event.recordId.trim() || event.recordId.length > 200 || !['upsert', 'delete'].includes(event.operation)) return true;
    if (event.operation === 'upsert' && (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload))) return true;
    if (Object.hasOwn(event, 'expectedSequence') && event.expectedSequence !== null && (!Number.isSafeInteger(event.expectedSequence) || event.expectedSequence < 0)) return true;
    if (Object.hasOwn(event, 'occurredAt') && event.occurredAt !== null &&
        (typeof event.occurredAt !== 'string' || !event.occurredAt.trim() || !Number.isFinite(Date.parse(event.occurredAt)))) return true;
    return false;
  })) {
    throw new Error('Saved sync outbox has an invalid format. Its contents were preserved; do not clear app data before recovery.');
  }
  return parsed;
}
function roleAllowed(role, entity) {
  return role === 'admin' || role === 'manager' ||
    (role === 'cashier' && ['orders','timechargesessions','cashentries','attendance','audittrail'].includes(entity));
}
function currentRecords(storage, def) {
  const storageKey = 'malik-' + def.key;
  const parsed = readJson(storage, storageKey, def.collection ? [] : null);
  if (def.collection && !Array.isArray(parsed)) {
    throw new Error(`Saved POS data "${storageKey}" has an unexpected format. Its contents were preserved; do not sync or clear app data before recovery.`);
  }
  const values = def.collection ? parsed : (parsed == null ? [] : [{ id: 'singleton', value: parsed }]);
  const records = {};
  for (const [i, record] of values.entries()) {
    const id = String(record?.id ?? record?.uuid ?? i);
    if (Object.hasOwn(records, id)) {
      throw new Error(`Saved POS data "${storageKey}" contains duplicate record ID "${id}". Its contents were preserved; resolve duplicates before syncing.`);
    }
    records[id] = record;
  }
  return records;
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
  const priorOutbox = readOutbox(storage);
  const versions = readJson(storage, VERSIONS_KEY, {});
  const priorByKey = new Map(priorOutbox.map(event => [event.entity + ':' + event.recordId, event]));
  const desired = [];
  const permittedEntities = new Set(definitions.filter(def => roleAllowed(role, def.entity)).map(def => def.entity));
  for (const def of definitions) {
    if (!roleAllowed(role, def.entity)) continue;
    const current = currentRecords(storage, def);
    const previous = baseline?.[def.entity] || {};
    for (const [recordId, payload] of Object.entries(current)) {
      if (!Object.hasOwn(previous, recordId) || stable(previous[recordId]) !== stable(payload)) {
        desired.push({ entity: def.entity, recordId, operation: 'upsert', payload });
      }
    }
    if (baseline) {
      for (const recordId of Object.keys(previous)) {
        if (!Object.hasOwn(current, recordId)) desired.push({ entity: def.entity, recordId, operation: 'delete' });
      }
    }
  }
  // A queued write may have been accepted by the server even if its response was lost.
  // If local state later returns to its baseline (or a queued new record is removed),
  // emit a compensating event instead of silently discarding the only recovery record.
  const desiredByKey = new Map(desired.map(item => [item.entity + ':' + item.recordId, item]));
  for (const prior of priorOutbox) {
    if (!permittedEntities.has(prior.entity)) continue;
    const key = prior.entity + ':' + prior.recordId;
    if (desiredByKey.has(key)) continue;
    const def = definitions.find(item => item.entity === prior.entity);
    if (!def) continue;
    const current = currentRecords(storage, def);
    desiredByKey.set(key, Object.hasOwn(current, prior.recordId)
      ? { entity: prior.entity, recordId: prior.recordId, operation: 'upsert', payload: current[prior.recordId] }
      : { entity: prior.entity, recordId: prior.recordId, operation: 'delete' });
  }
  const nextOutbox = priorOutbox.filter(event => !permittedEntities.has(event.entity));
  const events = [...desiredByKey.values()].map(item => {
    const key = item.entity + ':' + item.recordId;
    const prior = priorByKey.get(key);
    const reusable = prior && prior.operation === item.operation &&
      (item.operation === 'delete' || stable(prior.payload) === stable(item.payload));
    const event = reusable ? prior : {
      eventId: uuid(), ...item, expectedSequence: Object.hasOwn(versions, key) ? Number(versions[key]) : null, occurredAt: new Date().toISOString()
    };
    nextOutbox.push(event);
    return event;
  });
  storage.setItem(OUTBOX_KEY, JSON.stringify(nextOutbox));
  return events;
}


function validatePulledEvents(events) {
  if (!Array.isArray(events)) {
    throw new Error('The sync server returned an invalid event batch. Local POS data and sync progress were preserved.');
  }
  let previousSequence = 0;
  for (const event of events) {
    const sequence = Number(event?.sequence);
    const recordId = event?.record_id;
    if (!event || typeof event !== 'object' ||
        !Number.isSafeInteger(sequence) || sequence <= previousSequence ||
        typeof event.entity !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(event.entity) ||
        !['string', 'number'].includes(typeof recordId) || !String(recordId).trim() || String(recordId).length > 200 ||
        !['upsert', 'delete'].includes(event.operation) ||
        (Object.hasOwn(event, 'occurred_at') && event.occurred_at !== null &&
          (typeof event.occurred_at !== 'string' || !event.occurred_at.trim() || !Number.isFinite(Date.parse(event.occurred_at)))) ||
        (event.operation === 'upsert' && (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload))) ||
        (event.operation === 'upsert' && event.payload && Object.hasOwn(event.payload, 'id') && String(event.payload.id) !== String(recordId)) ||
        (event.operation === 'delete' && event.payload != null)) {
      throw new Error('The sync server returned an invalid event batch or non-increasing event sequence. Local POS data and sync progress were preserved; retry sync after checking the server.');
    }
    previousSequence = sequence;
  }
  return events;
}

export function applyPulledEvents(storage, events, cursorKey = CURSOR_KEY, definitions = DEFAULT_SYNC_ENTITIES) {
  validatePulledEvents(events);
  const byEntity = new Map(definitions.map(def => [def.entity, def]));
  const grouped = new Map();
  const rawCursor = storage.getItem(cursorKey);
  const nextCursorValue = rawCursor == null || rawCursor === '' ? 0 : Number(rawCursor);
  if (!Number.isSafeInteger(nextCursorValue) || nextCursorValue < 0) {
    throw new Error('Saved sync cursor is invalid. Its contents were preserved; do not clear app data before recovery.');
  }
  let nextCursor = nextCursorValue;
  const versions = readJson(storage, VERSIONS_KEY, {});
  for (const event of events) {
    const sequence = Number(event.sequence);
    if (Number.isSafeInteger(sequence)) {
      nextCursor = Math.max(nextCursor, sequence);
      if (event.entity && event.record_id != null) versions[event.entity + ':' + String(event.record_id)] = sequence;
    }
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
  storage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  return nextCursor;
}

export function resolveSyncConflict(storage, conflictId, choice, role = 'admin', definitions = DEFAULT_SYNC_ENTITIES) {
  const conflicts = readJson(storage, CONFLICTS_KEY, []);
  const conflict = conflicts.find(item => item.id === conflictId);
  if (!conflict) throw new Error('This sync conflict no longer exists.');
  if (choice !== 'local' && choice !== 'remote') throw new Error('Choose local or remote data.');
  if (choice === 'remote') {
    const event = conflict.remoteEvent;
    applyPulledEvents(storage, [{ ...event, sequence: Number(event.sequence || storage.getItem(CURSOR_KEY) || 0) }], CURSOR_KEY, definitions);
    captureBaseline(storage, definitions, new Set(), role);
  }
  // A local choice must create a fresh event against the newest remote sequence, not retry the stale event.
  storage.setItem(OUTBOX_KEY, JSON.stringify(readOutbox(storage).filter(item => !(item.entity === conflict.entity && item.recordId === conflict.recordId))));
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
  const rawCursor = storage.getItem(CURSOR_KEY);
  const cursorValue = rawCursor == null || rawCursor === '' ? 0 : Number(rawCursor);
  if (!Number.isSafeInteger(cursorValue) || cursorValue < 0) {
    throw new Error('Saved sync cursor is invalid. Its contents were preserved; do not clear app data before recovery.');
  }
  const baseline = readJson(storage, BASELINE_KEY, null);
  const pending = buildSnapshotEvents(storage, role);
  const pendingByKey = new Map(pending.map(event => [event.entity + ':' + event.recordId, event]));
  const observedRemote = new Map();
  const existingConflicts = readJson(storage, CONFLICTS_KEY, []);
  const conflictKeys = new Set(existingConflicts.map(item => item.entity + ':' + item.recordId));
  let cursor = cursorValue;
  let downloaded = 0;
  let nextConflicts = [...existingConflicts];

  for (let page = 0; page < 20; page++) {
    const previousCursor = cursor;
    const response = await fetchImpl(base + '/api/sync/pull?after=' + encodeURIComponent(cursor), { headers: authHeaders });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Download failed.');
    const batch = validatePulledEvents(data.events);
    if (batch.some(event => Number(event.sequence) <= previousCursor)) {
      throw new Error('The sync server returned an event at or behind the saved cursor. Local POS data and sync progress were preserved; retry sync after checking the server.');
    }
    const expectedNextAfter = batch.length ? Number(batch[batch.length - 1].sequence) : previousCursor;
    if (Object.hasOwn(data, 'nextAfter')) {
      const reportedNextAfter = Number(data.nextAfter);
      if (!Number.isSafeInteger(reportedNextAfter) || reportedNextAfter < 0 || reportedNextAfter !== expectedNextAfter) {
        throw new Error('The sync server returned an invalid pagination cursor. Local POS data and sync progress were preserved; retry sync after checking the server.');
      }
    }
    const safeBatch = [];
    for (const event of batch) {
      const key = event.entity + ':' + event.record_id;
      observedRemote.set(key, event);
      const localEvent = pendingByKey.get(key);
      const remoteValue = event.operation === 'delete' ? undefined : event.payload;
      const localValue = localEvent?.operation === 'delete' ? undefined : localEvent?.payload;
      if (localEvent && stable(remoteValue) !== stable(localValue)) {
        const existingIndex = nextConflicts.findIndex(conflict => conflict.entity + ':' + conflict.recordId === key);
        if (existingIndex >= 0) {
          // A pull can contain multiple versions of one record; keep the newest server event for resolution.
          nextConflicts[existingIndex] = {
            ...nextConflicts[existingIndex],
            remote: remoteValue,
            remoteEvent: event,
            detectedAt: new Date().toISOString()
          };
          conflictKeys.add(key);
        } else if (!conflictKeys.has(key)) {
          nextConflicts.push({ id: uuid(), entity: event.entity, recordId: String(event.record_id), local: localValue, remote: remoteValue, remoteEvent: event, detectedAt: new Date().toISOString() });
          conflictKeys.add(key);
        }
      }
      if (!conflictKeys.has(key)) safeBatch.push(event);
    }
    const observedVersions = readJson(storage, VERSIONS_KEY, {});
    for (const event of batch) {
      const sequence = Number(event.sequence);
      if (event.entity && event.record_id != null && Number.isSafeInteger(sequence)) {
        observedVersions[event.entity + ':' + String(event.record_id)] = sequence;
      }
    }
    storage.setItem(VERSIONS_KEY, JSON.stringify(observedVersions));
    applyPulledEvents(storage, safeBatch);
    cursor = Math.max(cursor, ...batch.map(event => Number(event.sequence) || 0));
    storage.setItem(CURSOR_KEY, String(cursor));
    downloaded += batch.length;
    if (batch.length < 500 || cursor <= previousCursor) break;
  }
  storage.setItem(CONFLICTS_KEY, JSON.stringify(nextConflicts));

  // Persist the downloaded server baseline before upload, but keep each locally
  // changed record's previous baseline so a failed upload remains dirty and retryable.
  // Without this checkpoint, the next attempt can mistake freshly downloaded server
  // records for local changes and push them back as new writes.
  captureBaseline(storage, DEFAULT_SYNC_ENTITIES, new Set([...pendingByKey.keys(), ...conflictKeys]), role);

  const satisfiedEventIds = new Set();
  const outgoing = pending.filter(event => {
    const key = event.entity + ':' + event.recordId;
    if (conflictKeys.has(key)) return false;
    const remote = observedRemote.get(key);
    const alreadyPresent = remote && (
      (event.operation === 'delete' && remote.operation === 'delete') ||
      (event.operation === 'upsert' && remote.operation === 'upsert' && stable(event.payload) === stable(remote.payload))
    );
    if (alreadyPresent) { satisfiedEventIds.add(event.eventId); return false; }
    return true;
  });
  let uploaded = 0;
  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  for (let offset = 0; offset < outgoing.length; offset += 100) {
    const response = await fetchImpl(base + '/api/sync/push', { method: 'POST', headers, body: JSON.stringify({ events: outgoing.slice(offset, offset + 100) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload failed.');
    uploaded += Number(data.accepted || 0);
    const versions = readJson(storage, VERSIONS_KEY, {});
    for (const result of data.results || []) {
      const event = outgoing.find(item => item.eventId === result.eventId);
      if (event && Number.isSafeInteger(Number(result.sequence))) versions[event.entity + ':' + event.recordId] = Number(result.sequence);
    }
    storage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  }
  const sentIds = new Set(outgoing.map(event => event.eventId));
  storage.setItem(OUTBOX_KEY, JSON.stringify(readOutbox(storage).filter(event => !sentIds.has(event.eventId) && !satisfiedEventIds.has(event.eventId))));
  captureBaseline(storage, DEFAULT_SYNC_ENTITIES, conflictKeys, role);
  return { uploaded, downloaded, cursor, conflicts: nextConflicts.length };
}
