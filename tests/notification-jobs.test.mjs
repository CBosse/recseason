import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationJobs, enqueueNotifications, executeNotification } from '../server/notification-jobs.mjs';

const notice = { kind: 'rsvp-reminder', eventId: 'game-1:revision-4', recipients: ['first@example.test'], subject: 'Game tomorrow', body: 'Confirm in RecSeason.', expiresAt: 86400000 };
function memoryStore() {
  const records = new Map();
  return {
    async create(job) { if (records.has(job.id)) return false; records.set(job.id, structuredClone(job)); return true; },
    async get(id) { return structuredClone(records.get(id)); },
    async compareAndSet(id, version, next) {
      if (records.get(id)?.version !== version) return false;
      records.set(id, structuredClone(next)); return true;
    },
  };
}
async function setup(options = {}) {
  const store = memoryStore();
  const [job] = notificationJobs(notice, 0);
  await enqueueNotifications(store, [job]);
  let now = 0, sends = [];
  const worker = { store, clock: () => now, isEligible: async () => true,
    transport: { send: async message => { sends.push(message); return { accepted: true, receipt: 'provider-1' }; } }, ...options };
  return { store, job, worker, sends, advance: value => { now = value; } };
}

test('notice identity deduplicates normalized recipients and isolates messages', async () => {
  const jobs = notificationJobs({ ...notice, recipients: ['First@Example.Test ', 'first@example.test', 'second@example.test'] }, 0);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].id, notificationJobs(notice, 100)[0].id);
  assert.notEqual(jobs[0].id, notificationJobs({ ...notice, eventId: 'game-1:revision-5' }, 0)[0].id);
  const store = memoryStore();
  assert.deepEqual(await enqueueNotifications(store, jobs), { created: 2, existing: 0 });
  assert.deepEqual(await enqueueNotifications(store, jobs.map(job => ({ ...job, body: 'Do not overwrite' }))), { created: 0, existing: 2 });
  assert.equal((await store.get(jobs[0].id)).body, notice.body);
  const sent = [];
  for (const job of jobs) await executeNotification({ store, clock: () => 0, isEligible: async () => true, transport: { send: async data => { sent.push(data); return { accepted: true, receipt: 'ok' }; } } }, job.id);
  assert.deepEqual(sent.map(message => message.to), ['first@example.test', 'second@example.test']);
  assert.ok(sent.every(message => !('cc' in message) && !('bcc' in message) && !('recipients' in message)));
});

test('invalid addresses, header injection and unbounded notices are rejected', () => {
  for (const patch of [{ kind: 'other' }, { eventId: '' }, { recipients: [] }, { recipients: ['x@example.test\r\nBcc: other@example.test'] }, { recipients: Array(201).fill('x@example.test') }, { subject: 'Hello\nBcc: x' }, { body: '' }, { expiresAt: 0 }, { expiresAt: 86400001 }]) assert.throws(() => notificationJobs({ ...notice, ...patch }, 0));
});

test('concurrent workers claim a recipient once and accepted jobs do not resend', async () => {
  const x = await setup();
  const results = await Promise.all([executeNotification(x.worker, x.job.id), executeNotification(x.worker, x.job.id)]);
  assert.equal(results.filter(result => result.status === 'accepted').length, 1);
  assert.equal(x.sends.length, 1);
  assert.equal((await executeNotification(x.worker, x.job.id)).status, 'accepted');
  assert.equal(x.sends.length, 1);
});

test('opt-outs and stale events are rechecked immediately before delivery', async () => {
  const x = await setup({ isEligible: async () => false });
  assert.equal((await executeNotification(x.worker, x.job.id)).status, 'suppressed');
  assert.equal(x.sends.length, 0);
  const expired = await setup(); expired.advance(86400000);
  assert.equal((await executeNotification(expired.worker, expired.job.id)).status, 'failed');
  assert.equal(expired.sends.length, 0);
});

test('confirmed transient rejections back off and stop after five attempts', async () => {
  const x = await setup({ transport: { send: async () => ({ accepted: false, retryable: true }) } });
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await executeNotification(x.worker, x.job.id);
    assert.equal(result.status, attempt === 5 ? 'failed' : 'retry');
    const state = await x.store.get(x.job.id);
    assert.equal(state.attempts, attempt);
    if (attempt < 5) {
      assert.equal((await executeNotification(x.worker, x.job.id)).status, 'deferred');
      x.advance(state.nextAttemptAt);
    }
  }
});

test('ambiguous provider outcomes never automatically resend', async () => {
  for (const send of [async () => { throw new Error('Sensitive provider text'); }, async () => ({}), async () => ({ accepted: true })]) {
    const x = await setup({ transport: { send } });
    assert.equal((await executeNotification(x.worker, x.job.id)).status, 'needs-review');
    assert.equal((await executeNotification(x.worker, x.job.id)).status, 'needs-review');
    assert.ok(!JSON.stringify(await x.store.get(x.job.id)).includes('Sensitive'));
  }
});

test('expired leases fence late workers and require review instead of retry', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const x = await setup({ transport: { send: () => { started(); return new Promise(resolve => { finish = resolve; }); } } });
  const first = executeNotification(x.worker, x.job.id);
  await ready;
  assert.equal((await executeNotification(x.worker, x.job.id)).status, 'busy');
  x.advance(120001);
  assert.equal((await executeNotification(x.worker, x.job.id)).status, 'needs-review');
  finish({ accepted: true, receipt: 'late' });
  assert.equal((await first).status, 'superseded');
  assert.equal((await x.store.get(x.job.id)).status, 'needs-review');
});

test('eligibility failures retry without sending, and slow eligibility cannot outlive its lease', async () => {
  const x = await setup({ isEligible: async () => { throw new Error('Network'); } });
  assert.equal((await executeNotification(x.worker, x.job.id)).status, 'retry');
  assert.equal(x.sends.length, 0);
  const slow = await setup();
  slow.worker.isEligible = async () => { slow.advance(120001); return true; };
  assert.equal((await executeNotification(slow.worker, slow.job.id)).status, 'failed');
  assert.equal(slow.sends.length, 0);
});
