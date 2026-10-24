function defaultRandomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function createOrderId(existingOrders = [], { now = () => Date.now(), makeId = defaultRandomId } = {}) {
  const existingIds = new Set((Array.isArray(existingOrders) ? existingOrders : []).map(order => String(order?.id ?? '')));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const timestamp = Number(now()).toString(36).toUpperCase();
    const random = String(makeId()).replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase();
    if (!random) continue;
    const orderId = `MP-${timestamp}-${random}`;
    if (!existingIds.has(orderId)) return orderId;
  }
  throw new Error('Could not generate a unique order number. Try checkout again.');
}
