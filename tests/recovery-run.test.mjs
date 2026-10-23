import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, recoveryDatabase } from '../scripts/backup-format.mjs';
import { restoreBatches, recoveryBatches } from '../scripts/recovery-run.mjs';

const root = `${recoveryDatabase}/documents/`;
const backupFor = (count = 801) => createBackup(Array.from({ length: count }, (_, index) => ({
  path: `games/game-${index}`, fields: { score: { integerValue: String(index) } },
})), '2026-10-23T00:00:00Z');
function store() {
  const docs = new Map(); let calls = 0, lostResponse = false;
  const io = {
    get: async path => structuredClone(docs.get(path) ?? null),
    async *list(collection) { for (const [path, doc] of docs) if (path.startsWith(`${collection}/`)) yield structuredClone(doc); },
    async commit(writes) {
      assert.ok(writes.length <= 401);
      for (const write of writes) {
        const existing = docs.get(write.update.name.slice(root.length));
        if (write.currentDocument.exists === false) assert.equal(existing, undefined);
        else assert.equal(existing.updateTime, write.currentDocument.updateTime);
      }
      const updateTime = String(++calls);
      for (const write of writes) docs.set(write.update.name.slice(root.length), { ...structuredClone(write.update), updateTime });
      if (lostResponse) { lostResponse = false; throw new Error('Lost response after commit'); }
      return { writeResults: writes.map(() => ({ updateTime })) };
    },
  };
  return { docs, io, get calls() { return calls; }, loseNextResponse() { lostResponse = true; } };
}

test('recovery batches more than 500 documents with create-only writes and a verified completion marker', async () => {
  const backup = backupFor(), s = store();
  assert.deepEqual(recoveryBatches(backup).map(batch => batch.length), [400, 400, 1]);
  assert.equal(await restoreBatches(backup, { io: s.io }), 801); assert.equal(s.calls, 4);
  assert.equal(s.docs.get('_recovery/checkpoint').fields.complete.booleanValue, true);
  await assert.rejects(restoreBatches(backup, { io: s.io }), /not empty/);
  assert.equal(await restoreBatches(backup, { io: s.io, resume: true }), 801); assert.equal(s.calls, 4);
});

test('a lost commit response resumes only after verifying its atomically written prefix', async () => {
  const backup = backupFor(), s = store(); s.loseNextResponse();
  await assert.rejects(restoreBatches(backup, { io: s.io }), /Lost response/);
  assert.equal(s.docs.size, 401); assert.equal(s.docs.get('_recovery/checkpoint').fields.complete.booleanValue, false);
  assert.equal(await restoreBatches(backup, { io: s.io, resume: true }), 801); assert.equal(s.calls, 4);
});

test('resume refuses wrong backup, changed or missing data, extra documents, and invalid checkpoints without writes', async () => {
  const backup = backupFor();
  for (const change of [s => s.docs.get('games/game-0').fields.score.integerValue = '9',
    s => s.docs.delete('games/game-0'), s => s.docs.set('games/extra', { name: `${root}games/extra`, fields: {} }),
    s => s.docs.get('_recovery/checkpoint').fields.sha256.stringValue = 'different',
    s => s.docs.get('_recovery/checkpoint').fields.restored.integerValue = '399',
    s => s.docs.get('_recovery/checkpoint').fields.complete.booleanValue = true]) {
    const s = store(); s.loseNextResponse(); await assert.rejects(restoreBatches(backup, { io: s.io })); change(s);
    await assert.rejects(restoreBatches(backup, { io: s.io, resume: true })); assert.equal(s.calls, 1);
  }
  const s = store(); await assert.rejects(restoreBatches(backup, { io: s.io, resume: true }), /No recovery checkpoint/);
  s.docs.set('games/other', { name: `${root}games/other`, fields: {} });
  await assert.rejects(restoreBatches(backup, { io: s.io }), /not empty/); assert.equal(s.calls, 0);
});

test('batch byte limits and empty recovery remain bounded', async () => {
  const docs = Array.from({ length: 6 }, (_, index) => ({ path: `games/${index}`, fields: { text: { stringValue: 'x'.repeat(1024 * 1024) } } }));
  assert.deepEqual(recoveryBatches(createBackup(docs, '2026-10-23T00:00:00Z')).map(batch => batch.length), [3, 3]);
  assert.throws(() => recoveryBatches(createBackup([{ path: 'games/large', fields: { text: { stringValue: 'x'.repeat(4 * 1024 * 1024) } } }], '2026-10-23T00:00:00Z')), /batch size/);
  const s = store(); assert.equal(await restoreBatches(backupFor(0), { io: s.io }), 0); assert.equal(s.calls, 1);
});
