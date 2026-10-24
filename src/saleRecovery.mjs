export function applySaleToCustomerAccounts(customers, { orderId, customerName, payment, amount }) {
  if (!Array.isArray(customers) || !orderId || !customerName || customerName === 'Walk-in Customer') {
    return Array.isArray(customers) ? customers : [];
  }
  const saleId = String(orderId);
  const total = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return customers.map(customer => {
    if (customer.name !== customerName) return customer;
    const processed = Array.isArray(customer.processedSaleOrderIds) ? customer.processedSaleOrderIds.map(String) : [];
    if (processed.includes(saleId)) return customer;
    const isCustomerDue = payment === 'Customer Due';
    return {
      ...customer,
      spent: Number(customer.spent || 0) + (isCustomerDue ? 0 : total),
      dueBalance: Number(customer.dueBalance || 0) + (isCustomerDue ? total : 0),
      visits: Number(customer.visits || 0) + 1,
      processedSaleOrderIds: [...processed, saleId]
    };
  });
}

export function readStoredArray(storage, key, fallback = []) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new Error('Local storage is unavailable; sale recovery was not cleared.');
  }
  const raw = storage.getItem(key);
  if (raw === null) return Array.isArray(fallback) ? fallback : [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Stored ${key} data is invalid JSON; sale recovery was not cleared.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Stored ${key} data must be an array; sale recovery was not cleared.`);
  }
  return parsed;
}
