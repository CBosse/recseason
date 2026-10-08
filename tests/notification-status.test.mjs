import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationStates, summarizeNotifications, validateNotificationSummary } from '../notification-status.mjs';

test('notification summary counts all states without leaking private data', () => {
  const summary = summarizeNotifications(notificationStates.map(status => ({ status, recipient: 'private@example.test', body: 'private', providerReceipt: 'receipt' })));
  assert.equal(summary.total, 7);
  assert.ok(notificationStates.every(status => summary.counts[status] === 1));
  assert.ok(!JSON.stringify(summary).includes('private'));
  assert.deepEqual(validateNotificationSummary({ ...summary, recipient: 'hidden' }), summary);
});
test('empty notification history is distinct from failed or truncated history', () => {
  assert.equal(summarizeNotifications([]).total, 0);
  assert.throws(() => summarizeNotifications(Array(1001).fill({ status: 'pending' })));
  assert.throws(() => summarizeNotifications([{ status: 'unknown' }]));
});
test('notification summary rejects inconsistent or malformed counts', () => {
  const summary = summarizeNotifications([{ status: 'accepted' }]);
  for (const value of [null, { ...summary, total: 2 }, { ...summary, total: -1 }, { total: 0, counts: {} }, { ...summary, counts: { ...summary.counts, pending: -1 } }]) assert.throws(() => validateNotificationSummary(value));
});
