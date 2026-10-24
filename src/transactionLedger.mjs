const IDEMPOTENCY_KEY = 'malik-transactionIdempotency';

function readKeys(storage) {
  try {
    const value = JSON.parse(storage.getItem(IDEMPOTENCY_KEY) || '{}');
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
