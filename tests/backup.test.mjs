import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, validateBackup, recoveryWrites } from '../scripts/backup-format.mjs';
import { notificationJobs, executeNotification } from '../server/notification-jobs.mjs';
const date = '2026-09-26T00:00:00.000Z';
const docs = [{ path: 'games/g', fields: { score: { integerValue: '9007199254740991' }, time: { timestampValue: date }, value: { nullValue: null } } }];
test('backup preserves Firestore typed values and creates only local recovery writes', () => {
  const backup = createBackup(docs, date);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(backup))), backup);
  const [write] = recoveryWrites(backup);
  assert.equal(write.update.name, 'projects/demo-recseason/databases/recovery/documents/games/g');
  assert.deepEqual(write.update.fields, docs[0].fields);
  assert.deepEqual(write.currentDocument, { exists: false });
});
test('backup rejects corruption, unexpected sources, paths, duplicates and oversized restores', () => {
  const backup = createBackup(docs, date);
  assert.throws(() => validateBackup({ ...backup, sha256: 'bad' }), /checksum/);
  assert.throws(() => validateBackup({ ...backup, source: 'another-project' }), /source/);
  for (const path of ['users/../x', 'unknown/id', 'users/']) assert.throws(() => createBackup([{ path, fields: {} }], date));
  assert.throws(() => createBackup([...docs, ...docs], date), /duplicate/);
  assert.throws(() => createBackup(Array.from({ length: 501 }, (_, i) => ({ path: `games/${i}`, fields: {} })), date), /500/);
});

test('prior app-only backup manifests remain readable without silently adding queue coverage', () => {
  const backup = createBackup(docs, date);
  for (const removed of [['ruleProfiles', 'notificationJobs', 'notificationLimits'], ['ruleProfiles', 'notificationJobs', 'notificationLimits', 'scoreEvents']]) {
    const old = { ...backup, collections: backup.collections.filter(name => !removed.includes(name)) };
    assert.equal(validateBackup(old), old);
    assert.equal(old.collections.includes('notificationJobs'), false);
  }
  assert.doesNotThrow(() => validateBackup({ ...backup, collections: backup.collections.filter(name => name !== 'ruleProfiles') }));
});

test('notification backup preserves accepted and uncertain states without creating resendable jobs', async () => {
  const [original] = notificationJobs({ kind: 'rsvp-reminder', eventId: 'recovery', recipients: ['synthetic@example.test'], subject: 'Game', body: 'Test', expiresAt: 86400000 }, 0);
  for (const status of ['accepted', 'needs-review']) {
    const job = { ...original, status, version: 2, attempts: 1, providerReceipt: status === 'accepted' ? 'receipt' : null, outcome: status === 'accepted' ? 'provider-accepted' : 'delivery-unknown' };
    const fields = Object.fromEntries(Object.entries(job).map(([key, value]) => [key, value === null ? { nullValue: null } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]));
    const backup = createBackup([{ path: `notificationJobs/${job.id}`, fields }], date);
    const [write] = recoveryWrites(JSON.parse(JSON.stringify(backup)));
    assert.deepEqual(write.update.fields, fields);
    assert.equal(write.currentDocument.exists, false);
    assert.match(write.update.name, /databases\/recovery\/documents\/notificationJobs\//);
    const restored = Object.fromEntries(Object.entries(write.update.fields).map(([key, value]) => [key, 'nullValue' in value ? null : 'integerValue' in value ? Number(value.integerValue) : value.stringValue]));
    assert.deepEqual(restored, job);
    const outcome = await executeNotification({ store: { get: async () => restored, compareAndSet: async () => assert.fail('Terminal jobs must not change') }, clock: () => 100,
      isEligible: async () => assert.fail('Terminal jobs must not be sent'), transport: { send: async () => assert.fail('Terminal jobs must not be sent') } }, job.id);
    assert.equal(outcome.status, status);
  }
});
