import test from 'node:test';
import assert from 'node:assert/strict';
import { drainNotifications } from '../server/notification-drain.mjs';
import { notificationJobs } from '../server/notification-jobs.mjs';

function setup() {
  let now = 0, sends = 0;
  const records = new Map(notificationJobs({ kind: 'rsvp-reminder', eventId: 'drain', recipients: ['one@example.test', 'two@example.test'], subject: 'Game', body: 'Confirm', expiresAt: 86400000 }, 0).map(job => [job.id, job]));
  const store = {
    async due(at, limit) { return [...records.values()].filter(job => ['pending', 'retry'].includes(job.status) && job.nextAttemptAt <= at).slice(0, limit).map(job => job.id); },
    async get(id) { return structuredClone(records.get(id)); },
    async compareAndSet(id, version, next) { if (records.get(id).version !== version) return false; records.set(id, next); return true; },
  };
  const worker = { store, clock: () => now, isEligible: async () => true, transport: { send: async () => { sends++; return { accepted: true, receipt: 'synthetic' }; } } };
  return { worker, records, sends: () => sends, advance: value => { now = value; } };
}

test('batch bounds and concurrent drains preserve single-send claims', async () => {
  const x = setup();
  await Promise.all([drainNotifications(x.worker), drainNotifications(x.worker)]);
  assert.equal(x.sends(), 2);
  assert.deepEqual(await drainNotifications(x.worker), { selected: 0, processed: 0, remaining: 0, outcomes: {} });
  const limited = setup();
  assert.equal((await drainNotifications(limited.worker, { limit: 1 })).processed, 1);
  assert.equal(limited.sends(), 1);
});

test('batch deadline settles current work and leaves remaining work queued', async () => {
  const x = setup();
  x.worker.transport.send = async () => { x.advance(100); return { accepted: true, receipt: 'synthetic' }; };
  assert.deepEqual(await drainNotifications(x.worker, { budgetMs: 100 }), { selected: 2, processed: 1, remaining: 1, outcomes: { accepted: 1 } });
  assert.equal([...x.records.values()].filter(job => job.status === 'pending').length, 1);
});

test('retry is not polled again before its due time', async () => {
  const x = setup();
  x.worker.transport.send = async () => ({ accepted: false, retryable: true });
  assert.deepEqual((await drainNotifications(x.worker)).outcomes, { retry: 2 });
  assert.equal((await drainNotifications(x.worker)).selected, 0);
  x.advance(60000);
  assert.equal((await drainNotifications(x.worker)).processed, 2);
});

test('invalid bounds, oversized selection, and persistence failures fail closed', async () => {
  const x = setup();
  for (const options of [{ limit: 0 }, { limit: 101 }, { budgetMs: 0 }, { budgetMs: 300001 }]) await assert.rejects(drainNotifications(x.worker, options));
  x.worker.store.due = async () => ['same', 'same'];
  await assert.rejects(drainNotifications(x.worker), /selection/);
  x.worker.store.due = async () => [...x.records.keys()];
  x.worker.store.compareAndSet = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(drainNotifications(x.worker), /Storage/);
  assert.equal(x.sends(), 0);
});
