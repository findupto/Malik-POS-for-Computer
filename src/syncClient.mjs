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

const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('This device cannot create secure sync event IDs. Update the browser or desktop app.');
};

export function buildSnapshotEvents(storage, role = 'admin', definitions = DEFAULT_SYNC_ENTITIES) {
  const allowed = role === 'admin' || role === 'manager'
    ? null
    : new Set(['orders', 'timechargesessions', 'cashentries', 'attendance', 'audittrail']);
  const events = [];
  for (const def of definitions) {
    if (allowed && !allowed.has(def.entity)) continue;
    let value;
    try { value = JSON.parse(storage.getItem('malik-' + def.key) || (def.collection ? '[]' : 'null')); }
    catch { continue; }
    const records = def.collection ? (Array.isArray(value) ? value : []) : (value == null ? [] : [{ id: 'singleton', value }]);
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const recordId = String(record?.id ?? record?.uuid ?? index);
      events.push({ eventId: uuid(), entity: def.entity, recordId, operation: 'upsert', payload: record, occurredAt: new Date().toISOString() });
    }
  }
  return events;
}

export function applyPulledEvents(storage, events, cursorKey = 'malik-syncCursor', definitions = DEFAULT_SYNC_ENTITIES) {
  const byEntity = new Map(definitions.map(def => [def.entity, def]));
  const grouped = new Map();
  let nextCursor = Number(storage.getItem(cursorKey) || 0);
  for (const event of events || []) {
    const sequence = Number(event.sequence);
    if (Number.isSafeInteger(sequence)) nextCursor = Math.max(nextCursor, sequence);
    const def = byEntity.get(event.entity);
    if (!def) continue;
    const groupKey = def.key;
    if (!grouped.has(groupKey)) {
      let initial;
      try { initial = JSON.parse(storage.getItem('malik-' + def.key) || (def.collection ? '[]' : 'null')); }
      catch { initial = def.collection ? [] : null; }
      grouped.set(groupKey, { def, value: initial, records: new Map((Array.isArray(initial) ? initial : []).map(item => [String(item?.id ?? item?.uuid), item])) });
    }
    const group = grouped.get(groupKey);
    if (event.operation === 'delete') {
      group.records.delete(String(event.record_id));
    } else if (def.collection) {
      group.records.set(String(event.record_id), event.payload);
    } else {
      group.value = event.payload;
    }
  }
  for (const { def, value, records } of grouped.values()) {
    storage.setItem('malik-' + def.key, JSON.stringify(def.collection ? [...records.values()] : value));
  }
  storage.setItem(cursorKey, String(nextCursor));
  return nextCursor;
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
  const base = String(baseUrl || '').trim().replace(/\\/+$/, '');
  if (!token) throw new Error('Sign in to the sync server first.');
  const authHeaders = { Authorization: 'Bearer ' + token };
  let cursor = Number(storage.getItem('malik-syncCursor') || 0);
  let downloaded = 0;

  // Pull first so newly discovered records are merged locally before the snapshot is uploaded.
  // Same-ID conflicts currently use server-event order; full conflict review is not implemented.
  for (let page = 0; page < 20; page++) {
    const previousCursor = cursor;
    const response = await fetchImpl(base + '/api/sync/pull?after=' + encodeURIComponent(cursor), { headers: authHeaders });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Download failed.');
    const batch = data.events || [];
    cursor = applyPulledEvents(storage, batch);
    downloaded += batch.length;
    if (batch.length < 500 || cursor <= previousCursor) break;
  }

  const events = buildSnapshotEvents(storage, role);
  let uploaded = 0;
  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  for (let offset = 0; offset < events.length; offset += 100) {
    const response = await fetchImpl(base + '/api/sync/push', { method: 'POST', headers, body: JSON.stringify({ events: events.slice(offset, offset + 100) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload failed.');
    uploaded += Number(data.accepted || 0);
  }
  return { uploaded, downloaded, cursor };
}
