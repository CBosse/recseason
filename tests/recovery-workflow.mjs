import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBackup } from '../scripts/backup-format.mjs';
import { encryptBackup } from '../scripts/backup-encryption.mjs';
import { randomBytes } from 'node:crypto';
import { notificationJobs } from '../server/notification-jobs.mjs';
import { nextRulesProfile } from '../league-rules.mjs';

function typed(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typed(entry)])) } };
}
const rulesProfile = nextRulesProfile(null, { name: 'Recovery division', rules: { innings: 6, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3,
  startingBalls: 1, startingStrikes: 1, foulAtStrikeLimit: 'strikeout', runsPerHalf: 5, unlimitedFinalInning: true,
  mercy: { runs: 10, afterInning: 4 }, timeLimitMinutes: 75, tiePolicy: 'extra-innings', extraInningRunner: 'second' } }, 0);

const queueDocuments = ['pending', 'retry', 'sending', 'accepted', 'suppressed', 'failed', 'needs-review'].map(status => {
  const [base] = notificationJobs({ kind: 'rsvp-reminder', eventId: `recovery-${status}`, recipients: ['synthetic@example.test'], subject: 'Recovery', body: 'Synthetic recovery test.', expiresAt: 86400000, sourceId: 'game', requestedBy: 'organizer' }, 0);
  const job = { ...base, status, version: status === 'pending' ? 0 : 2, attempts: status === 'pending' ? 0 : 1,
    nextAttemptAt: status === 'retry' ? 60000 : 0, leaseToken: status === 'sending' ? 'synthetic-lease' : null,
    leaseUntil: status === 'sending' ? 120000 : null, providerReceipt: status === 'accepted' ? 'synthetic-receipt' : null,
    outcome: status === 'needs-review' ? 'delivery-unknown' : null };
  return { path: `notificationJobs/${job.id}`, fields: Object.fromEntries(Object.entries(job).map(([key, value]) => [key,
    value === null ? { nullValue: null } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }])) };
});

const backup = createBackup([
  { path: 'ruleProfiles/recovery-division', fields: typed(rulesProfile).mapValue.fields },
  ...queueDocuments,
  { path: 'notificationLimits/organizer', fields: { nextRequestAt: { integerValue: '60000' } } },
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
assert.match(run(), /restored and verified 12 documents/);
assert.throws(run, error => error.stderr?.includes('Recovery database is not empty'));
console.log('PASS: encrypted typed-value recovery, wrong-passphrase rejection before writes, and refusal to overwrite an existing recovery database.');
console.log('PASS: all seven notification states, immutable event data, receipts, leases, retry times, versions, and request limits survive isolated recovery unchanged.');
console.log('PASS: league rule profile schema, revision, optional policies and nested mercy rule survive encrypted recovery.');
