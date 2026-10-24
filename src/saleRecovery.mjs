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
