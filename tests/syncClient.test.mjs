import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPulledEvents, buildSnapshotEvents, loginToSyncApi } from '../src/syncClient.mjs';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    inspect: key => values.get(key)
  };
}


test('corrupt sync baseline metadata is preserved and blocks a destructive rebuild', () => {
  const corrupt = '{"orders":';
  const outbox = JSON.stringify([{ eventId: 'saved-event', entity: 'orders', recordId: 'o-1', operation: 'upsert', payload: { id: 'o-1' } }]);
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]),
    'malik-syncBaseline': corrupt,
    'malik-syncOutbox': outbox
  });
  assert.throws(() => buildSnapshotEvents(storage, 'admin'), /sync metadata "malik-syncBaseline".*preserved/i);
  assert.equal(storage.inspect('malik-syncBaseline'), corrupt);
  assert.equal(storage.inspect('malik-syncOutbox'), outbox);
});

test('corrupt sync version metadata is preserved and blocks creating replacement event IDs', () => {
  const corrupt = '{';
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]),
    'malik-syncVersions': corrupt
  });
  assert.throws(() => buildSnapshotEvents(storage, 'admin'), /sync metadata "malik-syncVersions".*preserved/i);
  assert.equal(storage.inspect('malik-syncVersions'), corrupt);
  assert.equal(storage.inspect('malik-syncOutbox'), undefined);
});

test('malformed sync outbox is preserved and blocks a destructive snapshot rebuild', () => {
  const corrupt = '{"eventId":';
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]), 'malik-syncOutbox': corrupt });
  assert.throws(() => buildSnapshotEvents(storage, 'admin'), /outbox is unreadable.*preserved/i);
  assert.equal(storage.inspect('malik-syncOutbox'), corrupt);
});

test('invalid queued sync events are preserved rather than uploaded', () => {
  const corrupt = JSON.stringify([{ eventId: 'not-a-valid-event', entity: 'orders', recordId: 'o-1', operation: 'upsert', payload: { id: 'o-1' } }]);
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]), 'malik-syncOutbox': corrupt });
  assert.throws(() => buildSnapshotEvents(storage, 'admin'), /outbox has an invalid format.*preserved/i);
  assert.equal(storage.inspect('malik-syncOutbox'), corrupt);
});

test('invalid queued sync timestamps are preserved and block upload', () => {
  const corrupt = JSON.stringify([{
    eventId: '123e4567-e89b-42d3-a456-426614174000',
    entity: 'orders', recordId: 'o-1', operation: 'upsert',
    payload: { id: 'o-1' }, expectedSequence: null, occurredAt: 'not-a-date'
  }]);
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]),
    'malik-syncOutbox': corrupt
  });
  assert.throws(() => buildSnapshotEvents(storage, 'admin'), /outbox has an invalid format.*preserved/i);
  assert.equal(storage.inspect('malik-syncOutbox'), corrupt);
});

test('snapshot excludes staff secrets and cashier catalog writes', () => {
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 500 }]),
    'malik-products': JSON.stringify([{ id: 'p-1', name: 'Tea' }]),
    'malik-staff': JSON.stringify([{ id: 1, pin: '1234' }])
  });
  const events = buildSnapshotEvents(storage, 'cashier');
  assert.equal(events.length, 1);
  assert.equal(events[0].entity, 'orders');
  assert.equal(events[0].recordId, 'o-1');
  assert.equal(JSON.stringify(events).includes('1234'), false);
});

test('snapshot includes catalog for managers but never staff records', () => {
  const storage = fakeStorage({
    'malik-products': JSON.stringify([{ id: 'p-1', name: 'Tea' }]),
    'malik-staff': JSON.stringify([{ id: 1, pin: '1234' }])
  });
  const events = buildSnapshotEvents(storage, 'manager');
  assert.equal(events.length, 1);
  assert.equal(events[0].entity, 'products');
});

test('pulled upserts merge by id and advance the event cursor', () => {
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]) });
  const cursor = applyPulledEvents(storage, [
    { sequence: '4', entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 20 } },
    { sequence: '5', entity: 'orders', record_id: 'o-2', operation: 'upsert', payload: { id: 'o-2', total: 30 } }
  ]);
  assert.equal(cursor, 5);
  assert.deepEqual(JSON.parse(storage.inspect('malik-orders')), [{ id: 'o-1', total: 20 }, { id: 'o-2', total: 30 }]);
});

test('pulled deletes remove records by id', () => {
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1' }, { id: 'o-2' }]) });
  applyPulledEvents(storage, [{ sequence: '8', entity: 'orders', record_id: 'o-1', operation: 'delete' }]);
  assert.deepEqual(JSON.parse(storage.inspect('malik-orders')), [{ id: 'o-2' }]);
});

test('login rejects an invalid API URL before making a request', async () => {
  await assert.rejects(() => loginToSyncApi('not-a-url', 'owner', 'secret', async () => {
    throw new Error('fetch should not be called');
  }), /API URL/);
});

test('login trims trailing slashes from the API URL', async () => {
  let requestedUrl = '';
  const result = await loginToSyncApi('https://pos.example.test///', 'owner', 'secret', async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ token: 'test-token', user: { name: 'Owner', role: 'admin' } }) };
  });
  assert.equal(requestedUrl, 'https://pos.example.test/api/auth/login');
  assert.equal(result.baseUrl, 'https://pos.example.test');
});


test('snapshot sync uploads only changed records and emits delete tombstones', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }, { id: 'o-2', total: 20 }])
  });
  const pushed = [];
  const fetchMock = async (url, options = {}) => {
    if (String(url).includes('/api/sync/pull')) return { ok: true, json: async () => ({ events: [] }) };
    const body = JSON.parse(options.body);
    pushed.push(...body.events);
    return { ok: true, json: async () => ({ accepted: body.events.length }) };
  };
  await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock });
  assert.equal(pushed.length, 2);
  pushed.length = 0;
  storage.setItem('malik-orders', JSON.stringify([{ id: 'o-1', total: 15 }]));
  await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock });
  assert.equal(pushed.length, 2);
  assert.equal(pushed.find(e => e.recordId === 'o-1').operation, 'upsert');
  assert.equal(pushed.find(e => e.recordId === 'o-2').operation, 'delete');
});

test('failed upload retries only local changes and does not re-upload downloaded server records', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'local-order', total: 10 }]) });
  let failPush = true;
  const pushed = [];
  const fetchMock = async (url, options = {}) => {
    if (String(url).includes('/api/sync/pull')) {
      const after = Number(new URL(String(url)).searchParams.get('after') || 0);
      return { ok: true, json: async () => ({ events: after === 0 ? [
        { sequence: 1, entity: 'orders', record_id: 'server-order', operation: 'upsert', payload: { id: 'server-order', total: 25 } }
      ] : [] }) };
    }
    const body = JSON.parse(options.body || '{"events":[]}');
    pushed.push(...body.events);
    if (failPush) { failPush = false; throw new Error('temporary upload failure'); }
    return { ok: true, json: async () => ({ accepted: body.events.length, results: body.events.map(event => ({ eventId: event.eventId, status: 'applied', sequence: 2 })) }) };
  };
  await assert.rejects(() => syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock }), /temporary upload failure/);
  assert.deepEqual(JSON.parse(storage.inspect('malik-orders')), [
    { id: 'local-order', total: 10 },
    { id: 'server-order', total: 25 }
  ]);
  await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock });
  assert.ok(pushed.length >= 2);
  const retryPayloads = pushed.slice(1);
  assert.ok(retryPayloads.every(event => event.recordId === 'local-order'),
    'retry must not treat downloaded server records as new local edits');
});

test('concurrent local and server edits are held for explicit conflict review', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]) });
  const fetchMock = async (url, options = {}) => {
    if (String(url).includes('/api/sync/pull')) return { ok: true, json: async () => ({ events: [] }) };
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ accepted: body.events.length }) };
  };
  await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock });
  storage.setItem('malik-orders', JSON.stringify([{ id: 'o-1', total: 20 }]));
  let served = false;
  const conflictFetch = async (url, options = {}) => {
    if (String(url).includes('/api/sync/pull')) {
      if (served) return { ok: true, json: async () => ({ events: [] }) };
      served = true;
      return { ok: true, json: async () => ({ events: [{ sequence: 1, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 30 } }] }) };
    }
    const body = JSON.parse(options.body);
    assert.equal(body.events.some(e => e.recordId === 'o-1'), false);
    return { ok: true, json: async () => ({ accepted: body.events.length }) };
  };
  const result = await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: conflictFetch });
  assert.equal(result.conflicts, 1);
  assert.deepEqual(JSON.parse(storage.inspect('malik-orders')), [{ id: 'o-1', total: 20 }]);
  assert.equal(JSON.parse(storage.inspect('malik-syncConflicts')).length, 1);
});


test('pending sync events retain IDs across failed network attempts', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 50 }]) });
  const first = buildSnapshotEvents(storage, 'admin');
  await assert.rejects(() => syncSnapshot({
    baseUrl: 'https://pos.example.test', token: 'token', storage,
    fetchImpl: async () => { throw new Error('network down'); }
  }), /network down/);
  const second = buildSnapshotEvents(storage, 'admin');
  assert.equal(second[0].eventId, first[0].eventId);
});


test('conflict review retains the newest server version from a multi-event pull', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]) });
  const fetchMock = async (url, options = {}) => {
    if (String(url).includes('/api/sync/pull')) {
      const after = Number(new URL(String(url)).searchParams.get('after') || 0);
      if (after > 0) return { ok: true, json: async () => ({ events: [] }) };
      return { ok: true, json: async () => ({ events: [
        { sequence: 1, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 20 } },
        { sequence: 2, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 30 } }
      ] }) };
    }
    const body = JSON.parse(options.body || '{"events":[]}');
    return { ok: true, json: async () => ({ accepted: body.events.length }) };
  };
  // Establish a baseline/outbox before the remote edits arrive.
  const firstStorage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]) });
  await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage: firstStorage, fetchImpl: async url => ({ ok: true, json: async () => ({ events: [] }) }) });
  storage.setItem('malik-syncBaseline', firstStorage.inspect('malik-syncBaseline'));
  storage.setItem('malik-syncOutbox', firstStorage.inspect('malik-syncOutbox') || '[]');
  storage.setItem('malik-orders', JSON.stringify([{ id: 'o-1', total: 15 }]));
  await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock });
  const conflicts = JSON.parse(storage.inspect('malik-syncConflicts'));
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].remote, { id: 'o-1', total: 30 });
  assert.equal(conflicts[0].remoteEvent.sequence, 2);
});


test('new sync events carry the last observed server sequence for optimistic concurrency', () => {
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]),
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 42 })
  });
  const events = buildSnapshotEvents(storage, 'admin');
  assert.equal(events[0].expectedSequence, 42);
});

test('pulled events preserve per-record server versions even when only cursor bookkeeping is needed', () => {
  const storage = fakeStorage({ 'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]) });
  applyPulledEvents(storage, [{ sequence: '17', entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 10 } }]);
  assert.equal(JSON.parse(storage.inspect('malik-syncVersions'))['orders:o-1'], 17);
});


test('sync drops a pending write when the server already has the identical record', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 20 }]),
    'malik-syncBaseline': JSON.stringify({ orders: { 'o-1': { id: 'o-1', total: 10 } } }),
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 1 })
  });
  let pushes = 0;
  const fetchMock = async (url) => {
    if (String(url).includes('/api/sync/pull')) return { ok: true, json: async () => ({ events: [{ sequence: 2, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 20 } }] }) };
    pushes += 1;
    return { ok: true, json: async () => ({ accepted: 0, results: [] }) };
  };
  const result = await syncSnapshot({ baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock });
  assert.equal(result.conflicts, 0);
  assert.equal(pushes, 0);
  assert.deepEqual(JSON.parse(storage.inspect('malik-syncOutbox')), []);
});


test('pending sync write is compensated when local state returns to its previous baseline', () => {
  const priorEventId = '123e4567-e89b-42d3-a456-426614174000';
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 10 }]),
    'malik-syncBaseline': JSON.stringify({ orders: { 'o-1': { id: 'o-1', total: 10 } } }),
    'malik-syncOutbox': JSON.stringify([{
      eventId: priorEventId, entity: 'orders', recordId: 'o-1', operation: 'upsert',
      payload: { id: 'o-1', total: 20 }, expectedSequence: 4, occurredAt: '2026-01-01T00:00:00.000Z'
    }]),
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 4 })
  });
  const events = buildSnapshotEvents(storage, 'admin');
  assert.equal(events.length, 1, 'do not silently discard a potentially server-accepted event');
  assert.equal(events[0].operation, 'upsert');
  assert.deepEqual(events[0].payload, { id: 'o-1', total: 10 });
  assert.notEqual(events[0].eventId, priorEventId, 'changed payload must use a fresh event ID');
  assert.equal(events[0].expectedSequence, 4);
});


test('choosing local sync conflict creates a fresh write against the latest remote version', async () => {
  const { resolveSyncConflict } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 20 }]),
    'malik-syncBaseline': JSON.stringify({ orders: { 'o-1': { id: 'o-1', total: 10 } } }),
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 12 }),
    'malik-syncOutbox': JSON.stringify([{
      eventId: '123e4567-e89b-42d3-a456-426614174000', entity: 'orders', recordId: 'o-1',
      operation: 'upsert', payload: { id: 'o-1', total: 20 }, expectedSequence: 8,
      occurredAt: '2026-01-01T00:00:00.000Z'
    }]),
    'malik-syncConflicts': JSON.stringify([{
      id: 'conflict-1', entity: 'orders', recordId: 'o-1', local: { id: 'o-1', total: 20 },
      remote: { id: 'o-1', total: 30 },
      remoteEvent: { sequence: 12, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 30 } }
    }])
  });
  resolveSyncConflict(storage, 'conflict-1', 'local');
  const events = buildSnapshotEvents(storage, 'admin');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, { id: 'o-1', total: 20 });
  assert.equal(events[0].expectedSequence, 12);
  assert.notEqual(events[0].eventId, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(JSON.parse(storage.inspect('malik-syncConflicts')), []);
});

test('choosing remote sync conflict applies server value and clears the stale local write', async () => {
  const { resolveSyncConflict } = await import('../src/syncClient.mjs');
  const storage = fakeStorage({
    'malik-orders': JSON.stringify([{ id: 'o-1', total: 20 }]),
    'malik-syncBaseline': JSON.stringify({ orders: { 'o-1': { id: 'o-1', total: 10 } } }),
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 12 }),
    'malik-syncOutbox': JSON.stringify([{
      eventId: '123e4567-e89b-42d3-a456-426614174000', entity: 'orders', recordId: 'o-1',
      operation: 'upsert', payload: { id: 'o-1', total: 20 }, expectedSequence: 8,
      occurredAt: '2026-01-01T00:00:00.000Z'
    }]),
    'malik-syncConflicts': JSON.stringify([{
      id: 'conflict-1', entity: 'orders', recordId: 'o-1', local: { id: 'o-1', total: 20 },
      remote: { id: 'o-1', total: 30 },
      remoteEvent: { sequence: 12, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 30 } }
    }])
  });
  resolveSyncConflict(storage, 'conflict-1', 'remote');
  assert.deepEqual(JSON.parse(storage.inspect('malik-orders')), [{ id: 'o-1', total: 30 }]);
  assert.deepEqual(buildSnapshotEvents(storage, 'admin'), []);
  assert.deepEqual(JSON.parse(storage.inspect('malik-syncConflicts')), []);
});


test('valid JSON with the wrong collection shape is preserved and blocks destructive sync', () => {
  const malformed = JSON.stringify({ unexpected: 'object instead of records array' });
  const baseline = JSON.stringify({ orders: { 'o-1': { id: 'o-1', total: 10 } } });
  const outbox = JSON.stringify([{ eventId: '123e4567-e89b-42d3-a456-426614174000', entity: 'orders', recordId: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 10 } }]);
  const storage = fakeStorage({
    'malik-orders': malformed,
    'malik-syncBaseline': baseline,
    'malik-syncOutbox': outbox
  });
  assert.throws(() => buildSnapshotEvents(storage, 'admin'), /malik-orders.*unexpected format.*preserved/i);
  assert.equal(storage.inspect('malik-orders'), malformed);
  assert.equal(storage.inspect('malik-syncBaseline'), baseline);
  assert.equal(storage.inspect('malik-syncOutbox'), outbox);
});


test('invalid pulled events are rejected before changing local records or sync progress', () => {
  const original = JSON.stringify([{ id: 'o-1', total: 10 }]);
  const storage = fakeStorage({
    'malik-orders': original,
    'malik-syncCursor': '7',
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 7 })
  });
  assert.throws(() => applyPulledEvents(storage, [
    { sequence: 8, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 20 } },
    { sequence: 9, entity: 'orders', record_id: 'o-2', operation: 'upsert', payload: [] }
  ]), /invalid event.*preserved/i);
  assert.equal(storage.inspect('malik-orders'), original);
  assert.equal(storage.inspect('malik-syncCursor'), '7');
  assert.equal(storage.inspect('malik-syncVersions'), JSON.stringify({ 'orders:o-1': 7 }));
});

test('invalid pulled event timestamps are rejected before changing local records or sync progress', () => {
  const original = JSON.stringify([{ id: 'o-1', total: 10 }]);
  const storage = fakeStorage({
    'malik-orders': original,
    'malik-syncCursor': '7',
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 7 })
  });
  assert.throws(() => applyPulledEvents(storage, [
    { sequence: 8, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 20 }, occurred_at: 'not-a-date' }
  ]), /invalid event.*preserved/i);
  assert.equal(storage.inspect('malik-orders'), original);
  assert.equal(storage.inspect('malik-syncCursor'), '7');
  assert.equal(storage.inspect('malik-syncVersions'), JSON.stringify({ 'orders:o-1': 7 }));
});

test('delete events with payloads are rejected before changing local records or sync progress', () => {
  const original = JSON.stringify([{ id: 'o-1', total: 10 }]);
  const storage = fakeStorage({
    'malik-orders': original,
    'malik-syncCursor': '7',
    'malik-syncVersions': JSON.stringify({ 'orders:o-1': 7 })
  });
  assert.throws(() => applyPulledEvents(storage, [
    { sequence: 8, entity: 'orders', record_id: 'o-1', operation: 'delete', payload: { id: 'o-1' } }
  ]), /invalid event.*preserved/i);
  assert.equal(storage.inspect('malik-orders'), original);
  assert.equal(storage.inspect('malik-syncCursor'), '7');
  assert.equal(storage.inspect('malik-syncVersions'), JSON.stringify({ 'orders:o-1': 7 }));
});

test('sync rejects a malformed server event batch before persisting its cursor', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  const orders = JSON.stringify([{ id: 'o-1', total: 10 }]);
  const storage = fakeStorage({ 'malik-orders': orders, 'malik-syncCursor': '3' });
  const fetchMock = async url => {
    if (String(url).includes('/api/sync/pull')) {
      return { ok: true, json: async () => ({ events: [
        { sequence: 4, entity: 'orders', record_id: 'o-1', operation: 'upsert', payload: { id: 'o-1', total: 20 } },
        { sequence: 'not-a-sequence', entity: 'orders', record_id: 'o-2', operation: 'delete' }
      ] }) };
    }
    throw new Error('push must not be reached');
  };
  await assert.rejects(() => syncSnapshot({
    baseUrl: 'https://pos.example.test', token: 'token', storage, fetchImpl: fetchMock
  }), /invalid event.*preserved/i);
  assert.equal(storage.inspect('malik-orders'), orders);
  assert.equal(storage.inspect('malik-syncCursor'), '3');
});



test('non-increasing pulled event sequences are rejected before local data or sync progress changes', () => {
  for (const events of [
    [
      { sequence: 4, entity: 'orders', record_id: 'o-2', operation: 'upsert', payload: { id: 'o-2', total: 20 } },
      { sequence: 4, entity: 'orders', record_id: 'o-3', operation: 'upsert', payload: { id: 'o-3', total: 30 } }
    ],
    [
      { sequence: 5, entity: 'orders', record_id: 'o-2', operation: 'upsert', payload: { id: 'o-2', total: 20 } },
      { sequence: 3, entity: 'orders', record_id: 'o-3', operation: 'upsert', payload: { id: 'o-3', total: 30 } }
    ],
    [
      { sequence: 0, entity: 'orders', record_id: 'o-2', operation: 'upsert', payload: { id: 'o-2', total: 20 } }
    ]
  ]) {
    const records = JSON.stringify([{ id: 'o-1', total: 10 }]);
    const versions = JSON.stringify({ 'orders:o-1': 2 });
    const storage = fakeStorage({
      'malik-orders': records,
      'malik-syncCursor': '2',
      'malik-syncVersions': versions
    });
    assert.throws(() => applyPulledEvents(storage, events), /invalid event batch or non-increasing event sequence/i);
    assert.equal(storage.inspect('malik-orders'), records);
    assert.equal(storage.inspect('malik-syncCursor'), '2');
    assert.equal(storage.inspect('malik-syncVersions'), versions);
  }
});


test('sync pull response without an events array is rejected before checkpointing local data', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  for (const responseBody of [{}, { events: null }, { events: {} }]) {
    const baseline = JSON.stringify({ orders: { 'o-1': { id: 'o-1', total: 10 } } });
    const records = JSON.stringify([{ id: 'o-1', total: 10 }]);
    const storage = fakeStorage({
      'malik-orders': records,
      'malik-syncBaseline': baseline,
      'malik-syncCursor': '7',
      'malik-syncVersions': JSON.stringify({ 'orders:o-1': 7 })
    });
    await assert.rejects(() => syncSnapshot({
      baseUrl: 'https://pos.example.test', token: 'test-token', storage,
      fetchImpl: async () => ({ ok: true, json: async () => responseBody })
    }), /invalid event batch/i);
    assert.equal(storage.inspect('malik-orders'), records);
    assert.equal(storage.inspect('malik-syncBaseline'), baseline);
    assert.equal(storage.inspect('malik-syncCursor'), '7');
    assert.equal(storage.inspect('malik-syncVersions'), JSON.stringify({ 'orders:o-1': 7 }));
  }
});


test('invalid saved sync cursors are preserved and block sync before the outbox changes', async () => {
  const { syncSnapshot } = await import('../src/syncClient.mjs');
  for (const invalidCursor of ['not-a-number', '-1', '1.5', '9007199254740992']) {
    const outbox = JSON.stringify([{
      eventId: '123e4567-e89b-42d3-a456-426614174000',
      entity: 'orders', recordId: 'o-1', operation: 'upsert',
      payload: { id: 'o-1', total: 20 }, expectedSequence: null
    }]);
    const storage = fakeStorage({
      'malik-orders': JSON.stringify([{ id: 'o-1', total: 20 }]),
      'malik-syncCursor': invalidCursor,
      'malik-syncOutbox': outbox
    });
    let called = false;
    await assert.rejects(() => syncSnapshot({
      baseUrl: 'https://pos.example.test', token: 'test-token', storage,
      fetchImpl: async () => { called = true; throw new Error('fetch should not be called'); }
    }), /saved sync cursor is invalid.*preserved/i);
    assert.equal(called, false);
    assert.equal(storage.inspect('malik-syncCursor'), invalidCursor);
    assert.equal(storage.inspect('malik-syncOutbox'), outbox);
  }
});
