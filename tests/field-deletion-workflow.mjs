import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, runTransaction, doc, terminate } from 'firebase/firestore';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { deleteUnusedField } from '../server/field-deletion-service.mjs';
import { nextScheduleRevision } from '../schedule-version.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulators required.');
const runtime = openReminderRuntime('demo-recseason'), { db } = runtime;
const server = createServer(runtime.handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const uid = `field-${randomUUID()}`, email = `${uid}@example.test`;
let sequence = 0, clientApp, clientDb;
const revision = async () => (await db.doc('config/scheduleRevision').get()).data()?.revision ?? 0;
const fixture = async () => {
  const fieldId = `${uid}-${sequence++}`;
  await db.doc(`fields/${fieldId}`).set({ name: 'Synthetic field', availableDays: [0, 1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' });
  return { db, verifiedUid: uid, fieldId, expectedScheduleRevision: await revision() };
};
try {
  await db.doc(`users/${uid}`).set({ role: 'leagueManager' });
  for (const [collection, key] of [['games', 'fieldId'], ['rsvps', 'gameFieldId'], ['attendance', 'gameFieldId'], ['scheduleEvents', 'before'], ['scheduleEvents', 'after']]) {
    const request = await fixture();
    await db.doc(`${collection}/${request.fieldId}`).set(collection === 'scheduleEvents' ? { change: { [key]: { fieldId: request.fieldId } } } : { [key]: request.fieldId, status: 'completed' });
    await assert.rejects(deleteUnusedField(request), error => error.code === 'field-in-use');
    assert.equal((await db.doc(`fields/${request.fieldId}`).get()).exists, true);
    assert.equal(await revision(), request.expectedScheduleRevision);
  }
  const stale = await fixture();
  await assert.rejects(deleteUnusedField({ ...stale, expectedScheduleRevision: stale.expectedScheduleRevision + 1 }), error => error.code === 'stale-revision');
  await db.doc(`users/${uid}`).update({ role: 'teamManager' });
  await assert.rejects(deleteUnusedField(stale), error => error.code === 'permission-denied');
  await db.doc(`users/${uid}`).update({ role: 'leagueManager' });
  const concurrent = await fixture();
  const results = await Promise.allSettled([deleteUnusedField(concurrent), deleteUnusedField(concurrent)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await revision(), concurrent.expectedScheduleRevision + 1);
  await assert.rejects(deleteUnusedField({ ...stale, db: { databaseId: '(default)' } }), error => error.code === 'invalid-request');

  await runtime.auth.createUser({ uid, email, password: 'Synthetic123!' });
  clientApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, uid);
  const auth = getAuth(clientApp); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  clientDb = getFirestore(clientApp, 'recseason'); connectFirestoreEmulator(clientDb, '127.0.0.1', 8180);
  const credential = await signInWithEmailAndPassword(auth, email, 'Synthetic123!');
  const token = await credential.user.getIdToken();
  const race = await fixture();
  await db.doc(`teams/${uid}-home`).set({ name: 'Home' });
  await db.doc(`teams/${uid}-away`).set({ name: 'Away' });
  const publish = () => runTransaction(clientDb, async tx => {
    const field = await tx.get(doc(clientDb, 'fields', race.fieldId));
    const marker = await tx.get(doc(clientDb, 'config', 'scheduleRevision'));
    if (!field.exists()) throw new Error('Field removed.');
    const next = nextScheduleRevision(marker.data(), race.expectedScheduleRevision, uid);
    tx.set(doc(clientDb, 'games', `${uid}-racer`), { date: '2026-10-20', time: '18:00', durationMinutes: 90, status: 'scheduled', fieldId: race.fieldId, fieldName: 'Synthetic field', homeTeamId: `${uid}-home`, awayTeamId: `${uid}-away`, homeName: 'Home', awayName: 'Away', homeScore: null, awayScore: null });
    tx.set(doc(clientDb, 'config', 'scheduleRevision'), next);
  });
  const raced = await Promise.allSettled([deleteUnusedField(race), publish()]);
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await db.doc(`fields/${race.fieldId}`).get()).exists, (await db.doc(`games/${uid}-racer`).get()).exists);

  const unused = await fixture(), body = { fieldId: unused.fieldId, expectedScheduleRevision: unused.expectedScheduleRevision };
  const send = (payload = body, bearer = token) => fetch(`http://127.0.0.1:${server.address().port}/api/fields/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(payload) });
  const clearLimit = () => db.doc(`notificationLimits/${uid}`).delete();
  assert.equal((await send(body, 'invalid')).status, 401);
  assert.equal((await send({ ...body, verifiedUid: 'forged' })).status, 400);
  assert.equal((await send({ ...body, expectedScheduleRevision: body.expectedScheduleRevision + 1 })).status, 409);
  await clearLimit();
  const deleted = await send(); assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), { status: 'deleted' });
  assert.equal((await db.doc(`fields/${unused.fieldId}`).get()).exists, false);
  assert.equal((await send()).status, 429);
  await clearLimit(); await db.doc(`users/${uid}`).update({ role: 'parent' });
  assert.equal((await send()).status, 403);
  await runtime.auth.updateUser(uid, { disabled: true });
  assert.equal((await send()).status, 401);
  console.log('PASS: field references, stale revisions, concurrent deletion, authenticated publication race, verified HTTP identity, throttling and revoked access. Local data only.');
} finally {
  if (clientDb) await terminate(clientDb);
  if (clientApp) await deleteApp(clientApp);
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
}
