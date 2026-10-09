import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, documentId, setDoc, getDoc, updateDoc, deleteDoc, deleteField, collection, getDocs, query, where, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { invitationProfilePatch } from '../../invitations.mjs';
import { newPlayerProfile } from '../../accounts.mjs';
import { liveScoreUpdate } from '../../live-scoring.mjs';
import { inningScoreUpdate } from '../../inning-scores.mjs';
import { rsvpSchedule } from '../../rsvps.mjs';
import { rosterEntry } from '../../team-roster.mjs';
import { scoreHistoryEntry } from '../../score-history.mjs';
import { nextRulesProfile, gameRulesSnapshot } from '../../league-rules.mjs';
let env;
const profile = (uid, role, extra = {}) => ({ ...newPlayerProfile({ uid, email: `${uid}@example.test` }, uid), role, ...extra });
const game = { status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', homeName: 'Home', awayName: 'Away', fieldName: 'Main', durationMinutes: 90, scorekeeperId: 'scorer', date: '2026-09-25', time: '18:00', fieldId: 'main' };
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-recseason', firestore: { host: '127.0.0.1', port: 8180, rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'teams', 'a'), { name: 'Home' });
    await setDoc(doc(db, 'teams', 'b'), { name: 'Away' });
    await setDoc(doc(db, 'fields', 'main'), { name: 'Main', availableDays: [0, 1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' });
    for (const [uid, role, extra] of [['admin', 'siteAdmin'], ['organizer', 'leagueManager'], ['scorer', 'scorekeeper'], ['other', 'scorekeeper'], ['player', 'player', { linkedPlayerId: 'p' }], ['parent', 'parent', { linkedPlayerIds: ['p'] }], ['manager', 'teamManager', { linkedTeamId: 'a' }]]) await setDoc(doc(db, 'users', uid), profile(uid, role, extra));
    await setDoc(doc(db, 'games', 'g'), game);
    await setDoc(doc(db, 'games', 'cancelled'), { ...game, status: 'cancelled' });
    await setDoc(doc(db, 'players', 'p'), { name: 'Player', phone: 'private', teamId: 'a' });
    await setDoc(doc(db, 'players', 'other'), { name: 'Other', phone: 'private', teamId: 'b' });
    await setDoc(doc(db, 'players', 'archived'), { name: 'Archived', phone: '', teamId: 'a', archived: true });
    await setDoc(doc(db, 'users', 'archived'), profile('archived', 'player', { linkedPlayerId: 'archived' }));
    const { linkedPlayerIds, ...legacyAdmin } = profile('legacy-admin', 'siteAdmin');
    await setDoc(doc(db, 'users', 'legacy-admin'), legacyAdmin);
    await setDoc(doc(db, 'users', 'captain'), profile('captain', 'captain', { linkedPlayerId: 'p' }));
    await setDoc(doc(db, 'teamRoster', 'p'), rosterEntry({ name: 'Player', teamId: 'a' }));
    await setDoc(doc(db, 'teamRoster', 'other'), rosterEntry({ name: 'Other', teamId: 'b' }));
    await setDoc(doc(db, 'players', 'teammate'), { name: 'Teammate', teamId: 'a', phone: 'private' });
    await setDoc(doc(db, 'teamRoster', 'teammate'), rosterEntry({ name: 'Teammate', teamId: 'a' }));
  });
});
after(async () => { await env?.cleanup(); });

const leagueRuleValues = { name: 'Youth division', rules: { innings: 6, ballsForWalk: 5, strikesForOut: 4, outsPerHalf: 4, startingBalls: 1, startingStrikes: 1,
  foulAtStrikeLimit: 'strikeout', runsPerHalf: 5, unlimitedFinalInning: true, mercy: { runs: 10, afterInning: 4 }, timeLimitMinutes: 75, tiePolicy: 'extra-innings', extraInningRunner: 'second' } };

test('only organizers persist validated rule profiles, with public reads and no deletion', async () => {
  const value = nextRulesProfile(null, leagueRuleValues, 0);
  for (const uid of ['scorer', 'player', 'parent', 'manager', 'captain']) await assertFails(setDoc(doc(dbFor(uid), 'ruleProfiles', `forbidden-${uid}`), value));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'ruleProfiles', 'anonymous'), value));
  await assertSucceeds(setDoc(doc(dbFor('organizer'), 'ruleProfiles', 'youth'), value));
  assert.deepEqual((await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'ruleProfiles', 'youth')))).data(), value);
  await assertFails(deleteDoc(doc(dbFor('admin'), 'ruleProfiles', 'youth')));
  const next = nextRulesProfile(value, { ...leagueRuleValues, name: 'Updated youth division' }, 1);
  await assertSucceeds(setDoc(doc(dbFor('admin'), 'ruleProfiles', 'youth'), next));
  await assertFails(setDoc(doc(dbFor('organizer'), 'ruleProfiles', 'youth'), next));
  await assertFails(setDoc(doc(dbFor('admin'), 'ruleProfiles', 'youth'), { ...next, revision: 4 }));
});

test('direct organizer writes cannot bypass league rule schema or cross-field constraints', async () => {
  const value = nextRulesProfile(null, leagueRuleValues, 0);
  const target = doc(dbFor('admin'), 'ruleProfiles', 'invalid-profile');
  for (const patch of [{ innings: 0 }, { startingBalls: 5 }, { startingStrikes: 4 }, { outsPerHalf: 13 }, { runsPerHalf: null },
    { mercy: { runs: 10, afterInning: 7 } }, { mercy: { runs: 10, afterInning: 4, ignored: true } }, { timeLimitMinutes: -1 },
    { tiePolicy: 'allow-tie' }, { foulAtStrikeLimit: 'guess' }, { unknown: true }]) await assertFails(setDoc(target, { ...value, rules: { ...value.rules, ...patch } }));
  for (const patch of [{ revision: 2 }, { schemaVersion: 2 }, { name: ' ' }, { name: 'x'.repeat(101) }, { name: 'two\nlines' }, { extra: true }]) await assertFails(setDoc(target, { ...value, ...patch }));
  const { startingBalls, ...missing } = value.rules;
  await assertFails(setDoc(target, { ...value, rules: missing }));
});

test('concurrent profile saves admit one revision and reject the stale writer', async () => {
  const value = nextRulesProfile(null, leagueRuleValues, 0);
  await setDoc(doc(dbFor('admin'), 'ruleProfiles', 'concurrent-rules'), value);
  const writes = await Promise.allSettled(['admin', 'organizer'].map(uid => setDoc(doc(dbFor(uid), 'ruleProfiles', 'concurrent-rules'), nextRulesProfile(value, { ...leagueRuleValues, name: uid }, 1))));
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await getDoc(doc(dbFor('admin'), 'ruleProfiles', 'concurrent-rules'))).data().revision, 2);
});

test('private notification jobs and rate limits are inaccessible to all browser roles', async () => {
  for (const name of ['notificationJobs', 'notificationLimits']) {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), name, 'private-job'), { recipient: 'private@example.test', body: 'Private notice' }));
    for (const uid of ['admin', 'organizer', 'scorer', 'player', 'parent', 'manager']) {
      const db = dbFor(uid);
      await assertFails(getDoc(doc(db, name, 'private-job')));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name, 'injected'), { status: 'pending' }));
      await assertFails(deleteDoc(doc(db, name, 'private-job')));
    }
  }
});

test('users can change only their own boolean email preference without changing privileges', async () => {
  const db = dbFor('player');
  await assertSucceeds(updateDoc(doc(db, 'users', 'player'), { emailReminders: false }));
  await assertFails(updateDoc(doc(db, 'users', 'player'), { emailReminders: 'false' }));
  await assertFails(updateDoc(doc(db, 'users', 'parent'), { emailReminders: false }));
  await assertFails(updateDoc(doc(db, 'users', 'player'), { emailReminders: true, role: 'siteAdmin' }));
  await assertSucceeds(updateDoc(doc(db, 'users', 'player'), { emailReminders: true }));
});
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
async function addRosterVersion(batch, db, uid) {
  const ref = doc(db, 'config', 'rosterRevision');
  const before = await getDoc(ref);
  batch.set(ref, { revision: (before.data()?.revision ?? 0) + 1, updatedBy: uid });
}

test('roster writes reject malformed fields and nonexistent teams at the database boundary', async () => {
  const db = dbFor('admin');
  for (const patch of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, { color: 42 }, { homefield: 'x'.repeat(101) }, { unexpected: true }]) {
    await assertFails(setDoc(doc(db, 'teams', 'invalid'), { name: 'Team', ...patch }));
  }
  await assertSucceeds(setDoc(doc(db, 'teams', 'valid'), { name: 'Valid', color: '', homefield: '' }));
  const writePlayer = async values => {
    const player = { name: 'Valid player', teamId: 'a', number: '', phone: '', ...values };
    const batch = writeBatch(db);
    batch.set(doc(db, 'players', 'schema-test'), player);
    batch.set(doc(db, 'teamRoster', 'schema-test'), rosterEntry(player));
    await addRosterVersion(batch, db, 'admin');
    return batch.commit();
  };
  for (const patch of [{ name: '' }, { name: '  ' }, { name: 'x'.repeat(101) }, { number: 'x'.repeat(11) }, { phone: 42 }, { phone: 'x'.repeat(41) }, { archived: 'false' }, { teamId: 'missing' }, { unexpected: true }]) {
    await assertFails(writePlayer(patch));
  }
  await assertSucceeds(writePlayer({}));
  const atomic = writeBatch(db);
  atomic.set(doc(db, 'teams', 'new-atomic'), { name: 'New team' });
  const player = { name: 'New player', teamId: 'new-atomic' };
  atomic.set(doc(db, 'players', 'atomic'), player);
  atomic.set(doc(db, 'teamRoster', 'atomic'), rosterEntry(player));
  await addRosterVersion(atomic, db, 'admin');
  await assertSucceeds(atomic.commit());
});

test('legacy admin without child links can update its profile without broadening access', async () => {
  await assertSucceeds(updateDoc(doc(dbFor('legacy-admin'), 'users', 'legacy-admin'), { displayName: 'Admin' }));
  await assertFails(updateDoc(doc(dbFor('player'), 'users', 'legacy-admin'), { linkedPlayerIds: ['p'] }));
  await assertFails(updateDoc(doc(dbFor('legacy-admin'), 'users', 'legacy-admin'), { linkedPlayerIds: 'invalid' }));
});

test('roster membership writes and team removal cannot bypass revision coordination', async () => {
  const db = dbFor('admin');
  const player = { name: 'Uncoordinated', teamId: 'a' };
  const batch = writeBatch(db);
  batch.set(doc(db, 'players', 'uncoordinated'), player);
  batch.set(doc(db, 'teamRoster', 'uncoordinated'), rosterEntry(player));
  await assertFails(batch.commit());
  const deletion = writeBatch(db);
  deletion.delete(doc(db, 'teams', 'valid'));
  await assertFails(deletion.commit());
  await assertFails(setDoc(doc(dbFor('player'), 'config', 'rosterRevision'), { revision: 3, updatedBy: 'player' }));
  const reset = writeBatch(db);
  reset.delete(doc(db, 'config', 'rosterRevision'));
  await assertFails(reset.commit());
});
test('captain attendance requires own team, current schedule and next revision', async () => {
  const data = { gameId: 'g', playerId: 'teammate', teamId: 'a', status: 'present', ...rsvpSchedule(game), revision: 1, checkedBy: 'captain', checkedAt: serverTimestamp() };
  const ref = doc(dbFor('captain'), 'attendance', 'g_teammate');
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, data));
  await assertSucceeds(getDocs(query(collection(dbFor('captain'), 'attendance'), where('teamId', '==', 'a'))));
  await assertFails(setDoc(ref, data));
  await assertSucceeds(setDoc(ref, { ...data, status: 'absent', revision: 2 }));
  await assertFails(setDoc(ref, { ...data, revision: 3, gameTime: '23:00' }));
  await assertFails(setDoc(ref, { ...data, revision: 3, checkedBy: 'admin' }));
  await assertFails(setDoc(doc(dbFor('player'), 'attendance', 'g_teammate'), { ...data, revision: 3, checkedBy: 'player' }));
  await assertFails(setDoc(doc(dbFor('captain'), 'attendance', 'g_other'), { ...data, playerId: 'other', teamId: 'b' }));
  await assertFails(setDoc(doc(dbFor('captain'), 'attendance', 'cancelled_teammate'), { ...data, gameId: 'cancelled' }));
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'attendance')));
});

test('public schedule does not expose profiles or phone records', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'games', 'g')));
  await assertFails(getDoc(doc(db, 'players', 'p')));
  await assertFails(getDocs(collection(db, 'users')));
  await assertFails(updateDoc(doc(db, 'games', 'g'), { status: 'completed' }));
});
test('signup cannot grant roles or player links; own name can change', async () => {
  const db = dbFor('new');
  await assertFails(setDoc(doc(db, 'users', 'new'), profile('new', 'siteAdmin')));
  await assertFails(setDoc(doc(db, 'users', 'new'), profile('new', 'player', { linkedPlayerId: 'p' })));
  await assertSucceeds(setDoc(doc(db, 'users', 'new'), profile('new', 'player')));
  await assertSucceeds(updateDoc(doc(db, 'users', 'new'), { displayName: 'Updated' }));
  await assertFails(updateDoc(doc(db, 'users', 'new'), { role: 'siteAdmin' }));
  await assertFails(updateDoc(doc(db, 'users', 'new'), { linkedPlayerIds: ['p'] }));
});
test('organizer can query scorers but not unrelated private profiles', async () => {
  const db = dbFor('organizer');
  await assertSucceeds(getDocs(query(collection(db, 'users'), where('role', '==', 'scorekeeper'))));
  await assertFails(getDocs(collection(db, 'users')));
  await assertSucceeds(getDocs(collection(dbFor('admin'), 'users')));
});
test('player and parent access is limited to linked players; manager cannot transfer to another team', async () => {
  for (const uid of ['player', 'parent']) {
    await assertSucceeds(getDoc(doc(dbFor(uid), 'players', 'p')));
    await assertSucceeds(getDocs(query(collection(dbFor(uid), 'players'), where(documentId(), 'in', ['p']))));
    await assertFails(getDoc(doc(dbFor(uid), 'players', 'other')));
  }
  const managerDb = dbFor('manager');
  const batch = writeBatch(managerDb);
  batch.update(doc(managerDb, 'players', 'p'), { name: 'Renamed' });
  batch.set(doc(managerDb, 'teamRoster', 'p'), rosterEntry({ name: 'Renamed', teamId: 'a' }));
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(query(collection(dbFor('manager'), 'players'), where('teamId', '==', 'a'))));
  await assertFails(updateDoc(doc(dbFor('manager'), 'players', 'p'), { teamId: 'b' }));
});

test('captain sees only contact-free own-team roster; projection changes must stay atomic', async () => {
  const captainDb = dbFor('captain');
  await assertSucceeds(getDocs(query(collection(captainDb, 'teamRoster'), where('teamId', '==', 'a'))));
  await assertFails(getDocs(collection(captainDb, 'teamRoster')));
  await assertFails(getDoc(doc(captainDb, 'teamRoster', 'other')));
  await assertFails(getDoc(doc(captainDb, 'players', 'other')));
  await assertSucceeds(getDoc(doc(captainDb, 'teamRoster', 'teammate')));
  await assertFails(getDoc(doc(captainDb, 'players', 'teammate')));
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'teamRoster')));
  await assertFails(updateDoc(doc(captainDb, 'teamRoster', 'p'), { name: 'Changed' }));
  const managerDb = dbFor('manager');
  await assertFails(updateDoc(doc(managerDb, 'players', 'p'), { name: 'Unsynchronized' }));
  await assertFails(updateDoc(doc(managerDb, 'teamRoster', 'p'), { phone: 'private' }));
  await assertFails(updateDoc(doc(managerDb, 'teamRoster', 'p'), { name: 'Unsynchronized' }));
  const batch = writeBatch(managerDb);
  batch.update(doc(managerDb, 'players', 'p'), { archived: true });
  batch.update(doc(managerDb, 'teamRoster', 'p'), { archived: true });
  await assertSucceeds(batch.commit());
  await assertFails(getDocs(query(collection(captainDb, 'teamRoster'), where('teamId', '==', 'a'))));
  const restore = writeBatch(managerDb);
  restore.update(doc(managerDb, 'players', 'p'), { archived: false });
  restore.update(doc(managerDb, 'teamRoster', 'p'), { archived: false });
  await assertSucceeds(restore.commit());
});

test('player creation and deletion require the matching roster projection', async () => {
  const db = dbFor('manager');
  const player = { name: 'New Player', number: '9', phone: 'private', teamId: 'a' };
  await assertFails(setDoc(doc(db, 'players', 'new-player'), player));
  const create = writeBatch(db);
  create.set(doc(db, 'players', 'new-player'), player);
  create.set(doc(db, 'teamRoster', 'new-player'), rosterEntry(player));
  await addRosterVersion(create, db, 'manager');
  await assertSucceeds(create.commit());
  const partialDelete = writeBatch(db);
  partialDelete.delete(doc(db, 'players', 'new-player'));
  await assertFails(partialDelete.commit());
  const remove = writeBatch(db);
  remove.delete(doc(db, 'players', 'new-player'));
  remove.delete(doc(db, 'teamRoster', 'new-player'));
  await assertSucceeds(remove.commit());
});
test('RSVP cannot impersonate another player or target an unrelated team', async () => {
  const data = { gameId: 'g', playerId: 'p', playerName: 'Player', teamId: 'a', status: 'going', ...rsvpSchedule(game) };
  await assertSucceeds(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), data));
  await assertSucceeds(setDoc(doc(dbFor('parent'), 'rsvps', 'g_p'), { ...data, status: 'maybe' }));
  await assertSucceeds(getDocs(query(collection(dbFor('parent'), 'rsvps'), where('playerId', 'in', ['p']))));
  await assertFails(setDoc(doc(dbFor('other'), 'rsvps', 'g_p'), data));
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), { ...data, teamId: 'b' }));
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'cancelled_p'), { ...data, gameId: 'cancelled' }));
  await assertFails(setDoc(doc(dbFor('archived'), 'rsvps', 'g_archived'), { ...data, playerId: 'archived' }));
  for (const stale of [{ gameDate: '2026-09-26' }, { gameTime: '20:00' }, { gameFieldId: 'other' }]) {
    await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), { ...data, ...stale }));
  }
  const { gameDate, gameTime, gameFieldId, ...legacy } = data;
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), legacy));
  const scheduleDb = dbFor('admin');
  const scheduleBatch = writeBatch(scheduleDb);
  scheduleBatch.update(doc(scheduleDb, 'games', 'g'), { time: '20:00' });
  scheduleBatch.set(doc(scheduleDb, 'config', 'scheduleRevision'), { revision: 1, updatedBy: 'admin' });
  await assertSucceeds(scheduleBatch.commit());
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), data));
  await assertSucceeds(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), { ...data, gameTime: '20:00' }));
});
test('schedule writes require a matching revision advance and stale batches fail', async () => {
  const db = dbFor('admin');
  await assertFails(setDoc(doc(db, 'games', 'new-game'), game));
  await assertFails(updateDoc(doc(db, 'games', 'g'), { time: '21:00' }));
  const stale = writeBatch(db);
  stale.set(doc(db, 'games', 'new-game'), game);
  stale.set(doc(db, 'config', 'scheduleRevision'), { revision: 1, updatedBy: 'admin' });
  await assertFails(stale.commit());
  const fresh = writeBatch(db);
  fresh.set(doc(db, 'games', 'new-game'), game);
  fresh.set(doc(db, 'config', 'scheduleRevision'), { revision: 2, updatedBy: 'admin' });
  await assertSucceeds(fresh.commit());
  const reset = writeBatch(db); reset.delete(doc(db, 'config', 'scheduleRevision'));
  await assertFails(reset.commit());
});

test('fields and season settings require the shared schedule revision', async () => {
  const db = dbFor('admin');
  await assertFails(setDoc(doc(db, 'fields', 'main'), { name: 'Main' }));
  await assertFails(setDoc(doc(db, 'config', 'schedule'), { gameDuration: 90 }));
  const fields = writeBatch(db);
  fields.set(doc(db, 'fields', 'main'), { name: 'Main', availableDays: [0, 6], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' });
  fields.set(doc(db, 'config', 'scheduleRevision'), { revision: 3, updatedBy: 'admin' });
  await assertSucceeds(fields.commit());
  const stale = writeBatch(db);
  stale.set(doc(db, 'config', 'schedule'), { gameDuration: 90 });
  stale.set(doc(db, 'config', 'scheduleRevision'), { revision: 3, updatedBy: 'admin' });
  await assertFails(stale.commit());
  const fresh = writeBatch(db);
  fresh.set(doc(db, 'config', 'schedule'), { gameDuration: 90, bufferMinutes: 15, rounds: 1, startDate: '2026-01-01', endDate: '2026-12-31' });
  fresh.set(doc(db, 'config', 'scheduleRevision'), { revision: 4, updatedBy: 'admin' });
  await assertSucceeds(fresh.commit());
});

test('organizer season writes enforce date and numeric bounds at the database boundary', async () => {
  const db = dbFor('admin');
  const valid = { gameDuration: 90, bufferMinutes: 15, rounds: 1, startDate: '2024-02-29', endDate: '2025-03-01' };
  const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const patch of [{ extra: true }, { gameDuration: 0 }, { gameDuration: '90' }, { gameDuration: 1441 }, { bufferMinutes: -1 }, { bufferMinutes: 1441 }, { rounds: 0 }, { rounds: 21 }, { rounds: 1.5 }, { startDate: '2023-02-29' }, { startDate: '2024-02-30' }, { startDate: '2024-13-01' }, { endDate: '2024-01-01' }, { endDate: '2025-03-02' }]) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'config', 'schedule'), { ...valid, ...patch });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(batch.commit());
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'config', 'schedule'), valid);
  batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
  await assertSucceeds(batch.commit());
});

test('new games cannot inject scores or reference missing teams and fields', async () => {
  const db = dbFor('admin');
  const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const patch of [{ status: 'completed', homeScore: 5, awayScore: 1 }, { homeScore: 0 }, { scoreRevision: 1 }, { bases: { first: true } }, { homeTeamId: 'missing' }, { awayTeamId: 'a' }, { fieldId: 'missing' }, { date: '2026-02-30' }, { time: '25:00' }, { durationMinutes: 0 }, { durationMinutes: '90' }, { locked: 'yes' }, { extra: true }, { homeName: '' }]) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'games', 'validated-new'), { ...game, ...patch });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(batch.commit());
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'games', 'validated-new'), { ...game, homeScore: null, awayScore: null });
  batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
  await assertSucceeds(batch.commit());
});

test('existing game edits validate changed schedule fields and reject unknown data', async () => {
  const db = dbFor('admin');
  const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const patch of [{ homeTeamId: 'missing' }, { awayTeamId: 'a' }, { fieldId: 'missing' }, { fieldId: deleteField() }, { date: '2026-02-30' }, { date: null }, { date: deleteField() }, { time: '25:00' }, { durationMinutes: 0 }, { durationMinutes: '90' }, { locked: 'yes' }, { extra: true }, { homeName: '' }, { awayName: ' ' }, { fieldName: 42 }, { status: 'invented' }]) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', 'validated-new'), patch);
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(batch.commit());
  }
  const batch = writeBatch(db);
  batch.update(doc(db, 'games', 'validated-new'), { date: '2026-09-26', time: '19:30', durationMinutes: 120, locked: true, homeName: 'Home updated', status: 'cancelled' });
  batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
  await assertSucceeds(batch.commit());
});

test('valid reference edits and legacy schedule repairs remain possible', async () => {
  const db = dbFor('admin');
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'games', 'legacy-edit'), { ...game, fieldId: 'old-field', time: 'legacy-time', durationMinutes: '90', oldMetadata: 'preserved' });
    await setDoc(doc(context.firestore(), 'teams', 'replacement'), { name: 'Replacement' });
  });
  let revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const patch of [{ time: '20:00' }, { durationMinutes: 90 }, { fieldId: 'main' }, { homeTeamId: 'replacement', homeName: 'Replacement' }]) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', 'legacy-edit'), patch);
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: ++revision, updatedBy: 'admin' });
    await assertSucceeds(batch.commit());
  }
});

test('new and changed staff assignments require valid records while unassignment remains available', async () => {
  const db = dbFor('admin');
  let revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const patch of [{ umpireId: 'missing' }, { scorekeeperId: 'missing' }, { scorekeeperId: 'player' }, { scorekeeperId: '' }, { umpireId: 42 }]) {
    for (const create of [false, true]) {
      const batch = writeBatch(db);
      if (create) batch.set(doc(db, 'games', 'bad-assignment'), { ...game, ...patch });
      else batch.update(doc(db, 'games', 'validated-new'), patch);
      batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
      await assertFails(batch.commit());
    }
  }
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'umpires', 'valid-umpire'), { name: 'Official' }));
  for (const patch of [{ umpireId: 'valid-umpire', scorekeeperId: 'other' }, { umpireId: null, scorekeeperId: null }]) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', 'validated-new'), patch);
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: ++revision, updatedBy: 'admin' });
    await assertSucceeds(batch.commit());
  }
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'games', 'validated-new'), { scorekeeperId: 'former-scorekeeper' }));
  const unchanged = writeBatch(db);
  unchanged.update(doc(db, 'games', 'validated-new'), { time: '19:00' });
  unchanged.set(doc(db, 'config', 'scheduleRevision'), { revision: ++revision, updatedBy: 'admin' });
  await assertSucceeds(unchanged.commit());
});

test('organizer field writes reject malformed scheduling data even with a valid revision', async () => {
  const db = dbFor('admin');
  const valid = { name: 'Validated', availableDays: [0, 6], openTime: '08:00', closeTime: '22:00', hasLights: false, zipCode: '02108' };
  const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const patch of [{ name: ' ' }, { extra: true }, { openTime: '24:00' }, { closeTime: '07:00' }, { availableDays: [] }, { availableDays: [7] }, { availableDays: ['0'] }, { availableDays: [0, 0] }, { hasLights: 'yes' }, { zipCode: '' }, { zipCode: '1234' }]) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'fields', 'validated'), { ...valid, ...patch });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(batch.commit());
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'fields', 'validated'), valid);
  batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
  await assertSucceeds(batch.commit());
});

test('admin can assign links while other roles cannot; unknown collections deny access', async () => {
  await assertSucceeds(updateDoc(doc(dbFor('admin'), 'users', 'player'), { linkedTeamId: 'a' }));
  await assertFails(updateDoc(doc(dbFor('organizer'), 'users', 'player'), { role: 'siteAdmin' }));
  await assertFails(setDoc(doc(dbFor('admin'), 'unknown', 'record'), { value: 'not allowed' }));
});
test('scorekeeper can update only assigned game score fields with next revision', async () => {
  const patch = liveScoreUpdate(game, { homeScore: '1', awayScore: '0', status: 'live', inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0 }, { uid: 'scorer', role: 'scorekeeper' }, 0);
  await assertFails(updateDoc(doc(dbFor('other'), 'games', 'g'), patch));
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), { ...patch, homeTeamId: 'c' }));
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), { ...patch, balls: 4 }));
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), patch));
  const save = async (uid, next, reason = '', override = {}) => {
    const db = dbFor(uid);
    const before = (await getDoc(doc(db, 'games', 'g'))).data();
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', 'g'), next);
    batch.set(doc(db, 'scoreEvents', `g_${next.scoreRevision}`), { ...scoreHistoryEntry('g', before, next, uid, reason), recordedAt: serverTimestamp(), ...override });
    return batch.commit();
  };
  const identityDb = dbFor('admin');
  const identityRevision = (await getDoc(doc(identityDb, 'config', 'scheduleRevision'))).data().revision;
  const firstScore = { ...patch, homeTeamId: 'b', awayTeamId: 'a', scoredBy: 'admin' };
  const replaceAndScore = writeBatch(identityDb);
  replaceAndScore.update(doc(identityDb, 'games', 'g'), firstScore);
  replaceAndScore.set(doc(identityDb, 'scoreEvents', 'g_1'), { ...scoreHistoryEntry('g', game, firstScore, 'admin'), recordedAt: serverTimestamp() });
  replaceAndScore.set(doc(identityDb, 'config', 'scheduleRevision'), { revision: identityRevision + 1, updatedBy: 'admin' });
  await assertFails(replaceAndScore.commit());
  await assertSucceeds(save('scorer', patch));
  const malformed = { first: 'occupied', second: false, third: false };
  const scorerDb = dbFor('scorer');
  const bad = writeBatch(scorerDb);
  bad.update(doc(scorerDb, 'games', 'g'), { ...patch, bases: malformed, scoreRevision: 2 });
  const validEntry = scoreHistoryEntry('g', { ...game, ...patch }, { ...patch, scoreRevision: 2 }, 'scorer');
  bad.set(doc(scorerDb, 'scoreEvents', 'g_2'), { ...validEntry, after: { ...validEntry.after, bases: malformed }, recordedAt: serverTimestamp() });
  await assertFails(bad.commit());
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), patch));
  await assertSucceeds(save('scorer', { ...patch, scoreRevision: 2, status: 'completed' }));
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), { ...patch, scoreRevision: 3 }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'games', 'g'), { homeScore: 2 }));
  const correction = { ...patch, homeScore: 2, scoreRevision: 3, scoredBy: 'admin', status: 'completed' };
  await assertFails(save('admin', correction, 'Correction', { after: { homeScore: 99 } }));
  await assertFails(save('admin', correction, 'Correction', { reason: '   ' }));
  await assertSucceeds(save('admin', { ...patch, homeScore: 2, scoreRevision: 3, scoredBy: 'admin', status: 'completed' }, 'Corrected scorebook total'));
  await assertFails(updateDoc(doc(dbFor('admin'), 'scoreEvents', 'g_1'), { reason: 'Rewritten' }));
  await assertFails(getDoc(doc(dbFor('other'), 'scoreEvents', 'g_1')));
  await assertSucceeds(getDocs(query(collection(dbFor('scorer'), 'scoreEvents'), where('gameId', '==', 'g'))));
});

test('unallocated runs move into one inning with unchanged totals and immutable audit history', async () => {
  for (const [uid, status] of [['admin', 'completed'], ['scorer', 'live']]) {
    const id = `allocation-${uid}`, db = dbFor(uid);
    const before = { ...game, status, homeScore: 5, awayScore: 4, inning: 7 };
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'games', id), before));
    const patch = { ...inningScoreUpdate(before, { inning: 2, home: 2, away: 1, allocate: true }, 0), scoredBy: uid };
    const save = (changes, reason = 'Allocated from original scorebook') => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'games', id), changes);
      batch.set(doc(db, 'scoreEvents', `${id}_1`), { ...scoreHistoryEntry(id, before, changes, uid, reason), recordedAt: serverTimestamp() });
      return batch.commit();
    };
    for (const invalid of [
      { ...patch, homeScore: 6 },
      { ...patch, scoreCarry: { home: 6, away: 3 } },
      { ...patch, scoreCarry: { home: -1, away: 3 } },
      { ...patch, lineScore: { '2': { home: 3, away: 1 } } },
      { ...patch, lineScore: { ...patch.lineScore, '3': { home: 1, away: 0 } } },
    ]) await assertFails(save(invalid));
    await assertSucceeds(save(patch));
    const saved = (await getDoc(doc(db, 'games', id))).data();
    assert.equal(saved.homeScore, 5); assert.equal(saved.awayScore, 4);
    assert.deepEqual(saved.scoreCarry, { home: 3, away: 3 });
    assert.deepEqual((await getDoc(doc(db, 'scoreEvents', `${id}_1`))).data().after.lineScore['2'], { home: 2, away: 1 });
  }
});

test('organizer scoring enforces counter bounds even with matching history', async () => {
  const db = dbFor('admin');
  const before = { ...game, status: 'live', homeScore: 0, awayScore: 0 };
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'games', 'counter-check'), before));
  for (const invalid of [{ inning: 0 }, { inning: 100 }, { inning: 1.5 }, { half: 'middle' }, { balls: 4 }, { strikes: 3 }, { outs: 3 }, { balls: '1' }]) {
    const patch = { homeScore: 1, awayScore: 0, scoreRevision: 1, scoredBy: 'admin', ...invalid };
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', 'counter-check'), patch);
    batch.set(doc(db, 'scoreEvents', 'counter-check_1'), { ...scoreHistoryEntry('counter-check', before, patch, 'admin'), recordedAt: serverTimestamp() });
    await assertFails(batch.commit());
  }
  const patch = { homeScore: 1, awayScore: 0, scoreRevision: 1, scoredBy: 'admin', inning: 2, half: 'bottom', balls: 3, strikes: 2, outs: 2 };
  const batch = writeBatch(db);
  batch.update(doc(db, 'games', 'counter-check'), patch);
  batch.set(doc(db, 'scoreEvents', 'counter-check_1'), { ...scoreHistoryEntry('counter-check', before, patch, 'admin'), recordedAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
});

test('game lifecycle prevents backward score transitions and preserves unscored rescheduling', async () => {
  const db = dbFor('admin');
  let revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  const cases = [
    [{ status: 'live', homeScore: 0, awayScore: 0 }, 'scheduled'],
    [{ status: 'live', homeScore: 0, awayScore: 0 }, 'cancelled'],
    [{ status: 'completed', homeScore: 1, awayScore: 0 }, 'scheduled'],
    [{ status: 'completed', homeScore: 1, awayScore: 0 }, 'cancelled'],
    [{ status: 'completed', homeScore: 1, awayScore: 0 }, 'live'],
    [{ status: 'cancelled', scoreRevision: 1 }, 'scheduled'],
    [{ status: 'scheduled', homeScore: 0 }, 'cancelled'],
  ];
  for (const [index, [state, status]] of cases.entries()) {
    const id = `lifecycle-${index}`;
    const before = { ...game, ...state };
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'games', id), before));
    const patch = { status, homeScore: before.homeScore ?? 0, awayScore: before.awayScore ?? 0, scoreRevision: (before.scoreRevision ?? 0) + 1, scoredBy: 'admin' };
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', id), patch);
    batch.set(doc(db, 'scoreEvents', `${id}_${patch.scoreRevision}`), { ...scoreHistoryEntry(id, before, patch, 'admin', 'Reopening attempt'), recordedAt: serverTimestamp() });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(batch.commit());
    const statusOnly = writeBatch(db);
    statusOnly.update(doc(db, 'games', id), { status });
    statusOnly.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(statusOnly.commit());
  }
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'games', 'reschedulable'), game));
  for (const status of ['cancelled', 'scheduled']) {
    await assertFails(updateDoc(doc(db, 'games', 'reschedulable'), { status }));
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', 'reschedulable'), { status });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: ++revision, updatedBy: 'admin' });
    await assertSucceeds(batch.commit());
  }
});

test('organizers cannot replace teams or delete games after scoring starts', async () => {
  const db = dbFor('admin');
  const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const [index, state] of [{ status: 'live' }, { status: 'completed' }, { status: 'cancelled', scoreRevision: 1 }, { status: 'scheduled', homeScore: 0 }].entries()) {
    const id = `identity-${index}`;
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'games', id), { ...game, ...state }));
    for (const remove of [false, true]) {
      const batch = writeBatch(db);
      if (remove) batch.delete(doc(db, 'games', id));
      else batch.update(doc(db, 'games', id), { homeTeamId: 'b', awayTeamId: 'a' });
      batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
      await assertFails(batch.commit());
    }
  }
  const batch = writeBatch(db);
  batch.update(doc(db, 'games', 'validated-new'), { homeTeamId: 'b', awayTeamId: 'a' });
  batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
  await assertSucceeds(batch.commit());
});

test('game rules snapshots require the current exact saved profile and a schedule revision', async () => {
  const db = dbFor('admin');
  const profile = nextRulesProfile(null, leagueRuleValues, 0);
  await setDoc(doc(db, 'ruleProfiles', 'game-rules'), profile);
  const snapshot = gameRulesSnapshot(game, 'game-rules', profile);
  const create = async (id, rulesSnapshot, uid = 'admin') => {
    const client = dbFor(uid), batch = writeBatch(client);
    const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
    batch.set(doc(client, 'games', id), { ...game, rulesSnapshot });
    batch.set(doc(client, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: uid });
    return batch.commit();
  };
  for (const rulesSnapshot of [null, { ...snapshot, profileId: 'missing' }, { ...snapshot, revision: 2 },
    { ...snapshot, name: 'Forged name' }, { ...snapshot, rules: { ...snapshot.rules, innings: 9 } }, { ...snapshot, extra: true }]) {
    await assertFails(create('invalid-rules-game', rulesSnapshot));
  }
  for (const uid of ['scorer', 'manager', 'player']) await assertFails(create(`unauthorized-rules-${uid}`, snapshot, uid));
  await assertFails(setDoc(doc(db, 'games', 'missing-schedule-marker'), { ...game, rulesSnapshot: snapshot }));
  await assertSucceeds(create('game-with-rules', snapshot));
  assert.deepEqual((await getDoc(doc(db, 'games', 'game-with-rules'))).data().rulesSnapshot, snapshot);
  await setDoc(doc(db, 'ruleProfiles', 'game-rules'), nextRulesProfile(profile, { ...leagueRuleValues, name: 'New division revision' }, 1));
  await assertFails(create('stale-profile-game', snapshot));
});

test('saved game rules remain immutable when the source profile changes', async () => {
  const db = dbFor('admin'), target = doc(db, 'games', 'game-with-rules');
  const original = (await getDoc(target)).data().rulesSnapshot;
  const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
  for (const rulesSnapshot of [deleteField(), null, { ...original, revision: 2, name: 'New division revision' }, { ...original, rules: { ...original.rules, innings: 8 } }]) {
    const batch = writeBatch(db);
    batch.update(target, { rulesSnapshot });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    await assertFails(batch.commit());
  }
  const unchanged = writeBatch(db);
  unchanged.update(target, { time: '19:00' });
  unchanged.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
  await assertSucceeds(unchanged.commit());
  assert.deepEqual((await getDoc(target)).data().rulesSnapshot, original);
  const scorer = dbFor('scorer');
  const before = (await getDoc(target)).data();
  const patch = liveScoreUpdate(before, { homeScore: '0', awayScore: '0', status: 'live', inning: 1, half: 'top', balls: 4, strikes: 3, outs: 3 }, { uid: 'scorer', role: 'scorekeeper' }, 0);
  for (const [key, value] of Object.entries({ balls: 5, strikes: 4, outs: 4 })) {
    const invalid = { ...patch, [key]: value }, batch = writeBatch(scorer);
    batch.update(doc(scorer, 'games', 'game-with-rules'), invalid);
    batch.set(doc(scorer, 'scoreEvents', 'game-with-rules_1'), { ...scoreHistoryEntry('game-with-rules', before, invalid, 'scorer'), recordedAt: serverTimestamp() });
    await assertFails(batch.commit());
  }
  const scoring = writeBatch(scorer);
  scoring.update(doc(scorer, 'games', 'game-with-rules'), patch);
  scoring.set(doc(scorer, 'scoreEvents', 'game-with-rules_1'), { ...scoreHistoryEntry('game-with-rules', before, patch, 'scorer'), recordedAt: serverTimestamp() });
  await assertSucceeds(scoring.commit());
  assert.deepEqual((await getDoc(target)).data().rulesSnapshot, original);
});

test('rules may be attached once to unscored scheduled games, never legacy scored games', async () => {
  const db = dbFor('admin');
  const saved = (await getDoc(doc(db, 'ruleProfiles', 'game-rules'))).data();
  const snapshot = gameRulesSnapshot(game, 'game-rules', saved);
  const states = [{}, { status: 'live' }, { status: 'completed' }, { status: 'cancelled' },
    { scoreRevision: 1 }, { homeScore: 0 }, { lineScore: {} }];
  for (const [i, state] of states.entries()) {
    const id = `attach-rules-${i}`;
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'games', id), { ...game, ...state }));
    const revision = (await getDoc(doc(db, 'config', 'scheduleRevision'))).data().revision;
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', id), { rulesSnapshot: snapshot });
    batch.set(doc(db, 'config', 'scheduleRevision'), { revision: revision + 1, updatedBy: 'admin' });
    if (i === 0) await assertSucceeds(batch.commit());
    else await assertFails(batch.commit());
  }
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), { rulesSnapshot: snapshot }));
});

test('invitation creation is admin-only and cannot grant siteAdmin', async () => {
  const invite = { email: 'recipient@example.test', role: 'parent', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: ['p'], status: 'pending', createdBy: 'admin', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
  await assertFails(setDoc(doc(dbFor('player'), 'invitations', 'unauthorized'), invite));
  await assertFails(setDoc(doc(dbFor('admin'), 'invitations', 'elevated'), { ...invite, role: 'siteAdmin' }));
  await assertFails(setDoc(doc(dbFor('admin'), 'invitations', 'too-long'), { ...invite, expiresAt: Timestamp.fromMillis(Date.now() + 8 * 86400000) }));
  await assertSucceeds(setDoc(doc(dbFor('admin'), 'invitations', 'parent-invite'), invite));
  await assertSucceeds(setDoc(doc(dbFor('admin'), 'invitations', 'revocation-check'), invite));
  await assertSucceeds(updateDoc(doc(dbFor('admin'), 'invitations', 'revocation-check'), { status: 'revoked' }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'invitations', 'revocation-check'), { status: 'pending' }));
  await assertFails(getDoc(doc(dbFor('other'), 'invitations', 'parent-invite')));
  await assertFails(getDocs(collection(dbFor('player'), 'invitations')));
});

test('invitation creation validates role-specific links and current single-player records', async () => {
  const db = dbFor('admin');
  const base = { email: 'linked@example.test', role: 'captain', linkedTeamId: 'a', linkedPlayerId: 'p', linkedPlayerIds: [], status: 'pending', createdBy: 'admin', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
  for (const patch of [{ linkedPlayerId: 'missing' }, { linkedPlayerId: 'archived' }, { linkedTeamId: 'b' }, { role: 'teamManager', linkedPlayerId: null, linkedTeamId: 'missing' }, { role: 'scorekeeper' }, { role: 'parent', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] }, { role: 'parent', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: ['p', 'p'] }]) {
    await assertFails(setDoc(doc(db, 'invitations', 'invalid-links'), { ...base, ...patch }));
  }
  await assertSucceeds(setDoc(doc(db, 'invitations', 'valid-captain'), base));
});

test('stale manager and roster invitations cannot grant access until their links are repaired', async () => {
  const adminDb = dbFor('admin');
  for (const kind of ['archived', 'moved', 'deleted-player', 'deleted-team', 'manager']) {
    const uid = `stale-${kind}`, teamId = `invite-team-${kind}`, playerId = `invite-player-${kind}`;
    const original = { name: 'Invite player', teamId, archived: false };
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'teams', teamId), { name: 'Invite team' });
      await setDoc(doc(context.firestore(), 'players', playerId), original);
      await setDoc(doc(context.firestore(), 'users', uid), profile(uid, 'player'));
    });
    const invite = { email: `${uid}@example.test`, role: kind === 'manager' ? 'teamManager' : 'captain', linkedTeamId: teamId, linkedPlayerId: kind === 'manager' ? null : playerId, linkedPlayerIds: [], status: 'pending', createdBy: 'admin', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) };
    await assertSucceeds(setDoc(doc(adminDb, 'invitations', uid), invite));
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      if (kind === 'archived') await updateDoc(doc(db, 'players', playerId), { archived: true });
      if (kind === 'moved') await updateDoc(doc(db, 'players', playerId), { teamId: 'b' });
      if (kind === 'deleted-player') await deleteDoc(doc(db, 'players', playerId));
      if (kind === 'deleted-team' || kind === 'manager') await deleteDoc(doc(db, 'teams', teamId));
    });
    const recipient = env.authenticatedContext(uid, { email: invite.email, email_verified: true }).firestore();
    const accept = () => {
      const batch = writeBatch(recipient);
      batch.update(doc(recipient, 'users', uid), invitationProfilePatch(uid, invite));
      batch.update(doc(recipient, 'invitations', uid), { status: 'accepted', acceptedBy: uid, acceptedAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(accept());
    assert.equal((await getDoc(doc(recipient, 'users', uid))).data().role, 'player');
    assert.equal((await getDoc(doc(recipient, 'invitations', uid))).data().status, 'pending');
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'teams', teamId), { name: 'Invite team' });
      await setDoc(doc(context.firestore(), 'players', playerId), original);
    });
    await assertSucceeds(accept());
  }
});

test('invitation acceptance requires verified matching email and atomic consumption', async () => {
  const invite = { role: 'parent', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: ['p'] };
  const recipient = env.authenticatedContext('recipient', { email: 'recipient@example.test', email_verified: true }).firestore();
  const unverified = env.authenticatedContext('recipient', { email: 'recipient@example.test', email_verified: false }).firestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'recipient'), profile('recipient', 'player'));
  });
  const patch = invitationProfilePatch('parent-invite', invite);
  const consume = { status: 'accepted', acceptedBy: 'recipient', acceptedAt: serverTimestamp() };
  const accept = db => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', 'recipient'), patch);
    batch.update(doc(db, 'invitations', 'parent-invite'), consume);
    return batch.commit();
  };
  await assertFails(updateDoc(doc(recipient, 'users', 'recipient'), patch));
  await assertFails(updateDoc(doc(recipient, 'invitations', 'parent-invite'), consume));
  await assertFails(accept(unverified));
  await assertFails(accept(env.authenticatedContext('recipient', { email: 'wrong@example.test', email_verified: true }).firestore()));
  const forged = writeBatch(recipient);
  forged.update(doc(recipient, 'users', 'recipient'), { ...patch, role: 'siteAdmin' });
  forged.update(doc(recipient, 'invitations', 'parent-invite'), consume);
  await assertFails(forged.commit());
  await assertSucceeds(accept(recipient));
  await assertFails(accept(recipient));
  await assertSucceeds(getDoc(doc(recipient, 'players', 'p')));
});

test('expired and revoked invitations cannot update a profile', async () => {
  const recipient = env.authenticatedContext('expired', { email: 'expired@example.test', email_verified: true }).firestore();
  for (const [id, status, expiresAt] of [['expired', 'pending', Timestamp.fromMillis(1)], ['revoked', 'revoked', Timestamp.fromMillis(Date.now() + 3600000)]]) {
    const invite = { email: 'expired@example.test', role: 'scorekeeper', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [], status, expiresAt };
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users', 'expired'), profile('expired', 'player'));
      await setDoc(doc(context.firestore(), 'invitations', id), invite);
    });
    const batch = writeBatch(recipient);
    batch.update(doc(recipient, 'users', 'expired'), invitationProfilePatch(id, invite));
    batch.update(doc(recipient, 'invitations', id), { status: 'accepted', acceptedBy: 'expired', acceptedAt: serverTimestamp() });
    await assertFails(batch.commit());
  }
});
