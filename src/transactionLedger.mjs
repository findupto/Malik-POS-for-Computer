const IDEMPOTENCY_KEY = 'malik-transactionIdempotency';
const SALE_OUTBOX_KEY = 'malik-transactionOutbox';

function readKeys(storage, key = IDEMPOTENCY_KEY) {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function getPendingSaleTransactions(storage = globalThis.localStorage) {
  if (!storage) return [];
  const outbox = readKeys(storage, SALE_OUTBOX_KEY);
  return Object.entries(outbox).filter(([orderId, payload]) =>
    Boolean(orderId && payload && typeof payload === 'object' && payload.orderId === orderId && payload.idempotencyKey)
  ).map(([orderId, payload]) => ({
    orderId,
    occurredAt: payload.occurredAt || '',
    itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
    total: Array.isArray(payload.tenders) ? payload.tenders.reduce((sum, tender) => sum + Math.max(0, Number(tender.amount) || 0), 0) : 0
  })).sort((a, b) => a.orderId.localeCompare(b.orderId));
}

function idempotencyKeyFor(storage, orderId, makeId) {
  const keys = readKeys(storage);
  if (typeof keys[orderId] === 'string' && keys[orderId]) return keys[orderId];
  const key = makeId();
  keys[orderId] = key;
  storage.setItem(IDEMPOTENCY_KEY, JSON.stringify(keys));
  return key;
}

export async function reconcilePendingSaleTransactions({ baseUrl, token, storage = globalThis.localStorage, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API before reconciling pending sales.');
  if (!storage || typeof fetchImpl !== 'function') throw new Error('Shared sale reconciliation is unavailable in this environment.');
  const outbox = readKeys(storage, SALE_OUTBOX_KEY);
  const pending = Object.entries(outbox).filter(([orderId, payload]) =>
    Boolean(orderId && payload && typeof payload === 'object' && payload.orderId === orderId && payload.idempotencyKey)
  );
  const reconciled = [];
  for (const [orderId, payload] of pending) {
    const url = new URL('/api/transactions', baseUrl);
    url.searchParams.set('limit', '1');
    url.searchParams.set('orderId', orderId);
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: 'Bearer ' + token }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'Could not check pending shared sales against the server ledger.');
    const transaction = (Array.isArray(data.transactions) ? data.transactions : []).find(item => String(item.order_id) === orderId);
    if (!transaction) continue;
    const tenders = Array.isArray(payload.tenders) ? payload.tenders : [];
    reconciled.push({
      orderId,
      transaction,
      payment: tenders.length ? String(tenders[0].method || 'Other') : 'Customer Due',
      paidAt: transaction.occurred_at || payload.occurredAt || new Date().toISOString()
    });
    delete outbox[orderId];
  }
  if (reconciled.length) storage.setItem(SALE_OUTBOX_KEY, JSON.stringify(outbox));
  return reconciled;
}

export async function recordSaleTransaction({ baseUrl, token, order, payment, storage = globalThis.localStorage, fetchImpl = globalThis.fetch, makeId = () => globalThis.crypto.randomUUID() }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API before recording a shared sale.');
  if (!order || !order.id || !Array.isArray(order.items) || !order.items.length) throw new Error('A sale with at least one item is required.');
  if (!storage || typeof fetchImpl !== 'function') throw new Error('Shared sale recording is unavailable in this environment.');
  const idempotencyKey = idempotencyKeyFor(storage, String(order.id), makeId);
  const outbox = readKeys(storage, SALE_OUTBOX_KEY);
  const queued = outbox[String(order.id)];
  const paymentMethod = String(payment || '');
  const tenders = paymentMethod === 'Customer Due' ? [] : [{
    method: ({ 'Cash': 'Cash', 'Card': 'Card', 'Bank Transfer': 'Bank Transfer', 'Mobile Wallet': 'Mobile Wallet' })[paymentMethod] || 'Other',
    amount: Number(order.total) || 0
  }];
  const payload = {
    idempotencyKey,
    orderId: String(order.id),
    customerName: String(order.customer || 'Walk-in Customer'),
    items: order.items.map(item => ({
      productId: String(item.id ?? ''),
      sku: String(item.sku || ''),
      productName: String(item.name || ''),
      quantity: Number(item.qty),
      unitPrice: Number(item.price)
    })),
    discountAmount: Number(order.discount) || 0,
    taxAmount: Number(order.tax) || 0,
    serviceChargeAmount: Number(order.serviceCharges) || 0,
    // The existing register total does not include deliveryFee, so do not add it a second time.
    deliveryFee: 0,
    serviceType: String(order.serviceType || ''),
    tableNumber: String(order.tableNumber || ''),
    notes: [order.orderNote, order.kitchenNote].filter(Boolean).join(' · '),
    occurredAt: order.paidAt || new Date().toISOString(),
    tenders
  };
  // If a previous request lost its response, replay the exact saved payload with the same key.
  // This prevents a retry from silently changing the sale after the server may have committed it.
  const requestPayload = queued && queued.idempotencyKey === idempotencyKey ? queued : payload;
  outbox[String(order.id)] = requestPayload;
  storage.setItem(SALE_OUTBOX_KEY, JSON.stringify(outbox));
  let response;
  try {
    response = await fetchImpl(new URL('/api/transactions', baseUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(requestPayload)
    });
  } catch (error) {
    // Keep the durable outbox entry on network failure; the server may have committed before disconnect.
    throw error;
  }
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    // A client-side validation/conflict response confirms the request was rejected; allow a corrected retry.
    if (response.status >= 400 && response.status < 500) {
      delete outbox[String(order.id)];
      storage.setItem(SALE_OUTBOX_KEY, JSON.stringify(outbox));
    }
    throw new Error(result.error || 'The server did not record this sale. The order remains pending; retry payment to safely retry the same sale.');
  }
  delete outbox[String(order.id)];
  storage.setItem(SALE_OUTBOX_KEY, JSON.stringify(outbox));
  return result;
}


const REFUND_KEYS = 'malik-refundIdempotency';
function refundKeyFor(storage, orderId, refundDraft, makeId) {
  const keys = readKeys(storage, REFUND_KEYS);
  const fingerprint = [String(orderId), Number(refundDraft.amount).toFixed(2), String(refundDraft.method), String(refundDraft.reason || '').trim(), String(refundDraft.reference || '')].join('|');
  if (keys[fingerprint]) return keys[fingerprint];
  const key = makeId();
  keys[fingerprint] = key;
  storage.setItem(REFUND_KEYS, JSON.stringify(keys));
  return key;
}

export async function recordRefundTransaction({ baseUrl, token, order, refund, storage = globalThis.localStorage, fetchImpl = globalThis.fetch, makeId = () => globalThis.crypto.randomUUID() }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API before recording a shared refund.');
  if (!order?.id || !refund || !Number.isFinite(Number(refund.amount)) || Number(refund.amount) <= 0) throw new Error('A valid sale and positive refund amount are required.');
  if (!storage || typeof fetchImpl !== 'function') throw new Error('Shared refund recording is unavailable in this environment.');
  const response = await fetchImpl(new URL('/api/transactions?limit=200', baseUrl).toString(), {
    headers: { authorization: 'Bearer ' + token }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Could not locate the original server sale.');
  const transaction = (data.transactions || []).find(item => String(item.order_id) === String(order.id));
  if (!transaction) throw new Error('The original sale is not in the server ledger. No local refund was recorded.');
  const method = ({ 'Cash': 'Cash', 'Card reversal': 'Card', 'Bank transfer': 'Bank Transfer', 'Mobile wallet': 'Mobile Wallet', 'Customer account credit': 'Other' })[refund.method] || 'Other';
  const idempotencyKey = String(refund.idempotencyKey || refundKeyFor(storage, order.id, refund, makeId));
  const result = await fetchImpl(new URL('/api/transactions/' + encodeURIComponent(transaction.id) + '/refunds', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({
      idempotencyKey,
      amount: Number(refund.amount),
      method,
      reason: String(refund.reason || '').trim() + (refund.reference ? ' · Reference: ' + String(refund.reference).trim() : ''),
      restock: refund.restock === true,
      items: (Array.isArray(refund.returnItems) ? refund.returnItems : []).filter(item => Number(item.quantity) > 0).map(item => ({
        productId: String(item.productId ?? ''),
        productName: String(item.productName || ''),
        quantity: Number(item.quantity)
      }))
    })
  });
  let resultData = {};
  try { resultData = await result.json(); } catch {}
  if (!result.ok) throw new Error(resultData.error || 'The server did not record this refund. No local refund was recorded; retry after resolving the issue.');
  return resultData;
}


export async function fetchServerInventory({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API first.');
  const response = await fetchImpl(new URL('/api/inventory', baseUrl).toString(), {
    headers: { authorization: 'Bearer ' + token }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Could not load server inventory.');
  return Array.isArray(data.inventory) ? data.inventory : [];
}

export async function initializeServerInventory({ baseUrl, token, products, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API first.');
  if (!Array.isArray(products)) throw new Error('Product catalog is not available.');
  const results = [];
  for (const product of products) {
    const productId = String(product?.id ?? '').trim();
    const productName = String(product?.name || '').trim();
    if (!productId || !productName) continue;
    const response = await fetchImpl(new URL('/api/inventory/initialize', baseUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({
        productId,
        sku: String(product.sku || ''),
        productName,
        quantity: Math.max(0, Number(product.stock) || 0)
      })
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'Could not initialize stock for ' + productName + '.');
    results.push({ productId, productName, status: data.status, quantity: Number(data.inventory?.quantity ?? product.stock ?? 0) });
  }
  return results;
}


export async function recordInventoryAdjustment({ baseUrl, token, product, quantityDelta, reason, idempotencyKey = globalThis.crypto.randomUUID(), fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API first.');
  const delta = Number(quantityDelta);
  if (!product?.id || !String(product.name || '').trim()) throw new Error('Choose a valid product.');
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta * 1000 - Math.round(delta * 1000)) > 1e-6) throw new Error('Enter a non-zero quantity with at most three decimal places.');
  if (!String(reason || '').trim()) throw new Error('Enter a reason for the stock adjustment.');
  const response = await fetchImpl(new URL('/api/inventory/adjustments', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({
      idempotencyKey,
      productId: String(product.id),
      sku: String(product.sku || ''),
      productName: String(product.name || ''),
      quantityDelta: delta,
      reason: String(reason).trim()
    })
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'The server rejected the stock adjustment.');
  return data;
}


export async function fetchInventoryMovements({ baseUrl, token, limit = 50, productId, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API first.');
  const url = new URL('/api/inventory/movements', baseUrl);
  url.searchParams.set('limit', String(Math.min(200, Math.max(1, Math.trunc(Number(limit) || 50)))));
  if (productId) url.searchParams.set('productId', String(productId));
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: 'Bearer ' + token }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Could not load inventory movement history.');
  return Array.isArray(data.movements) ? data.movements : [];
}
