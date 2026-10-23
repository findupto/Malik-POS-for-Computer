export function calculateWeightedAverageCost(currentQty, currentUnitCost, receivedQty, receivedTotalCost) {
  const stock = Number(currentQty);
  const cost = Number(currentUnitCost);
  const received = Number(receivedQty);
  const total = Number(receivedTotalCost);
  if (![stock, cost, received, total].every(Number.isFinite) || stock < 0 || cost < 0 || received <= 0 || total < 0) {
    throw new RangeError('Stock quantities and costs must be finite and non-negative, with received quantity above zero.');
  }
  const combinedQty = stock + received;
  const combinedCost = stock * cost + total;
  const result = combinedCost / combinedQty;
  if (!Number.isFinite(result)) throw new RangeError('Weighted average cost exceeds the supported numeric range.');
  return result;
}

export function purchaseBalance(total, paid) {
  const invoiceTotal = Number(total);
  const amountPaid = Number(paid);
  if (![invoiceTotal, amountPaid].every(Number.isFinite) || invoiceTotal < 0 || amountPaid < 0) {
    throw new RangeError('Invoice total and paid amount must be finite and non-negative.');
  }
  return Math.max(0, invoiceTotal - amountPaid);
}

function parseDateOnly(value) {
  const key = String(value || '').slice(0, 10);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(key)) return null;
  const date = new Date(key + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) return null;
  return date;
}

export function daysPastDue(dueDate, todayDate, balance) {
  if (!(Number(balance) > 0) || !dueDate || !todayDate) return 0;
  const due = parseDateOnly(dueDate);
  const today = parseDateOnly(todayDate);
  if (!due || !today) return 0;
  return due < today ? Math.floor((today.getTime() - due.getTime()) / 86400000) : 0;
}
