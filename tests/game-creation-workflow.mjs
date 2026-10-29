import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { createScheduledGame } from '../server/game-creation-service.mjs';
import { requestGameCreation, gameCreationEndpoint } from '../game-creation-client.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulator required.');
const runtime = openReminderRuntime('demo-recseason'), { db } = runtime;
const prefix = `creation-${randomUUID()}`, actor = db.doc(`users/${prefix}`), fieldRef = db.doc(`fields/${prefix}`);
const revisionRef = db.doc('config/scheduleRevision');
const revision = async () => (await revisionRef.get()).data()?.revision ?? 0;
const field = { name: 'Creation field', hasLights: true, zipCode: '', availableDays: [0, 1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '22:00' };
let sequence = 0;
let server, clientApp;
try {
  const config = (await db.doc('config/schedule').get()).data();
  let date = config.startDate;
  while (!(await db.collection('games').where('date', '==', date).limit(1).get()).empty) {
    date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
    if (date > config.endDate) throw new Error('No unused synthetic test date.');
  }
  await actor.set({ role: 'leagueManager' }); await fieldRef.set(field);
  for (const suffix of ['a', 'b', 'c', 'd']) await db.doc(`teams/${prefix}-${suffix}`).set({ name: suffix });
  const values = { date, time: '18:00', durationMinutes: 90, homeTeamId: `${prefix}-a`, awayTeamId: `${prefix}-b`, fieldId: prefix,
    umpireId: null, scorekeeperId: null, locked: true, ruleProfileId: null, ruleProfileRevision: null };
  const request = async (patch = {}, extra = {}) => ({ db, verifiedUid: prefix, gameId: `${prefix}-${sequence++}`, expectedScheduleRevision: await revision(), values: { ...values, ...patch }, ...extra });
  const rejects = async (input, code) => {
    const before = await revision();
    await assert.rejects(createScheduledGame(input), error => error.code === code);
    assert.equal((await db.doc(`games/${input.gameId}`).get()).exists, false);
    assert.equal(await revision(), before);
  };
  await rejects(await request({ homeTeamId: 'missing' }), 'reference-unavailable');
  await rejects(await request({ umpireId: 'missing' }), 'reference-unavailable');
  await rejects(await request({ scorekeeperId: prefix }), 'reference-unavailable');
  await rejects(await request({ time: '21:00' }), 'booking-conflict');
  await rejects(await request({ ruleProfileId: prefix, ruleProfileRevision: 1 }), 'stale-rules');
  const first = await request();
  assert.deepEqual(await createScheduledGame(first), { status: 'created', gameId: first.gameId });
  const saved = (await db.doc(`games/${first.gameId}`).get()).data();
  assert.equal(saved.homeName, 'a'); assert.equal(saved.status, 'scheduled'); assert.equal(saved.homeScore, null);
  await rejects({ ...first, gameId: `${prefix}-stale` }, 'stale-revision');
  await rejects(await request(), 'booking-conflict');
  await db.doc(`games/${first.gameId}`).update({ status: 'cancelled' });
  const malformed = db.doc(`games/${prefix}-malformed`);
  await malformed.set({ ...saved, time: 'bad' });
  await rejects(await request(), 'invalid-booking');
  await malformed.update({ status: 'cancelled' });
  const profile = { schemaVersion: 1, revision: 1, name: 'Synthetic rules', rules: {
    innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3, startingBalls: 0, startingStrikes: 0,
    foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
    timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none',
  } };
  await db.doc(`ruleProfiles/${prefix}`).set(profile);
  const ruled = await request({ ruleProfileId: prefix, ruleProfileRevision: 1 });
  await createScheduledGame(ruled);
  const ruledRef = db.doc(`games/${ruled.gameId}`);
  assert.deepEqual((await ruledRef.get()).data().rulesSnapshot, { profileId: prefix, ...profile });
  const beforeDuplicate = await revision();
  await assert.rejects(createScheduledGame({ ...ruled, expectedScheduleRevision: beforeDuplicate }), { code: 'game-exists' });
  assert.equal(await revision(), beforeDuplicate);
  await db.doc(`ruleProfiles/${prefix}`).update({ revision: 2, name: 'New revision' });
  assert.deepEqual((await ruledRef.get()).data().rulesSnapshot, { profileId: prefix, ...profile });
  await ruledRef.update({ status: 'cancelled' });
  await rejects(await request({ ruleProfileId: prefix, ruleProfileRevision: 1 }), 'stale-rules');
  const unlit = { ...field, hasLights: false, zipCode: '02101' };
  await fieldRef.set(unlit);
  await rejects(await request(), 'daylight-unavailable');
  await rejects(await request({}, { resolveDaylight: async () => ({ sunrise: '06:00', sunset: '19:00' }) }), 'booking-conflict');
  await rejects(await request({}, { resolveDaylight: async () => {
    await actor.set({ role: 'player' }); return { sunrise: '06:00', sunset: '20:00' };
  } }), 'permission-denied');
  await actor.set({ role: 'leagueManager' });
  await rejects(await request({}, { resolveDaylight: async () => {
    await fieldRef.update({ zipCode: '10001' }); return { sunrise: '06:00', sunset: '20:00' };
  } }), 'stale-field');
  await fieldRef.set(field);
  const one = await request(), two = await request();
  const results = await Promise.allSettled([createScheduledGame(one), createScheduledGame(two)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await revision(), one.expectedScheduleRevision + 1);
  const winner = results.find(result => result.status === 'fulfilled').value.gameId;
  await db.doc(`games/${winner}`).update({ status: 'cancelled' });
  const scorer = `${prefix}-scorer`;
  await db.doc(`users/${scorer}`).set({ role: 'scorekeeper' });
  await malformed.set({ ...saved, fieldId: 'other-field', homeTeamId: `${prefix}-c`, awayTeamId: `${prefix}-d`, scorekeeperId: scorer });
  await rejects(await request({ scorekeeperId: scorer }), 'booking-conflict');
  await malformed.update({ status: 'cancelled' });
  console.log('PASS: server game creation validates current references, authorization, daylight, conflicts, stale requests, malformed bookings and concurrent creation.');
  await runtime.auth.createUser({ uid: prefix, email: `${prefix}@example.test`, password: 'LocalDemo123!' });
  clientApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, prefix);
  const auth = getAuth(clientApp); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, `${prefix}@example.test`, 'LocalDemo123!');
  const token = await credential.user.getIdToken();
  server = createServer(runtime.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const body = { gameId: `${prefix}-http`, expectedScheduleRevision: await revision(), values };
  const send = data => fetch(`http://127.0.0.1:${server.address().port}/api/games/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(data),
  });
  assert.equal((await send({ ...body, verifiedUid: 'forged' })).status, 400);
  const response = await send(body); assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { status: 'created', gameId: body.gameId });
  const versionAfterSave = await revision();
  assert.equal((await send(body)).status, 429);
  const limit = db.doc(`notificationLimits/${prefix}`);
  await limit.set({ nextGameCreationAt: 0 }, { merge: true });
  assert.equal((await send(body)).status, 409);
  assert.equal(await revision(), versionAfterSave);
  await limit.set({ nextGameCreationAt: 0 }, { merge: true });
  await db.doc(`games/${body.gameId}`).update({ status: 'cancelled' });
  const lostId = `${prefix}-lost-response`, beforeLost = await revision();
  let attempts = 0;
  await assert.rejects(requestGameCreation({ endpoint: gameCreationEndpoint(true), gameId: lostId, expectedScheduleRevision: beforeLost, values,
    user: credential.user, isCurrent: () => true, fetcher: async (_url, options) => {
      attempts++;
      const saved = await fetch(`http://127.0.0.1:${server.address().port}/api/games/create`, options);
      assert.equal(saved.status, 201); await saved.json(); throw new Error('Simulated lost response');
    } }), { requiresRefresh: true });
  assert.equal(attempts, 1); assert.equal(await revision(), beforeLost + 1);
  assert.equal((await db.doc(`games/${lostId}`).get()).exists, true);
  await limit.set({ nextGameCreationAt: 0 }, { merge: true }); await actor.update({ role: 'player' });
  assert.equal((await send({ ...body, expectedScheduleRevision: await revision() })).status, 403);
  await runtime.auth.updateUser(prefix, { disabled: true });
  assert.equal((await send(body)).status, 401);
  console.log('PASS: creation HTTP verifies real identity, rejects forged actors/stale requests, throttles retries and honors role revocation and disabled accounts.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (clientApp) await deleteApp(clientApp);
  await runtime.close();
}
