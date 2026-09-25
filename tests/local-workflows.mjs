import '../scripts/seed-local.mjs';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, query, where, documentId, getDocs, doc, setDoc, getDoc, runTransaction } from 'firebase/firestore';
import { liveScoreUpdate } from '../live-scoring.mjs';
import { standings } from '../results.mjs';

const apps = [];
async function session(role) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, role);
  apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app, 'recseason'); connectFirestoreEmulator(db, '127.0.0.1', 8180);
  const credential = await signInWithEmailAndPassword(auth, `${role.toLowerCase()}@recseason.test`, 'LocalDemo123!');
  const profile = (await getDoc(doc(db, 'users', credential.user.uid))).data();
  return { db, user: { uid: credential.user.uid, ...profile } };
}
try {
  const admin = await session('siteAdmin');
  assert.equal((await getDocs(collection(admin.db, 'players'))).size, 3);
  const player = await session('player');
  await assert.rejects(getDoc(doc(player.db, 'players', 'child')), error => error.code === 'permission-denied');
  await assert.rejects(setDoc(doc(player.db, 'users', player.user.uid), { role: 'siteAdmin' }, { merge: true }), error => error.code === 'permission-denied');
  assert.equal((await getDocs(query(collection(player.db, 'players'), where(documentId(), 'in', ['player'])))).size, 1);
  await setDoc(doc(player.db, 'rsvps', 'demo-game_player'), { gameId: 'demo-game', playerId: 'player', playerName: 'Demo Player', teamId: 'home', status: 'going' });
  const parent = await session('parent');
  await setDoc(doc(parent.db, 'rsvps', 'demo-game_child'), { gameId: 'demo-game', playerId: 'child', playerName: 'Demo Child', teamId: 'away', status: 'maybe' });
  assert.equal((await getDocs(query(collection(parent.db, 'rsvps'), where('playerId', 'in', ['child'])))).size, 1);
  const manager = await session('teamManager');
  assert.equal((await getDocs(query(collection(manager.db, 'players'), where('teamId', '==', 'home')))).size, 2);
  const scorer = await session('scorekeeper');
  await assert.rejects(setDoc(doc(scorer.db, 'games', 'unassigned'), { status: 'scheduled' }), error => error.code === 'permission-denied');
  const score = { homeScore: 3, awayScore: 1, inning: 7, half: 'bottom', balls: 0, strikes: 0, outs: 2 };
  for (const [revision, status] of [[0, 'live'], [1, 'completed']]) {
    await runTransaction(scorer.db, async tx => {
      const ref = doc(scorer.db, 'games', 'demo-game');
      const snapshot = await tx.get(ref);
      tx.update(ref, liveScoreUpdate(snapshot.data(), { ...score, status }, scorer.user, revision));
    });
  }
  const games = (await getDocs(collection(admin.db, 'games'))).docs.map(d => ({ id: d.id, ...d.data() }));
  const teams = (await getDocs(collection(admin.db, 'teams'))).docs.map(d => ({ id: d.id, ...d.data() }));
  assert.equal(games[0].status, 'completed');
  const table = standings(teams, games);
  assert.equal(table.find(row => row.name === 'Riverside').Pts, 3);
  console.log('PASS: authenticated admin, player, parent, manager and scorer workflows in named recseason database.');
} finally {
  await Promise.all(apps.map(deleteApp));
}
