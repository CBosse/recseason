import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createBackup } from '../scripts/backup-format.mjs';
import { encryptBackup } from '../scripts/backup-encryption.mjs';
import { randomBytes } from 'node:crypto';
import { notificationJobs } from '../server/notification-jobs.mjs';
import { nextRulesProfile } from '../league-rules.mjs';
import { scheduleChangeUpdate, scheduleEvent } from '../schedule-history.mjs';
import { Firestore } from '@google-cloud/firestore';
import { automaticScoreEntry, automaticCorrectionEntry, replayAutomaticHistory } from '../automatic-scoring.mjs';

function typed(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(typed) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typed(entry)])) } };
}
const rulesProfile = nextRulesProfile(null, { name: 'Recovery division', rules: { innings: 6, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3,
  startingBalls: 1, startingStrikes: 1, foulAtStrikeLimit: 'strikeout', runsPerHalf: 5, unlimitedFinalInning: true,
  mercy: { runs: 10, afterInning: 4 }, timeLimitMinutes: 75, tiePolicy: 'extra-innings', extraInningRunner: 'second' } }, 0);

const scoringId = 'recovery-scoring';
let scoringGame = { status: 'scheduled', homeTeamId: 'home', awayTeamId: 'away', fieldId: 'main', rulesSnapshot: {
  ...rulesProfile, profileId: 'recovery-division', rules: { ...rulesProfile.rules, innings: 1, ballsForWalk: 1, strikesForOut: 1,
    outsPerHalf: 1, startingBalls: 0, startingStrikes: 0, runsPerHalf: null, unlimitedFinalInning: false,
    mercy: null, timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none' },
} };
const scoringEvents = [];
const pitch = value => ({ schemaVersion: 1, type: 'play', elapsedMs: 1000, runAward: 'ordinary', play: { schemaVersion: 1, type: 'pitch', pitch: value } });
const homeRun = { schemaVersion: 1, type: 'play', elapsedMs: 1000, runAward: 'home-run', play: { schemaVersion: 1, type: 'runners', includesBatter: true,
  outcomes: [{ runner: 'first', destination: 'home' }, { runner: 'batter', destination: 'home' }] } };
const replacement = { ...homeRun, runAward: 'ordinary', play: { ...homeRun.play, outcomes: [{ runner: 'first', destination: 'home' }, { runner: 'batter', destination: 'second' }] } };
for (const action of [pitch('ball'), homeRun, pitch('strike'), pitch('strike'),
  { schemaVersion: 1, type: 'correction', targetRevision: 2, replacement, reason: 'Correct runner outcome' },
  { schemaVersion: 1, type: 'correction', targetRevision: 4, replacement: null, reason: 'Void mistaken final strike' },
  { schemaVersion: 1, type: 'correction', targetRevision: 4, replacement: pitch('strike'), reason: 'Restore original final strike' }]) {
  const create = action.type === 'correction' ? automaticCorrectionEntry : automaticScoreEntry;
  const { patch, entry } = create({ gameId: scoringId, game: scoringGame, entries: scoringEvents, action,
    uid: 'organizer', expectedRevision: scoringEvents.length, engineVersion: 1 });
  scoringGame = { ...scoringGame, ...patch }; scoringEvents.push(entry);
}
const scoringDocuments = [{ path: `games/${scoringId}`, fields: typed(scoringGame).mapValue.fields },
  ...scoringEvents.map(event => ({ path: `scoreEvents/${scoringId}_${event.revision}`,
    fields: { ...typed(event).mapValue.fields, recordedAt: { timestampValue: '2026-10-23T00:00:00Z' } } }))];

const queueDocuments = ['pending', 'retry', 'sending', 'accepted', 'suppressed', 'failed', 'needs-review'].map(status => {
  const [base] = notificationJobs({ kind: 'rsvp-reminder', eventId: `recovery-${status}`, recipients: ['synthetic@example.test'], subject: 'Recovery', body: 'Synthetic recovery test.', expiresAt: 86400000, sourceId: 'game', requestedBy: 'organizer' }, 0);
  const job = { ...base, status, version: status === 'pending' ? 0 : 2, attempts: status === 'pending' ? 0 : 1,
    nextAttemptAt: status === 'retry' ? 60000 : 0, leaseToken: status === 'sending' ? 'synthetic-lease' : null,
    leaseUntil: status === 'sending' ? 120000 : null, providerReceipt: status === 'accepted' ? 'synthetic-receipt' : null,
    outcome: status === 'needs-review' ? 'delivery-unknown' : null };
  return { path: `notificationJobs/${job.id}`, fields: Object.fromEntries(Object.entries(job).map(([key, value]) => [key,
    value === null ? { nullValue: null } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }])) };
});

const previousGame = { status: 'scheduled', date: '2026-09-26', time: '18:00', durationMinutes: 90, fieldId: 'main', fieldName: 'Main', homeTeamId: 'home', awayTeamId: 'away', homeName: 'Home', awayName: 'Away', umpireId: 'former-official' };
const movedGame = { ...previousGame, time: '19:00', umpireId: null };
const event = scheduleEvent('game', scheduleChangeUpdate(previousGame, movedGame, 'organizer', '2026-09-26T00:00:00Z').lastScheduleChange);
const eventFields = typed(event.data).mapValue.fields;
eventFields.change.mapValue.fields.changedAt = { timestampValue: '2026-09-26T00:00:00Z' };
const backup = createBackup([
  ...scoringDocuments,
  { path: `scheduleEvents/${event.id}`, fields: eventFields },
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
assert.match(run(), new RegExp(`restored and verified ${backup.documents.length} documents`));
assert.throws(run, error => error.stderr?.includes('Recovery database is not empty'));
const recovery = new Firestore({ projectId: 'demo-recseason', databaseId: 'recovery' });
try {
  const restoredGame = (await recovery.doc(`games/${scoringId}`).get()).data();
  const restoredEvents = (await recovery.collection('scoreEvents').where('gameId', '==', scoringId).get()).docs.map(doc => doc.data());
  assert.deepEqual(restoredGame, scoringGame);
  assert.equal(restoredEvents.length, 7);
  assert.ok(restoredEvents.every(event => event.recordedAt.toMillis() === Date.parse('2026-10-23T00:00:00Z')));
  const frames = replayAutomaticHistory(scoringId, restoredGame, restoredEvents);
  assert.deepEqual(frames, replayAutomaticHistory(scoringId, scoringGame, scoringEvents));
  assert.equal(frames[4].awayScore, 2); assert.equal(frames[5].awayScore, 1);
  assert.equal(frames[6].status, 'live'); assert.equal(frames[7].status, 'completed');
  // Restored histories must support new audited corrections, not only display.
  const continued = automaticCorrectionEntry({ gameId: scoringId, game: restoredGame, entries: restoredEvents, uid: 'organizer',
    expectedRevision: 7, engineVersion: 1, action: { schemaVersion: 1, type: 'correction', targetRevision: 4, replacement: null, reason: 'Post-recovery correction' } });
  assert.equal(continued.patch.status, 'live'); assert.equal(continued.patch.scoreRevision, 8);
  assert.deepEqual(replayAutomaticHistory(scoringId, { ...restoredGame, ...continued.patch }, [...restoredEvents, continued.entry]).at(-1), continued.patch.automaticScoring);
} finally { await recovery.terminate(); }
console.log('PASS: encrypted typed-value recovery, wrong-passphrase rejection before writes, and refusal to overwrite an existing recovery database.');
console.log('PASS: all seven notification states, immutable event data, receipts, leases, retry times, versions, and request limits survive isolated recovery unchanged.');
console.log('PASS: league rule profile schema, revision, optional policies and nested mercy rule survive encrypted recovery.');
console.log('PASS: schedule event revision, before/after arrangements, former official and timestamp survive encrypted recovery.');
console.log('PASS: automatic scoring, ordered runner outcomes, correction replacement/null actions and timestamps survive encrypted restore and replay; restored history accepts another audited correction.');
