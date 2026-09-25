import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, documentId, setDoc, getDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { newPlayerProfile } from '../../accounts.mjs';
import { liveScoreUpdate } from '../../live-scoring.mjs';
let env;
const profile = (uid, role, extra = {}) => ({ ...newPlayerProfile({ uid, email: `${uid}@example.test` }, uid), role, ...extra });
const game = { status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', scorekeeperId: 'scorer' };
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
  });
});
after(async () => { await env?.cleanup(); });
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
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
  const data = { gameId: 'g', playerId: 'p', playerName: 'Player', teamId: 'a', status: 'going' };
  await assertSucceeds(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), data));
  await assertSucceeds(setDoc(doc(dbFor('parent'), 'rsvps', 'g_p'), { ...data, status: 'maybe' }));
  await assertSucceeds(getDocs(query(collection(dbFor('parent'), 'rsvps'), where('playerId', 'in', ['p']))));
  await assertFails(setDoc(doc(dbFor('other'), 'rsvps', 'g_p'), data));
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'g_p'), { ...data, teamId: 'b' }));
  await assertFails(setDoc(doc(dbFor('player'), 'rsvps', 'cancelled_p'), { ...data, gameId: 'cancelled' }));
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
