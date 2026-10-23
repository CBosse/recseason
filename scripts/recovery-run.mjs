import { backupCollections, recoveryDatabase, recoveryWrites } from './backup-format.mjs';
import { sameStoredFields } from './firestore-value-equality.mjs';

const markerPath = '_recovery/checkpoint';
const root = `${recoveryDatabase}/documents/`;
const fieldsFor = (backup, restored, complete) => ({
  schema: { integerValue: '1' }, sha256: { stringValue: backup.sha256 }, readTime: { stringValue: backup.readTime },
  total: { integerValue: String(backup.documents.length) }, restored: { integerValue: String(restored) }, complete: { booleanValue: complete },
});

export function recoveryBatches(backup) {
  const writes = recoveryWrites(backup), batches = [];
  let batch = [], bytes = 0;
  for (const write of writes) {
    const size = Buffer.byteLength(JSON.stringify(write)) + 1;
    if (size > 4 * 1024 * 1024) throw new Error('A recovery document exceeds the batch size limit.');
    if (batch.length === 400 || bytes + size > 4 * 1024 * 1024) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(write); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// io is restricted by the CLI to the isolated emulator recovery database.
export async function restoreBatches(backup, { resume = false, io }) {
  const batches = recoveryBatches(backup);
  let marker = await io.get(markerPath), restored = 0;
  if (marker) {
    if (!resume) throw new Error('Recovery database is not empty. Use --resume with the same backup to verify and continue.');
    restored = Number(marker.fields?.restored?.integerValue);
    const complete = marker.fields?.complete?.booleanValue;
    const boundaries = [0]; for (const batch of batches) boundaries.push(boundaries.at(-1) + batch.length);
    if (!Number.isSafeInteger(restored) || !boundaries.includes(restored) || typeof complete !== 'boolean' ||
        (complete && restored !== backup.documents.length) || !marker.updateTime ||
        !sameStoredFields(marker.fields, fieldsFor(backup, restored, complete))) throw new Error('Recovery checkpoint does not match this backup.');
  } else if (resume) throw new Error('No recovery checkpoint exists. Refusing to adopt existing data.');

  const expected = new Map(backup.documents.slice(0, restored).map(doc => [doc.path, doc.fields]));
  let seen = 0;
  for (const collection of backupCollections) {
    for await (const document of io.list(collection)) {
      const path = document.name?.startsWith(root) ? document.name.slice(root.length) : null;
      if (!expected.has(path) || !sameStoredFields(document.fields || {}, expected.get(path))) {
        throw new Error('Recovery database is not empty or its restored data changed. Refusing to overwrite it.');
      }
      expected.delete(path); seen++;
    }
  }
  if (seen !== restored || expected.size) throw new Error('Previously restored documents are missing.');

  const commit = async (writes, count, complete) => {
    const result = await io.commit([...writes, { update: { name: `${root}${markerPath}`, fields: fieldsFor(backup, count, complete) },
      currentDocument: marker ? { updateTime: marker.updateTime } : { exists: false } }]);
    const updateTime = result.writeResults?.at(-1)?.updateTime;
    if (!updateTime) throw new Error('Recovery commit was not confirmed. Use --resume to inspect its checkpoint.');
    marker = { updateTime, fields: fieldsFor(backup, count, complete) };
    restored = count;
  };
  let offset = 0;
  for (const batch of batches) {
    offset += batch.length;
    if (offset <= restored) continue;
    await commit(batch, offset, false);
  }
  // A checkpoint is not complete until every document has been read back.
  for (const document of backup.documents) {
    const value = await io.get(document.path);
    if (!value || !sameStoredFields(value.fields || {}, document.fields)) throw new Error(`Restored data does not match the backup at ${document.path}.`);
  }
  if (!marker?.fields.complete.booleanValue) await commit([], restored, true);
  return restored;
}
