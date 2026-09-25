import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, documentId, setDoc, getDoc, updateDoc, collection, getDocs, query, where, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { invitationProfilePatch } from '../../invitations.mjs';
import { newPlayerProfile } from '../../accounts.mjs';
import { liveScoreUpdate } from '../../live-scoring.mjs';
import { rsvpSchedule } from '../../rsvps.mjs';
let env;
const profile = (uid, role, extra = {}) => ({ ...newPlayerProfile({ uid, email: `${uid}@example.test` }, uid), role, ...extra });
const game = { status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', scorekeeperId: 'scorer', date: '2026-09-25', time: '18:00', fieldId: 'main' };
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-recseason', firestore: { host: '127.0.0.1', port: 8180, rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, role, extra] of [['admin', 'siteAdmin'], ['organizer', 'leagueManager'], ['scorer', 'scorekeeper'], ['other', 'scorekeeper'], ['player', 'player', { linkedPlayerId: 'p' }], ['parent', 'parent', { linkedPlayerIds: ['p'] }], ['manager', 'teamManager', { linkedTeamId: 'a' }]]) await setDoc(doc(db, 'users', uid), profile(uid, role, extra));
    await setDoc(doc(db, 'games', 'g'), game);
    await setDoc(doc(db, 'games', 'cancelled'), { ...game, status: 'cancelled' });
    await setDoc(doc(db, 'players', 'p'), { name: 'Player', phone: 'private', teamId: 'a' });
    await setDoc(doc(db, 'players', 'other'), { name: 'Other', phone: 'private', teamId: 'b' });
    await setDoc(doc(db, 'players', 'archived'), { name: 'Archived', phone: '', teamId: 'a', archived: true });
    await setDoc(doc(db, 'users', 'archived'), profile('archived', 'player', { linkedPlayerId: 'archived' }));
    const { linkedPlayerIds, ...legacyAdmin } = profile('legacy-admin', 'siteAdmin');
    await setDoc(doc(db, 'users', 'legacy-admin'), legacyAdmin);
  });
});
after(async () => { await env?.cleanup(); });
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();

test('legacy admin without child links can update its profile without broadening access', async () => {
  await assertSucceeds(updateDoc(doc(dbFor('legacy-admin'), 'users', 'legacy-admin'), { displayName: 'Admin' }));
  await assertFails(updateDoc(doc(dbFor('player'), 'users', 'legacy-admin'), { linkedPlayerIds: ['p'] }));
  await assertFails(updateDoc(doc(dbFor('legacy-admin'), 'users', 'legacy-admin'), { linkedPlayerIds: 'invalid' }));
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
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'players', 'p'), { name: 'Renamed' }));
  await assertSucceeds(getDocs(query(collection(dbFor('manager'), 'players'), where('teamId', '==', 'a'))));
  await assertFails(updateDoc(doc(dbFor('manager'), 'players', 'p'), { teamId: 'b' }));
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
  await assertSucceeds(updateDoc(doc(dbFor('admin'), 'games', 'g'), { time: '20:00' }));
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), data));
  await assertSucceeds(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), { ...data, gameTime: '20:00' }));
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
  await assertSucceeds(updateDoc(doc(dbFor('scorer'), 'games', 'g'), patch));
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), patch));
  await assertSucceeds(updateDoc(doc(dbFor('scorer'), 'games', 'g'), { ...patch, scoreRevision: 2, status: 'completed' }));
  await assertFails(updateDoc(doc(dbFor('scorer'), 'games', 'g'), { ...patch, scoreRevision: 3 }));
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
