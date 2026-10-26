import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { updateFieldAvailability } from '../server/field-update-service.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulators required.');
const runtime = openReminderRuntime('demo-recseason'), { db } = runtime;
const server = createServer(runtime.handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let clientApp;
const uid = `field-update-${randomUUID()}`, fieldId = uid;
const field = { name: 'Synthetic field', availableDays: [0, 1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' };
const fieldRef = db.doc(`fields/${fieldId}`), gameRef = db.doc(`games/${uid}`);
const revisionRef = db.doc('config/scheduleRevision');
const revision = async () => (await revisionRef.get()).data()?.revision ?? 0;
const game = { fieldId, date: '2026-10-26', time: '18:00', durationMinutes: 90, status: 'scheduled' };
const request = async (values = field, extra = {}) => ({ db, verifiedUid: uid, fieldId, expectedScheduleRevision: await revision(), values, ...extra });
const rejects = async (input, code) => {
  const before = (await fieldRef.get()).data(), version = await revision();
  await assert.rejects(updateFieldAvailability(input), error => error.code === code);
  assert.deepEqual((await fieldRef.get()).data(), before);
  assert.equal(await revision(), version);
};
try {
  await db.doc(`users/${uid}`).set({ role: 'leagueManager' });
  await fieldRef.set(field); await gameRef.set(game);
  for (const patch of [{ closeTime: '19:00' }, { openTime: '18:30' }, { availableDays: [2] }]) {
    await rejects(await request({ ...field, ...patch }), 'booking-conflict');
  }
  for (const patch of [{ date: '2026-02-30' }, { status: 'unknown' }, { time: 'bad' }, { durationMinutes: 0 }]) {
    await gameRef.set({ ...game, ...patch });
    await rejects(await request(), 'booking-conflict');
  }
  await gameRef.set(game);
  const narrow = { ...field, openTime: '18:00', closeTime: '19:30', availableDays: [1] };
  const valid = await request(narrow);
  assert.deepEqual(await updateFieldAvailability(valid), { status: 'updated' });
  assert.deepEqual((await fieldRef.get()).data(), narrow);
  assert.equal(await revision(), valid.expectedScheduleRevision + 1);
  await rejects(valid, 'stale-revision');
  const unlit = { ...field, hasLights: false, zipCode: '02101' };
  await rejects(await request(unlit), 'daylight-unavailable');
  await rejects(await request(unlit, { resolveDaylight: async () => { throw new Error('offline'); } }), 'daylight-unavailable');
  await rejects(await request(unlit, { resolveDaylight: async () => ({ sunrise: '06:00', sunset: '19:00' }) }), 'booking-conflict');
  await gameRef.update({ status: 'live' });
  await rejects(await request({ ...field, closeTime: '19:00' }), 'booking-conflict');
  await gameRef.set(game);
  let lookups = 0;
  const extraGame = db.doc(`games/${uid}-same-date`);
  await extraGame.set({ ...game, time: '16:00' });
  await updateFieldAvailability(await request(unlit, { resolveDaylight: async input => {
    assert.deepEqual(input, { zipCode: '02101', date: game.date }); lookups++;
    return { sunrise: '06:00', sunset: '19:30' };
  } }));
  assert.equal(lookups, 1);
  // Even a privileged writer that bypasses the schedule marker cannot hide a fresh conflict.
  await rejects(await request(unlit, { resolveDaylight: async () => {
    await gameRef.update({ time: '21:00' });
    return { sunrise: '06:00', sunset: '20:00' };
  } }), 'booking-conflict');
  await gameRef.set(game);
  // A concurrent schedule writer during external daylight lookup invalidates the preflight.
  const stale = await request(unlit, { resolveDaylight: async () => {
    await revisionRef.set({ revision: await revision() + 1, updatedBy: uid });
    return { sunrise: '06:00', sunset: '20:00' };
  } });
  const before = (await fieldRef.get()).data();
  await assert.rejects(updateFieldAvailability(stale), error => error.code === 'stale-revision');
  assert.deepEqual((await fieldRef.get()).data(), before);
  // Role revocation during lookup is checked again inside the write transaction.
  await rejects(await request(unlit, { resolveDaylight: async () => {
    await db.doc(`users/${uid}`).set({ role: 'player' });
    return { sunrise: '06:00', sunset: '20:00' };
  } }), 'permission-denied');
  await db.doc(`users/${uid}`).set({ role: 'leagueManager' });
  const concurrent = await request();
  const results = await Promise.allSettled([updateFieldAvailability(concurrent), updateFieldAvailability(concurrent)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await revision(), concurrent.expectedScheduleRevision + 1);
  await gameRef.update({ status: 'final' }); await extraGame.update({ status: 'cancelled' });
  await updateFieldAvailability(await request({ ...unlit, openTime: '10:00', closeTime: '11:00' }));
  await rejects(await request({ ...field, injected: true }), 'invalid-request');
  await rejects(await request({ ...field, name: 42 }), 'invalid-request');
  await rejects(await request({ ...field, openTime: ['08:00'] }), 'invalid-request');
  await rejects(await request(field, { db: { projectId: 'bosse-testing', databaseId: '(default)' } }), 'invalid-request');
  const email = `${uid}@example.test`;
  await runtime.auth.createUser({ uid, email, password: 'Synthetic123!' });
  clientApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, uid);
  const auth = getAuth(clientApp); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, email, 'Synthetic123!');
  const token = await credential.user.getIdToken();
  let body = { fieldId, expectedScheduleRevision: await revision(), values: field };
  const send = (payload = body, bearer = token) => fetch(`http://127.0.0.1:${server.address().port}/api/fields/update`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(payload) });
  const clearLimit = () => db.doc(`notificationLimits/${uid}`).delete();
  assert.equal((await send(body, 'invalid')).status, 401);
  assert.equal((await send({ ...body, verifiedUid: 'forged' })).status, 400);
  assert.equal((await send({ ...body, expectedScheduleRevision: body.expectedScheduleRevision + 1 })).status, 409);
  await clearLimit();
  const response = await send(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'updated' });
  assert.deepEqual((await fieldRef.get()).data(), field);
  assert.equal(await revision(), body.expectedScheduleRevision + 1);
  assert.equal((await send()).status, 429);
  await clearLimit(); assert.equal((await send()).status, 409);
  await clearLimit(); await gameRef.set(game);
  body = { fieldId, expectedScheduleRevision: await revision(), values: { ...field, closeTime: '19:00' } };
  assert.equal((await send()).status, 409);
  assert.deepEqual((await fieldRef.get()).data(), field);
  await clearLimit(); await db.doc(`users/${uid}`).set({ role: 'player' });
  assert.equal((await send()).status, 403);
  await runtime.auth.updateUser(uid, { disabled: true });
  assert.equal((await send()).status, 401);
  console.log('PASS: transactional field availability, daylight conflicts, concurrent edits, verified HTTP identity, rate limits, stale retries and revoked access. Local data only.');
} finally {
  if (clientApp) await deleteApp(clientApp);
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
}
