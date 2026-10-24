const IDEMPOTENCY_KEY = 'malik-transactionIdempotency';

function readKeys(storage, key = IDEMPOTENCY_KEY) {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function idempotencyKeyFor(storage, orderId, makeId) {
  const keys = readKeys(storage);
  if (typeof keys[orderId] === 'string' && keys[orderId]) return keys[orderId];
  const key = makeId();
  keys[orderId] = key;
  storage.setItem(IDEMPOTENCY_KEY, JSON.stringify(keys));
  return key;
}

export async function recordSaleTransaction({ baseUrl, token, order, payment, storage = globalThis.localStorage, fetchImpl = globalThis.fetch, makeId = () => globalThis.crypto.randomUUID() }) {
  if (!baseUrl || !token) throw new Error('Connect this register to the Malik POS API before recording a shared sale.');
  if (!order || !order.id || !Array.isArray(order.items) || !order.items.length) throw new Error('A sale with at least one item is required.');
  if (!storage || typeof fetchImpl !== 'function') throw new Error('Shared sale recording is unavailable in this environment.');
  const idempotencyKey = idempotencyKeyFor(storage, String(order.id), makeId);
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
  const response = await fetchImpl(new URL('/api/transactions', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(payload)
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || 'The server did not record this sale. The order remains pending; retry payment to safely retry the same sale.');
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
