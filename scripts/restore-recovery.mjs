import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { backupCollections, recoveryDatabase, recoveryWrites } from './backup-format.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Recovery is restricted to the local emulator at 127.0.0.1:8180.');
if (!process.argv[2]) throw new Error('Provide a backup JSON file path.');
const backup = JSON.parse(await readFile(process.argv[2], 'utf8'));
const writes = recoveryWrites(backup);
const root = `http://127.0.0.1:8180/v1/${recoveryDatabase}/documents`;
async function request(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Recovery request failed (HTTP ${response.status}). No production endpoint is used.`);
  return response.json();
}
for (const collection of backupCollections) {
  const page = await request(`${root}/${collection}?pageSize=1`);
  if (page.documents?.length) throw new Error('Recovery database is not empty. Restart the disposable emulator before restoring.');
}
// One atomic create-only commit cannot overwrite an existing document.
if (writes.length) await request(`${root}:commit`, { writes });
for (const document of backup.documents) {
  const urlPath = document.path.split('/').map(encodeURIComponent).join('/');
  const restored = await request(`${root}/${urlPath}`);
  if (!isDeepStrictEqual(restored.fields || {}, document.fields)) throw new Error('Restored data does not match the backup.');
}
console.log(`PASS: restored and verified ${writes.length} documents in the local recovery database. Production unchanged.`);
