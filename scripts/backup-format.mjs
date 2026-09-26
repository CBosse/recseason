import { createHash } from 'node:crypto';

export const backupCollections = ['users', 'teams', 'players', 'teamRoster', 'fields', 'games', 'attendance', 'rsvps', 'config', 'umpires', 'invitations'];
export const recoveryDatabase = 'projects/demo-recseason/databases/recovery';
const digest = documents => createHash('sha256').update(JSON.stringify(documents)).digest('hex');

export function createBackup(documents, readTime) {
  const backup = { format: 'recseason-firestore-v1', source: 'projects/bosse-testing/databases/recseason', readTime,
    collections: backupCollections, documents, sha256: digest(documents) };
  validateBackup(backup);
  return backup;
}

export function validateBackup(backup) {
  if (backup?.format !== 'recseason-firestore-v1' || backup.source !== 'projects/bosse-testing/databases/recseason' ||
      !Number.isFinite(Date.parse(backup.readTime)) || JSON.stringify(backup.collections) !== JSON.stringify(backupCollections) ||
      !Array.isArray(backup.documents) || backup.documents.length > 500) throw new Error('Unsupported backup format, source, collections, or size (maximum 500 documents).');
  if (backup.sha256 !== digest(backup.documents)) throw new Error('Backup checksum mismatch.');
  const paths = new Set();
  for (const document of backup.documents) {
    const parts = document.path?.split('/') || [];
    if (parts.length !== 2 || !backupCollections.includes(parts[0]) || !parts[1] || ['.', '..'].includes(parts[1]) ||
        paths.has(document.path) || !document.fields || typeof document.fields !== 'object' || Array.isArray(document.fields)) throw new Error('Invalid or duplicate document path/fields.');
    paths.add(document.path);
  }
  return backup;
}

export function recoveryWrites(backup) {
  validateBackup(backup);
  return backup.documents.map(document => ({ update: { name: `${recoveryDatabase}/documents/${document.path}`, fields: document.fields }, currentDocument: { exists: false } }));
}
