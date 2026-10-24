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
  const priorOutbox = readJson(storage, OUTBOX_KEY, []);
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
  const nextOutbox = priorOutbox.filter(event => !permittedEntities.has(event.entity));
  const events = desired.map(item => {
    const key = item.entity + ':' + item.recordId;
    const prior = priorByKey.get(key);
    const reusable = prior && prior.operation === item.operation &&
      (item.operation === 'delete' || stable(prior.payload) === stable(item.payload));
    const event = reusable ? prior : {
      eventId: uuid(), ...item, occurredAt: new Date().toISOString()
    };
    nextOutbox.push(event);
    return event;
  });
  storage.setItem(OUTBOX_KEY, JSON.stringify(nextOutbox));
  return events;
}

