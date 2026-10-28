import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { updateProfileAccess } from '../server/profile-access-service.mjs';
import { profileAccess } from '../profile-access.mjs';
import { requestProfileAccess, profileAccessEndpoint } from '../profile-access-client.mjs';
import { deleteEmptyTeam } from '../server/team-deletion-service.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulators required.');
const runtime = openReminderRuntime('demo-recseason'), { db } = runtime;
const server = createServer(runtime.handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let clientApp;
const id = `access-${randomUUID()}`, actor = `${id}-admin`, target = `${id}-target`, team = `${id}-team`;
const empty = { role: 'player', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] };
const userRef = db.doc(`users/${target}`), marker = db.doc('config/rosterRevision');
const revision = async () => (await marker.get()).data()?.revision ?? 0;
const request = async (access, extra = {}) => ({ db, verifiedUid: actor, targetUid: target, access,
  expectedAccess: profileAccess((await userRef.get()).data()), expectedRosterRevision: await revision(), ...extra });
const rejects = async (input, code) => {
  const before = (await userRef.get()).data(), version = await revision();
  await assert.rejects(updateProfileAccess(input), error => error.code === code);
  assert.deepEqual((await userRef.get()).data(), before); assert.equal(await revision(), version);
};
try {
  await db.doc(`users/${actor}`).set({ ...empty, role: 'siteAdmin' });
  await userRef.set({ ...empty, email: 'private@example.test', displayName: 'Keep me', emailReminders: false });
  await db.doc(`teams/${team}`).set({ name: 'Synthetic team' });
  const children = [];
  for (let i = 0; i < 30; i++) {
    const child = `${id}-${i}`; children.push(child);
    await db.doc(`players/${child}`).set({ name: `Child ${i}`, teamId: team, archived: false });
  }
  const parent = { ...empty, role: 'parent', linkedPlayerIds: children };
  const valid = await request(parent);
  assert.deepEqual(await updateProfileAccess(valid), { status: 'updated' });
  assert.equal(await revision(), valid.expectedRosterRevision + 1);
  assert.deepEqual((await userRef.get()).data(), { ...parent, email: 'private@example.test', displayName: 'Keep me', emailReminders: false });
  await rejects(valid, 'stale-profile');
  await rejects(await request(empty, { expectedRosterRevision: await revision() + 1 }), 'stale-roster');
  await db.doc(`players/${children[29]}`).update({ archived: true });
  await rejects(await request(parent), 'invalid-links');
  await db.doc(`players/${children[29]}`).update({ archived: false });
  const otherTeam = `${id}-other-team`;
  await db.doc(`players/${children[29]}`).update({ teamId: otherTeam });
  await rejects(await request(parent), 'invalid-links');
  await db.doc(`teams/${otherTeam}`).set({ name: 'Another team' });
  await updateProfileAccess(await request(parent));
  await rejects(await request({ ...parent, linkedPlayerIds: ['missing'] }), 'invalid-links');
  await rejects(await request({ ...empty, role: 'teamManager', linkedTeamId: 'missing' }), 'invalid-links');
  await rejects(await request({ ...empty, role: 'captain', linkedTeamId: 'missing', linkedPlayerId: children[0] }), 'invalid-links');
  await db.doc(`users/${actor}`).update({ role: 'leagueManager' });
  await rejects(await request(empty), 'permission-denied');
  await db.doc(`users/${actor}`).update({ role: 'siteAdmin' });
  await rejects(await request(empty, { targetUid: actor, expectedAccess: { ...empty, role: 'siteAdmin' } }), 'self-demotion');
  const concurrent = await request({ ...empty, role: 'scorekeeper' });
  const results = await Promise.allSettled([updateProfileAccess(concurrent), updateProfileAccess({ ...concurrent, access: { ...empty, role: 'umpire' } })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await revision(), concurrent.expectedRosterRevision + 1);
  assert.deepEqual((await userRef.get()).data().linkedPlayerIds, []);
  // Independent profile preference updates are retained by the access-only patch.
  const preference = await request(empty); await userRef.update({ displayName: 'Updated preference' });
  await updateProfileAccess(preference); assert.equal((await userRef.get()).data().displayName, 'Updated preference');
  const unused = `${id}-unused`; await db.doc(`teams/${unused}`).set({ name: 'Unused' });
  const race = await request({ ...empty, role: 'teamManager', linkedTeamId: unused });
  const scheduleVersion = (await db.doc('config/scheduleRevision').get()).data()?.revision ?? 0;
  const raced = await Promise.allSettled([updateProfileAccess(race), deleteEmptyTeam({ db, verifiedUid: actor, teamId: unused,
    expectedRosterRevision: race.expectedRosterRevision, expectedScheduleRevision: scheduleVersion })]);
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
  const final = (await userRef.get()).data();
  if (final.linkedTeamId === unused) assert.equal((await db.doc(`teams/${unused}`).get()).exists, true);
  const secondAdmin = `${id}-second-admin`;
  await db.doc(`users/${secondAdmin}`).set({ ...empty, role: 'siteAdmin' });
  const adminRevision = await revision();
  const demote = (verifiedUid, targetUid) => updateProfileAccess({ db, verifiedUid, targetUid, access: empty,
    expectedAccess: { ...empty, role: 'siteAdmin' }, expectedRosterRevision: adminRevision });
  const demotions = await Promise.allSettled([demote(actor, secondAdmin), demote(secondAdmin, actor)]);
  assert.equal(demotions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal([(await db.doc(`users/${actor}`).get()).data().role, (await db.doc(`users/${secondAdmin}`).get()).data().role].filter(role => role === 'siteAdmin').length, 1);
  await rejects(await request(empty, { db: { databaseId: '(default)' } }), 'invalid-request');
  await db.doc(`users/${actor}`).update({ role: 'siteAdmin' });
  const email = `${actor}@example.test`;
  await runtime.auth.createUser({ uid: actor, email, password: 'Synthetic123!' });
  clientApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, actor);
  const auth = getAuth(clientApp); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, email, 'Synthetic123!');
  const token = await credential.user.getIdToken();
  const payload = async access => ({ targetUid: target, expectedAccess: profileAccess((await userRef.get()).data()), expectedRosterRevision: await revision(), access });
  const body = await payload(parent);
  const send = (value = body, bearer = token) => fetch(`http://127.0.0.1:${server.address().port}/api/accounts/access`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(value) });
  const clearLimit = () => db.doc(`notificationLimits/${actor}`).delete();
  assert.equal((await send(body, 'invalid')).status, 401);
  assert.equal((await send({ ...body, verifiedUid: 'forged' })).status, 400);
  const saved = await send(); assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { status: 'updated' });
  assert.deepEqual(profileAccess((await userRef.get()).data()), parent);
  assert.equal(await revision(), body.expectedRosterRevision + 1);
  assert.equal((await send()).status, 429);
  await clearLimit(); assert.equal((await send()).status, 409);
  assert.equal(await revision(), body.expectedRosterRevision + 1);
  await clearLimit();
  const lostVersion = await revision(); let attempts = 0;
  await assert.rejects(requestProfileAccess({ endpoint: profileAccessEndpoint(true), targetUid: target, expectedAccess: parent,
    expectedRosterRevision: lostVersion, access: parent, user: credential.user, isCurrent: () => true, fetcher: async (url, init) => {
      attempts++; assert.equal(url, profileAccessEndpoint(true));
      const result = await fetch(`http://127.0.0.1:${server.address().port}/api/accounts/access`, init);
      assert.equal(result.status, 200); throw new Error('Lost successful response');
    } }), error => error.requiresRefresh === true);
  assert.equal(attempts, 1); assert.equal(await revision(), lostVersion + 1);
  assert.deepEqual(profileAccess((await userRef.get()).data()), parent);
  await clearLimit(); await db.doc(`players/${children[29]}`).update({ archived: true });
  assert.equal((await send(await payload(parent))).status, 409);
  await clearLimit(); await db.doc(`users/${actor}`).update({ role: 'leagueManager' });
  assert.equal((await send(await payload(empty))).status, 403);
  await runtime.auth.updateUser(actor, { disabled: true });
  assert.equal((await send(await payload(empty))).status, 401);
  console.log('PASS: account access HTTP verifies real identity, validates thirty children, rejects stale/forged requests, throttles retries and honors revoked roles/disabled accounts.');
  console.log('PASS: thirty-child account links, missing/archived/mismatched records, role checks, self-demotion, stale confirmations, concurrent edits, preference preservation and team deletion race. Local data only.');
} finally {
  if (clientApp) await deleteApp(clientApp);
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
}
