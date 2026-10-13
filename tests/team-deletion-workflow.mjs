import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { deleteEmptyTeam } from '../server/team-deletion-service.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulators required.');
const runtime = openReminderRuntime('demo-recseason');
const { db } = runtime;
const prefix = `delete-${randomUUID()}`;
const uid = `${prefix}-organizer`;
let sequence = 0;
try {
  await db.doc(`users/${uid}`).set({ role: 'leagueManager' });
  const revisions = async () => ({
    expectedRosterRevision: (await db.doc('config/rosterRevision').get()).data()?.revision ?? 0,
    expectedScheduleRevision: (await db.doc('config/scheduleRevision').get()).data()?.revision ?? 0,
  });
  const fixture = async () => {
    const teamId = `${prefix}-${sequence++}`;
    await db.doc(`teams/${teamId}`).set({ name: 'Synthetic empty team' });
    return { db, verifiedUid: uid, teamId, ...await revisions() };
  };
  const rejected = async (request, code) => {
    const before = await revisions();
    await assert.rejects(deleteEmptyTeam(request), error => error.code === code);
    assert.equal((await db.doc(`teams/${request.teamId}`).get()).exists, true);
    assert.deepEqual(await revisions(), before, 'Rejected deletion must not advance either revision.');
  };
  for (const [collection, field] of [
    ['players', 'teamId'], ['teamRoster', 'teamId'], ['games', 'homeTeamId'], ['games', 'awayTeamId'],
    ['users', 'linkedTeamId'], ['invitations', 'linkedTeamId'], ['rsvps', 'teamId'], ['attendance', 'teamId'],
  ]) {
    const request = await fixture();
    await db.doc(`${collection}/${request.teamId}-reference`).set({ [field]: request.teamId, archived: true, status: 'completed' });
    await rejected(request, 'team-in-use');
  }
  const stale = await fixture();
  await rejected({ ...stale, expectedRosterRevision: stale.expectedRosterRevision + 1 }, 'stale-revision');
  await rejected({ ...stale, expectedScheduleRevision: stale.expectedScheduleRevision + 1 }, 'stale-revision');
  for (const role of ['teamManager', 'parent', 'player']) {
    await db.doc(`users/${uid}`).update({ role });
    await rejected(stale, 'permission-denied');
  }
  await db.doc(`users/${uid}`).update({ role: 'leagueManager' });
  const empty = await fixture();
  assert.deepEqual(await deleteEmptyTeam(empty), { status: 'deleted' });
  assert.equal((await db.doc(`teams/${empty.teamId}`).get()).exists, false);
  assert.deepEqual(await revisions(), { expectedRosterRevision: empty.expectedRosterRevision + 1, expectedScheduleRevision: empty.expectedScheduleRevision + 1 });
  await assert.rejects(deleteEmptyTeam(empty), error => error.code === 'team-unavailable');
  const concurrent = await fixture();
  const results = await Promise.allSettled([deleteEmptyTeam(concurrent), deleteEmptyTeam(concurrent)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual(await revisions(), { expectedRosterRevision: concurrent.expectedRosterRevision + 1, expectedScheduleRevision: concurrent.expectedScheduleRevision + 1 });
  const race = await fixture();
  const playerRef = db.doc(`players/${race.teamId}-racer`);
  const addPlayer = () => db.runTransaction(async tx => {
    const team = await tx.get(db.doc(`teams/${race.teamId}`));
    const rosterRef = db.doc('config/rosterRevision');
    const roster = await tx.get(rosterRef);
    if (!team.exists) throw new Error('Team removed');
    tx.set(playerRef, { name: 'Synthetic racing player', teamId: race.teamId });
    tx.set(rosterRef, { revision: roster.data().revision + 1, updatedBy: uid });
  });
  const raced = await Promise.allSettled([deleteEmptyTeam(race), addPlayer()]);
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(raced.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await db.doc(`teams/${race.teamId}`).get()).exists, (await playerRef.get()).exists);
  await assert.rejects(deleteEmptyTeam({ ...stale, db: { databaseId: '(default)' } }), error => error.code === 'invalid-request');
  console.log('PASS: server team removal rejects all eight reference types, stale confirmations and revoked organizer roles; empty deletion advances both revisions once under concurrent requests.');
} finally { await runtime.close(); }
