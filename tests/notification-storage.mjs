import assert from 'node:assert/strict';
import { openNotificationStore, notificationStore } from '../server/notification-store.mjs';
import { notificationJobs, enqueueNotifications, executeNotification } from '../server/notification-jobs.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('This test requires the local Firestore emulator.');
assert.throws(() => openNotificationStore('bosse-testing'));
assert.throws(() => notificationStore({ databaseId: '(default)' }));
const first = openNotificationStore('demo-recseason');
const second = openNotificationStore('demo-recseason');
try {
  const [job] = notificationJobs({ kind: 'cancellation', eventId: `storage-test-${Date.now()}`, recipients: ['controlled@example.test'], subject: 'Cancelled', body: 'Synthetic test only.', expiresAt: 86400000 }, 0);
  const results = await Promise.all([enqueueNotifications(first.store, [job]), enqueueNotifications(second.store, [job])]);
  assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.existing, 0), 1);
  let sends = 0;
  const worker = store => ({ store, clock: () => 0, isEligible: async () => true, transport: { send: async () => { sends++; return { accepted: true, receipt: 'test-receipt' }; } } });
  const outcomes = await Promise.all([executeNotification(worker(first.store), job.id), executeNotification(worker(second.store), job.id)]);
  assert.equal(sends, 1);
  assert.ok(outcomes.some(result => result.status === 'accepted'));
  await first.db.terminate();
  const saved = await second.store.get(job.id);
  assert.equal(saved.status, 'accepted'); assert.equal(saved.version, 2);
  assert.equal(saved.providerReceipt, 'test-receipt');
  assert.equal((await executeNotification(worker(second.store), job.id)).status, 'accepted');
  assert.equal(sends, 1);
  assert.equal(await second.store.compareAndSet(job.id, 0, { ...job, version: 1, status: 'sending' }), false);
  await assert.rejects(second.store.compareAndSet(job.id, 2, { ...saved, version: 3, recipient: 'different@example.test' }), /immutable/);
  await assert.rejects(second.store.get('../users'), /Invalid/);
  console.log('PASS: durable named-database notification jobs, concurrent enqueue/claim, cross-client persistence, stale-write fencing, and immutable recipients. No email was sent.');
} finally {
  await second.db.terminate();
  await first.db.terminate();
}
