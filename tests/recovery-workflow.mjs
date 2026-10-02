import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBackup } from '../scripts/backup-format.mjs';
import { encryptBackup } from '../scripts/backup-encryption.mjs';
import { randomBytes } from 'node:crypto';

const backup = createBackup([
  { path: 'scoreEvents/game_1', fields: { revision: { integerValue: '1' }, gameId: { stringValue: 'game' }, recordedAt: { timestampValue: '2026-09-26T00:00:00Z' } } },
  { path: 'teams/demo', fields: { name: { stringValue: 'Recovery Test' }, enabled: { booleanValue: true } } },
  { path: 'attendance/game_player', fields: { revision: { integerValue: '2' }, checkedAt: { timestampValue: '2026-09-26T00:00:00Z' },
    optional: { nullValue: null }, nested: { mapValue: { fields: { values: { arrayValue: { values: [{ stringValue: 'a' }] } } } } } } },
], '2026-09-26T00:00:00Z');
await mkdir('.tools/backups', { recursive: true });
const path = '.tools/backups/recovery-test.encrypted.json';
const passphrase = randomBytes(32).toString('base64');
await writeFile(path, JSON.stringify(await encryptBackup(backup, passphrase)));
const run = (secret = passphrase) => execFileSync(process.execPath, ['scripts/restore-recovery.mjs', path], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, RECSEASON_BACKUP_PASSPHRASE: secret } });
assert.throws(() => run('incorrect-test-passphrase'), error => error.stderr?.includes('authentication failed'));
assert.match(run(), /restored and verified 3 documents/);
assert.throws(run, error => error.stderr?.includes('Recovery database is not empty'));
console.log('PASS: encrypted typed-value recovery, wrong-passphrase rejection before writes, and refusal to overwrite an existing recovery database.');
