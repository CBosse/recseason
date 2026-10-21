import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { recordAutomaticPlay } from '../server/game-scoring-service.mjs';
import { replayAutomaticHistory } from '../automatic-scoring.mjs';
import { automaticScoringEndpoint, requestAutomaticPlay } from '../automatic-scoring-client.mjs';

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
let clientApp, server;
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

  const correction = { schemaVersion: 1, type: 'correction', targetRevision: 2, replacement: null, reason: 'Wrong final out' };
  const correctionRequest = { ...concurrent, expectedRevision: 2, action: correction };
  await expectError(correctionRequest, 'permission-denied');
  const corrections = await Promise.allSettled([1, 2].map(() => recordAutomaticPlay({ ...correctionRequest, verifiedUid: organizer })));
  assert.equal(corrections.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(corrections.find(result => result.status === 'rejected').reason.code, 'stale-revision');
  let corrected = (await db.doc(`games/${concurrent.gameId}`).get()).data();
  assert.equal(corrected.status, 'live'); assert.equal(corrected.scoreRevision, 3);
  const correctedEvents = (await db.collection('scoreEvents').where('gameId', '==', concurrent.gameId).get()).docs.map(doc => doc.data());
  assert.equal(correctedEvents.length, 3);
  for (const event of events) assert.deepEqual(correctedEvents.find(item => item.revision === event.revision), event);
  assert.deepEqual(replayAutomaticHistory(concurrent.gameId, corrected, correctedEvents).at(-1), corrected.automaticScoring);
  await recordAutomaticPlay({ ...concurrent, expectedRevision: 3 });
  corrected = (await db.doc(`games/${concurrent.gameId}`).get()).data();
  assert.equal(corrected.status, 'completed');
  await db.doc(`users/${organizer}`).update({ role: 'parent' });
  await expectError({ ...correctionRequest, expectedRevision: 4, verifiedUid: organizer }, 'permission-denied');
  await db.doc(`users/${organizer}`).update({ role: 'leagueManager' });
  await expectError({ ...correctionRequest, expectedRevision: 4, verifiedUid: organizer }, 'invalid-correction');
  assert.equal((await db.doc(`scoreEvents/${concurrent.gameId}_5`).get()).exists, false);

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
  await expectError({ ...corrupt, expectedRevision: 1, verifiedUid: organizer,
    action: { ...correction, targetRevision: 1 } }, 'history-inconsistent');
  const olderCorruption = await create();
  await recordAutomaticPlay(olderCorruption);
  await recordAutomaticPlay({ ...olderCorruption, expectedRevision: 1 });
  await db.doc(`scoreEvents/${olderCorruption.gameId}_1`).update({ 'automatic.action.play.pitch': 'ball' });
  await expectError({ ...olderCorruption, expectedRevision: 2, verifiedUid: organizer, action: correction }, 'history-inconsistent');
  assert.equal((await db.doc(`scoreEvents/${olderCorruption.gameId}_3`).get()).exists, false);
  assert.equal((await db.doc(`games/${olderCorruption.gameId}`).get()).data().status, 'completed');
  for (const target of ['rules', 'projection']) {
    const changed = await create(); await recordAutomaticPlay(changed);
    if (target === 'rules') await db.doc(`games/${changed.gameId}`).update({ 'rulesSnapshot.rules.innings': 2 });
    else await db.doc(`scoreEvents/${changed.gameId}_1`).update({ 'after.homeScore': 7 });
    await expectError({ ...changed, expectedRevision: 1 }, 'history-inconsistent');
    assert.equal((await db.doc(`scoreEvents/${changed.gameId}_2`).get()).exists, false);
  }
  await expectError({ ...invalid, db: { databaseId: '(default)' } }, 'invalid-request');
  await runtime.auth.createUser({ uid: scorer, email: `${scorer}@example.test`, password: 'Synthetic123!' });
  clientApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, prefix);
  const auth = getAuth(clientApp); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, `${scorer}@example.test`, 'Synthetic123!');
  const token = await credential.user.getIdToken();
  server = createServer(runtime.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const httpGame = await create();
  const body = { gameId: httpGame.gameId, expectedRevision: 0, engineVersion: 1, action };
  const send = (payload = body, bearer = token) => fetch(`http://127.0.0.1:${server.address().port}/api/games/plays`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, Origin: 'http://127.0.0.1:8081' }, body: JSON.stringify(payload) });
  const clearLimit = () => db.doc(`notificationLimits/${scorer}`).delete();
  assert.equal((await send(body, 'invalid')).status, 401);
  assert.equal((await send({ ...body, verifiedUid: organizer })).status, 400);
  assert.equal((await send({ ...body, expectedRevision: 1 })).status, 409);
  await clearLimit();
  const saved = await send(); assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { status: 'live', revision: 1 });
  const limit = (await db.doc(`notificationLimits/${scorer}`).get()).data();
  assert.ok(Number.isSafeInteger(limit.nextScoringAt));
  assert.equal(limit.nextRequestAt, undefined);
  // Seed a future limit so the rejection is deterministic even on a slow runner.
  await db.doc(`notificationLimits/${scorer}`).update({ nextScoringAt: Date.now() + 60000 });
  const throttled = await send(); assert.equal(throttled.status, 429); assert.equal(throttled.headers.get('retry-after'), '1');
  await clearLimit(); assert.equal((await send()).status, 409);
  await clearLimit(); await db.doc(`users/${scorer}`).update({ role: 'parent' });
  assert.equal((await send({ ...body, expectedRevision: 1 })).status, 403);
  await db.doc(`users/${scorer}`).update({ role: 'scorekeeper' });
  await clearLimit(); await db.doc(`games/${httpGame.gameId}`).update({ scorekeeperId: organizer });
  assert.equal((await send({ ...body, expectedRevision: 1 })).status, 403);
  await db.doc(`games/${httpGame.gameId}`).update({ scorekeeperId: scorer });
  await clearLimit();
  const completed = await send({ ...body, expectedRevision: 1 });
  assert.equal(completed.status, 200); assert.deepEqual(await completed.json(), { status: 'completed', revision: 2 });
  await clearLimit();
  const correctionBody = { ...body, expectedRevision: 2, action: correction };
  assert.equal((await send(correctionBody)).status, 403);
  await db.doc(`users/${scorer}`).update({ role: 'leagueManager' });
  await clearLimit();
  const correctedResponse = await send(correctionBody);
  assert.equal(correctedResponse.status, 200); assert.deepEqual(await correctedResponse.json(), { status: 'live', revision: 3 });
  await clearLimit(); assert.equal((await send(correctionBody)).status, 409);
  assert.equal((await db.collection('scoreEvents').where('gameId', '==', httpGame.gameId).get()).size, 3);
  await db.doc(`users/${scorer}`).update({ role: 'scorekeeper' });
  const uncertainGame = await create();
  const initialGame = (await db.doc(`games/${uncertainGame.gameId}`).get()).data();
  const clientRequest = { endpoint: automaticScoringEndpoint(true), gameId: uncertainGame.gameId,
    game: initialGame, action, user: credential.user, isCurrent: () => true };
  const proxy = (url, init) => {
    assert.equal(url, automaticScoringEndpoint(true));
    return fetch(`http://127.0.0.1:${server.address().port}/api/games/plays`, init);
  };
  await clearLimit();
  let attempts = 0;
  await assert.rejects(requestAutomaticPlay({ ...clientRequest, fetcher: async (url, init) => {
    attempts++; const response = await proxy(url, init); assert.equal(response.status, 200);
    throw new Error('Simulated lost response after commit');
  } }), error => error.code === 'unconfirmed' && error.needsRefresh);
  assert.equal(attempts, 1);
  assert.equal((await db.doc(`games/${uncertainGame.gameId}`).get()).data().scoreRevision, 1);
  await clearLimit();
  await assert.rejects(requestAutomaticPlay({ ...clientRequest, fetcher: proxy }), error => error.code === 'refresh-required' && error.needsRefresh);
  assert.equal((await db.collection('scoreEvents').where('gameId', '==', uncertainGame.gameId).get()).size, 1);
  await clearLimit();
  const refreshedGame = (await db.doc(`games/${uncertainGame.gameId}`).get()).data();
  assert.deepEqual(await requestAutomaticPlay({ ...clientRequest, game: refreshedGame, fetcher: proxy }), { status: 'completed', revision: 2 });
  await runtime.auth.updateUser(scorer, { disabled: true });
  assert.equal((await send()).status, 401);
  console.log('PASS: automatic scoring and organizer-only correction transactions, concurrent correction protection, immutable original events, full-history validation, verified HTTP identity, lost-response recovery, stale retries, throttling, revoked roles, reassignment and disabled accounts. Local data only.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (clientApp) await deleteApp(clientApp);
  await runtime.close();
}
