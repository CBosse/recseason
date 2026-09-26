import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, validateBackup, recoveryWrites } from '../scripts/backup-format.mjs';
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
