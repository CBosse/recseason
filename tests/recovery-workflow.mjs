import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBackup } from '../scripts/backup-format.mjs';

const backup = createBackup([
  { path: 'teams/demo', fields: { name: { stringValue: 'Recovery Test' }, enabled: { booleanValue: true } } },
  { path: 'attendance/game_player', fields: { revision: { integerValue: '2' }, checkedAt: { timestampValue: '2026-09-26T00:00:00Z' },
    optional: { nullValue: null }, nested: { mapValue: { fields: { values: { arrayValue: { values: [{ stringValue: 'a' }] } } } } } } },
], '2026-09-26T00:00:00Z');
await mkdir('.tools/backups', { recursive: true });
const path = '.tools/backups/recovery-test.json';
await writeFile(path, JSON.stringify(backup));
const run = () => execFileSync(process.execPath, ['scripts/restore-recovery.mjs', path], { encoding: 'utf8', stdio: 'pipe' });
assert.match(run(), /restored and verified 2 documents/);
assert.throws(run, error => error.stderr?.includes('Recovery database is not empty'));
console.log('PASS: typed-value recovery and refusal to overwrite an existing recovery database.');
