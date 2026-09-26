import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { backupCollections, createBackup } from './backup-format.mjs';

const auth = createRequire(import.meta.url)('firebase-tools/lib/auth');
const account = auth.getGlobalDefaultAccount();
if (!account) throw new Error('Sign in with Firebase CLI first.');
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
// One readTime across all pages gives a consistent snapshot of app collections.
const readTime = new Date(Date.now() - 5000).toISOString();
const root = 'projects/bosse-testing/databases/recseason/documents';
const documents = [];
for (const collection of backupCollections) {
  let pageToken;
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/${root}/${collection}`);
    url.searchParams.set('readTime', readTime); url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Backup read failed (HTTP ${response.status}); no backup was saved.`);
    const page = await response.json();
    for (const document of page.documents || []) {
      if (!document.name.startsWith(`${root}/`)) throw new Error('Unexpected database in backup response.');
      documents.push({ path: document.name.slice(root.length + 1), fields: document.fields || {} });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}
const backup = createBackup(documents, readTime);
await mkdir('.tools/backups', { recursive: true });
const path = `.tools/backups/recseason-${readTime.replaceAll(':', '-')}.json`;
await writeFile(path, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`Saved ${documents.length} documents at ${readTime} to ${path}. Contains private data; do not commit or share.`);
