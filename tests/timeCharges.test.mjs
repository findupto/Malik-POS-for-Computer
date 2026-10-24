import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTimeCharge, formatDuration } from '../src/timeCharges.mjs';

test('free period produces no charge', () => {
  assert.deepEqual(calculateTimeCharge({ startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T10:45:00Z', hourlyRate: 200, graceMinutes: 60 }), {
    elapsedMinutes: 45, graceMinutes: 60, billableMinutes: 0, billedHours: 0, hourlyRate: 200, amount: 0
  });
});
test('partial billable hour rounds up after grace period', () => {
  const result = calculateTimeCharge({ startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T11:31:00Z', hourlyRate: 200, graceMinutes: 30 });
  assert.equal(result.elapsedMinutes, 91);
  assert.equal(result.billableMinutes, 61);
  assert.equal(result.billedHours, 2);
  assert.equal(result.amount, 400);
});
test('zero rate disables monetary charges', () => {
  assert.equal(calculateTimeCharge({ startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T12:00:00Z', hourlyRate: 0, graceMinutes: 0 }).amount, 0);
});
test('rejects invalid or reversed timestamps', () => {
  assert.throws(() => calculateTimeCharge({ startedAt: 'not-a-date', endedAt: '2026-01-01T12:00:00Z' }), RangeError);
  assert.throws(() => calculateTimeCharge({ startedAt: '2026-01-01T12:00:00Z', endedAt: '2026-01-01T10:00:00Z' }), RangeError);
});
test('formats elapsed duration in hours and minutes', () => {
  assert.equal(formatDuration(90 * 60000), '1h 30m');
});
