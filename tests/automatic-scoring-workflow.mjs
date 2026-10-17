import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { recordAutomaticPlay } from '../server/game-scoring-service.mjs';
import { replayAutomaticHistory } from '../automatic-scoring.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulators required.');
const runtime = openReminderRuntime('demo-recseason'), { db } = runtime;
const prefix = `automatic-${randomUUID()}`, scorer = `${prefix}-scorer`, organizer = `${prefix}-organizer`;
const rulesSnapshot = { profileId: 'synthetic', schemaVersion: 1, revision: 1, name: 'Synthetic league', rules: {
  innings: 1, ballsForWalk: 1, strikesForOut: 1, outsPerHalf: 1, startingBalls: 0, startingStrikes: 0,
  foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
  timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none' } };
const action = { schemaVersion: 1, type: 'play', elapsedMs: 0,
  play: { schemaVersion: 1, type: 'pitch', pitch: 'strike' }, runAward: 'ordinary' };
let sequence = 0;
const create = async patch => {
  const gameId = `${prefix}-${sequence++}`;
  await db.doc(`games/${gameId}`).set({ status: 'scheduled', homeTeamId: `${prefix}-home`, awayTeamId: `${prefix}-away`,
    fieldId: `${prefix}-field`, scorekeeperId: scorer, rulesSnapshot, ...patch });
  return { db, verifiedUid: scorer, gameId, expectedRevision: 0, engineVersion: 1, action };
};
const expectError = (request, code) => assert.rejects(recordAutomaticPlay(request), error => error.code === code);
try {
  await db.doc(`users/${scorer}`).set({ role: 'scorekeeper' });
  await db.doc(`users/${organizer}`).set({ role: 'leagueManager' });
  for (const suffix of ['home', 'away']) await db.doc(`teams/${prefix}-${suffix}`).set({ name: suffix });
  await db.doc(`fields/${prefix}-field`).set({ name: 'Synthetic field' });
  const concurrent = await create();
  const results = await Promise.allSettled([recordAutomaticPlay(concurrent), recordAutomaticPlay({ ...concurrent, verifiedUid: organizer })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'stale-revision');
  assert.equal((await db.doc(`games/${concurrent.gameId}`).get()).data().scoreRevision, 1);
  await expectError(concurrent, 'stale-revision');
  await recordAutomaticPlay({ ...concurrent, expectedRevision: 1 });
  const final = (await db.doc(`games/${concurrent.gameId}`).get()).data();
  const events = (await db.collection('scoreEvents').where('gameId', '==', concurrent.gameId).get()).docs.map(doc => doc.data());
  assert.equal(events.length, 2); assert.equal(final.status, 'completed');
  assert.ok(events.every(event => event.recordedAt?.toMillis() > 0));
  assert.deepEqual(replayAutomaticHistory(concurrent.gameId, final, events).at(-1), final.automaticScoring);
  await expectError({ ...concurrent, expectedRevision: 2 }, 'game-unavailable');

  const invalid = await create();
  await expectError({ ...invalid, action: { ...action, elapsedMs: -1 } }, 'invalid-action');
  assert.equal((await db.doc(`scoreEvents/${invalid.gameId}_1`).get()).exists, false);
  assert.equal((await db.doc(`games/${invalid.gameId}`).get()).data().scoreRevision, undefined);
  await expectError({ ...invalid, verifiedUid: 'unassigned' }, 'permission-denied');
  await db.doc(`users/${scorer}`).update({ role: 'parent' });
  await expectError(invalid, 'permission-denied');
  await db.doc(`users/${scorer}`).update({ role: 'scorekeeper' });
  await db.doc(`games/${invalid.gameId}`).update({ scorekeeperId: 'someone-else' });
  await expectError(invalid, 'permission-denied');
  await recordAutomaticPlay({ ...invalid, verifiedUid: organizer });

  for (const patch of [{ homeScore: 0 }, { status: 'live' }, { rulesSnapshot: null }, { fieldId: 'missing-field' }]) {
    await expectError(await create(patch), 'game-incompatible');
  }
  const occupied = await create();
  await db.doc(`scoreEvents/${occupied.gameId}_1`).set({ sentinel: 'preserve' });
  await expectError(occupied, 'history-inconsistent');
  assert.deepEqual((await db.doc(`scoreEvents/${occupied.gameId}_1`).get()).data(), { sentinel: 'preserve' });
  const corrupt = await create(); await recordAutomaticPlay(corrupt);
  await db.doc(`scoreEvents/${corrupt.gameId}_1`).update({ 'automatic.after.homeScore': 99 });
  await expectError({ ...corrupt, expectedRevision: 1 }, 'history-inconsistent');
  assert.equal((await db.doc(`scoreEvents/${corrupt.gameId}_2`).get()).exists, false);
  assert.equal((await db.doc(`games/${corrupt.gameId}`).get()).data().scoreRevision, 1);
  for (const target of ['rules', 'projection']) {
    const changed = await create(); await recordAutomaticPlay(changed);
    if (target === 'rules') await db.doc(`games/${changed.gameId}`).update({ 'rulesSnapshot.rules.innings': 2 });
    else await db.doc(`scoreEvents/${changed.gameId}_1`).update({ 'after.homeScore': 7 });
    await expectError({ ...changed, expectedRevision: 1 }, 'history-inconsistent');
    assert.equal((await db.doc(`scoreEvents/${changed.gameId}_2`).get()).exists, false);
  }
  await expectError({ ...invalid, db: { databaseId: '(default)' } }, 'invalid-request');
  console.log('PASS: automatic scoring transactions, concurrent scorers, rollback, frozen rules, current roles, append-only events, final rejection and full action replay. Local data only.');
} finally { await runtime.close(); }
