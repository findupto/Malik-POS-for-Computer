export function calculateTimeCharge({ startedAt, endedAt = new Date().toISOString(), hourlyRate = 0, graceMinutes = 60 }) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new RangeError('A valid start time and an end time at or after it are required.');
  }
  const elapsedMinutes = Math.max(0, Math.ceil((end - start) / 60000));
  const grace = Math.max(0, Number(graceMinutes) || 0);
  const billableMinutes = Math.max(0, elapsedMinutes - grace);
  const billedHours = Math.ceil(billableMinutes / 60);
  const rate = Math.max(0, Number(hourlyRate) || 0);
  return { elapsedMinutes, graceMinutes: grace, billableMinutes, billedHours, hourlyRate: rate, amount: billedHours * rate };
}

export function formatDuration(milliseconds) {
  const minutes = Math.max(0, Math.floor(Number(milliseconds) / 60000));
  return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}
