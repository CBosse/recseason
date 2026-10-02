import '../scripts/seed-local.mjs';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, applyActionCode, reload } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, query, where, documentId, getDocs, doc, setDoc, getDoc, runTransaction, serverTimestamp, Timestamp, onSnapshot, updateDoc } from 'firebase/firestore';
import { profileSession } from '../profile-session.mjs';
import { checkedRosterUpdate, checkedArchiveUpdate } from '../roster-editor.mjs';
import { rosterEntry } from '../team-roster.mjs';
import { rosterRevision, nextRosterRevision } from '../roster-version.mjs';
import { scoreHistoryEntry } from '../score-history.mjs';
import { inningScoreUpdate } from '../inning-scores.mjs';
import { newPlayerProfile } from '../accounts.mjs';
import { invitationDetails, invitationProfilePatch } from '../invitations.mjs';
import { liveScoreUpdate } from '../live-scoring.mjs';
import { standings } from '../results.mjs';
import { rsvpSchedule } from '../rsvps.mjs';
import { attendanceUpdate } from '../attendance.mjs';
import { scheduleRevision, nextScheduleRevision } from '../schedule-version.mjs';

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
  const revisionRef = doc(admin.db, 'config', 'scheduleRevision');
  const expectedRevision = scheduleRevision((await getDoc(revisionRef)).data());
  const baseGame = (await getDoc(doc(admin.db, 'games', 'demo-game'))).data();
  const publish = id => runTransaction(admin.db, async tx => {
    const current = await tx.get(revisionRef);
    const next = nextScheduleRevision(current.data(), expectedRevision, admin.user.uid);
    tx.set(doc(admin.db, 'games', id), { ...baseGame, date: '2026-12-01', time: '20:00' });
    tx.set(revisionRef, next);
  });
  const publications = await Promise.allSettled([publish('concurrent-a'), publish('concurrent-b')]);
  assert.equal(publications.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(publications.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await getDoc(revisionRef)).data().revision, expectedRevision + 1);
  console.log('PASS: concurrent schedule publications admit one writer and reject the stale snapshot.');
  const beforeSettings = (await getDoc(revisionRef)).data().revision;
  await runTransaction(admin.db, async tx => {
    const current = await tx.get(revisionRef);
    tx.update(doc(admin.db, 'fields', 'main'), { openTime: '09:00' });
    tx.update(doc(admin.db, 'config', 'schedule'), { bufferMinutes: 20 });
    tx.set(revisionRef, nextScheduleRevision(current.data(), beforeSettings, admin.user.uid));
  });
  assert.equal((await getDoc(doc(admin.db, 'fields', 'main'))).data().openTime, '09:00');
  assert.equal((await getDoc(doc(admin.db, 'config', 'schedule'))).data().bufferMinutes, 20);
  assert.throws(() => nextScheduleRevision({ revision: beforeSettings + 1 }, beforeSettings, admin.user.uid), /another session/);
  console.log('PASS: field and season updates advance the same publication revision.');
  const inviteApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-recseason' }, 'invited'); apps.push(inviteApp);
  const inviteAuth = getAuth(inviteApp); connectAuthEmulator(inviteAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const inviteDb = getFirestore(inviteApp, 'recseason'); connectFirestoreEmulator(inviteDb, '127.0.0.1', 8180);
  const { user: invited } = await createUserWithEmailAndPassword(inviteAuth, 'invited@recseason.test', 'LocalDemo123!');
  await setDoc(doc(inviteDb, 'users', invited.uid), newPlayerProfile(invited, 'Invited Parent'));
  const invitation = invitationDetails({ email: invited.email, role: 'parent', linkedPlayerIds: ['child'] }, { teams: [], players: [{ id: 'child', teamId: 'away' }] });
  await setDoc(doc(admin.db, 'invitations', 'workflow-invite'), { ...invitation, status: 'pending', createdBy: admin.user.uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) });
  await sendEmailVerification(invited);
  const codesResponse = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-recseason/oobCodes');
  assert.equal(codesResponse.ok, true);
  const codes = await codesResponse.json();
  const code = codes.oobCodes.find(item => item.email === invited.email && item.requestType === 'VERIFY_EMAIL');
  assert.ok(code);
  await applyActionCode(inviteAuth, code.oobCode); await reload(invited); await invited.getIdToken(true);
  assert.equal(invited.emailVerified, true);
  await runTransaction(inviteDb, async transaction => {
    const ref = doc(inviteDb, 'invitations', 'workflow-invite');
    const snapshot = await transaction.get(ref);
    transaction.update(doc(inviteDb, 'users', invited.uid), invitationProfilePatch(ref.id, snapshot.data()));
    transaction.update(ref, { status: 'accepted', acceptedBy: invited.uid, acceptedAt: serverTimestamp() });
  });
  assert.equal((await getDoc(doc(inviteDb, 'users', invited.uid))).data().role, 'parent');
  assert.equal((await getDoc(doc(inviteDb, 'players', 'child'))).exists(), true);
  console.log('PASS: invitation creation, verification, atomic acceptance and linked-child access.');
  assert.equal((await getDocs(collection(admin.db, 'players'))).size, 3);
  const player = await session('player');
  await assert.rejects(getDoc(doc(player.db, 'players', 'child')), error => error.code === 'permission-denied');
  await assert.rejects(setDoc(doc(player.db, 'users', player.user.uid), { role: 'siteAdmin' }, { merge: true }), error => error.code === 'permission-denied');
  assert.equal((await getDocs(query(collection(player.db, 'players'), where(documentId(), 'in', ['player'])))).size, 1);
  const confirmedSchedule = rsvpSchedule((await getDoc(doc(player.db, 'games', 'demo-game'))).data());
  await setDoc(doc(player.db, 'rsvps', 'demo-game_player'), { gameId: 'demo-game', playerId: 'player', playerName: 'Demo Player', teamId: 'home', status: 'going', ...confirmedSchedule });
  const parent = await session('parent');
  await setDoc(doc(parent.db, 'rsvps', 'demo-game_child'), { gameId: 'demo-game', playerId: 'child', playerName: 'Demo Child', teamId: 'away', status: 'maybe', ...confirmedSchedule });
  assert.equal((await getDocs(query(collection(parent.db, 'rsvps'), where('playerId', 'in', ['child'])))).size, 1);
  const manager = await session('teamManager');
  assert.equal((await getDocs(query(collection(manager.db, 'players'), where('teamId', '==', 'home')))).size, 2);
  const originalPlayer = (await getDoc(doc(manager.db, 'players', 'player'))).data();
  const editPlayer = (session, name) => runTransaction(session.db, async tx => {
    const ref = doc(session.db, 'players', 'player');
    const fresh = await tx.get(ref);
    const patch = checkedRosterUpdate('player', originalPlayer, fresh.data(), { ...originalPlayer, name });
    tx.update(ref, patch);
    tx.set(doc(session.db, 'teamRoster', 'player'), rosterEntry({ ...fresh.data(), ...patch }));
  });
  const edits = await Promise.allSettled([editPlayer(manager, 'Manager edit'), editPlayer(admin, 'Admin edit')]);
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(edits.filter(result => result.status === 'rejected').length, 1);
  assert.match(edits.find(result => result.status === 'rejected').reason.message, /another session/);
  const savedPlayer = (await getDoc(doc(manager.db, 'players', 'player'))).data();
  assert.deepEqual((await getDoc(doc(manager.db, 'teamRoster', 'player'))).data(), rosterEntry(savedPlayer));
  console.log('PASS: concurrent roster edits preserve one winner and its atomic contact-free projection.');
  const scorer = await session('scorekeeper');
  const captain = await session('captain');
  const captainRoster = await getDocs(query(collection(captain.db, 'teamRoster'), where('teamId', '==', 'home')));
  assert.equal(captainRoster.size, 2);
  await assert.rejects(getDoc(doc(captain.db, 'players', 'player')), error => error.code === 'permission-denied');
  const attendanceRef = doc(captain.db, 'attendance', 'demo-game_player');
  await runTransaction(captain.db, async tx => {
    const gameDoc = await tx.get(doc(captain.db, 'games', 'demo-game'));
    const playerDoc = await tx.get(doc(captain.db, 'teamRoster', 'player'));
    const previous = await tx.get(attendanceRef);
    tx.set(attendanceRef, { ...attendanceUpdate({ id: gameDoc.id, ...gameDoc.data() }, { id: playerDoc.id, ...playerDoc.data() }, 'present', previous.data(), captain.user.uid), checkedAt: serverTimestamp() });
  });
  assert.equal((await getDoc(attendanceRef)).data().status, 'present');
  console.log('PASS: captain reads contact-free team roster and persists attendance.');
  await assert.rejects(setDoc(doc(scorer.db, 'games', 'unassigned'), { status: 'scheduled' }), error => error.code === 'permission-denied');
  const score = { homeScore: 3, awayScore: 1, inning: 7, half: 'bottom', balls: 0, strikes: 0, outs: 2, bases: { first: true, second: false, third: true } };
  for (const [revision, status] of [[0, 'live'], [1, 'completed']]) {
    await runTransaction(scorer.db, async tx => {
      const ref = doc(scorer.db, 'games', 'demo-game');
      const snapshot = await tx.get(ref);
      const patch = liveScoreUpdate(snapshot.data(), { ...score, status }, scorer.user, revision);
      tx.update(ref, patch);
      tx.set(doc(scorer.db, 'scoreEvents', `demo-game_${patch.scoreRevision}`), { ...scoreHistoryEntry('demo-game', snapshot.data(), patch, scorer.user.uid), recordedAt: serverTimestamp() });
    });
  }
  const games = (await getDocs(collection(admin.db, 'games'))).docs.map(d => ({ id: d.id, ...d.data() }));
  const teams = (await getDocs(collection(admin.db, 'teams'))).docs.map(d => ({ id: d.id, ...d.data() }));
  assert.equal(games.find(game => game.id === 'demo-game').status, 'completed');
  assert.deepEqual(games.find(game => game.id === 'demo-game').bases, score.bases);
  assert.equal((await getDocs(query(collection(scorer.db, 'scoreEvents'), where('gameId', '==', 'demo-game')))).size, 2);
  const table = standings(teams, games);
  assert.equal(table.find(row => row.name === 'Riverside').Pts, 3);
  console.log('PASS: authenticated admin, player, parent, manager and scorer workflows in named recseason database.');
  let stop;
  let timer;
  const profileChanged = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Live profile update timed out.')), 10000);
    stop = onSnapshot(doc(parent.db, 'users', parent.user.uid), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.hasPendingWrites || snapshot.data()?.role !== 'visitor') return;
      resolve(profileSession(parent.user, snapshot.data(), parent.user));
    }, reject);
  });
  try {
    await updateDoc(doc(admin.db, 'users', parent.user.uid), { role: 'visitor', linkedPlayerIds: [] });
    const changed = await profileChanged;
    assert.equal(changed.accessChanged, true);
    assert.deepEqual(changed.user.linkedPlayerIds, []);
    await assert.rejects(getDoc(doc(parent.db, 'players', 'child')), error => error.code === 'permission-denied');
    console.log('PASS: signed-in profile listener observes role revocation and private access is removed.');
  } finally { clearTimeout(timer); stop?.(); }
  const teamRef = doc(admin.db, 'teams', 'delete-race');
  await setDoc(teamRef, { name: 'Deletion race' });
  const rosterRef = doc(admin.db, 'config', 'rosterRevision');
  const rosterBefore = rosterRevision((await getDoc(rosterRef)).data());
  const scheduleBefore = scheduleRevision((await getDoc(revisionRef)).data());
  assert.equal((await getDocs(query(collection(admin.db, 'players'), where('teamId', '==', 'delete-race')))).empty, true);
  const removeEmptyTeam = () => runTransaction(admin.db, async tx => {
    const roster = await tx.get(rosterRef);
    const schedule = await tx.get(revisionRef);
    const team = await tx.get(teamRef);
    if (!team.exists()) throw new Error('Team removed');
    tx.set(rosterRef, nextRosterRevision(roster.data(), rosterBefore, admin.user.uid));
    tx.set(revisionRef, nextScheduleRevision(schedule.data(), scheduleBefore, admin.user.uid));
    tx.delete(teamRef);
  });
  const addPlayer = () => runTransaction(admin.db, async tx => {
    const roster = await tx.get(rosterRef);
    const team = await tx.get(teamRef);
    if (!team.exists()) throw new Error('Team removed');
    const player = { name: 'Race player', teamId: 'delete-race' };
    tx.set(rosterRef, nextRosterRevision(roster.data(), rosterRevision(roster.data()), admin.user.uid));
    tx.set(doc(admin.db, 'players', 'race-player'), player);
    tx.set(doc(admin.db, 'teamRoster', 'race-player'), rosterEntry(player));
  });
  const race = await Promise.allSettled([removeEmptyTeam(), addPlayer()]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected').length, 1);
  const remainingTeam = await getDoc(teamRef);
  const remainingPlayer = await getDoc(doc(admin.db, 'players', 'race-player'));
  assert.equal(remainingTeam.exists(), remainingPlayer.exists());
  console.log('PASS: team deletion racing player creation cannot leave a dangling player.');
  const inningGameRef = doc(admin.db, 'games', 'innings-test');
  await runTransaction(admin.db, async tx => {
    const revision = await tx.get(revisionRef);
    tx.set(inningGameRef, { ...baseGame, homeScore: null, awayScore: null, status: 'scheduled' });
    tx.set(revisionRef, nextScheduleRevision(revision.data(), scheduleRevision(revision.data()), admin.user.uid));
  });
  for (const [revision, inning, home, away] of [[0, 1, 2, 0], [1, 2, 1, 3], [2, 1, 0, 1]]) {
    await runTransaction(scorer.db, async tx => {
      const ref = doc(scorer.db, 'games', 'innings-test');
      const current = await tx.get(ref);
      const patch = { ...inningScoreUpdate(current.data(), { inning, home, away }, revision), scoredBy: scorer.user.uid, half: 'top', balls: 0, strikes: 0, outs: 0 };
      tx.update(ref, patch);
      tx.set(doc(scorer.db, 'scoreEvents', `innings-test_${patch.scoreRevision}`), { ...scoreHistoryEntry('innings-test', current.data(), patch, scorer.user.uid), recordedAt: serverTimestamp() });
    });
  }
  const inningGame = (await getDoc(inningGameRef)).data();
  assert.equal(inningGame.homeScore, 1); assert.equal(inningGame.awayScore, 4);
  assert.deepEqual(inningGame.lineScore['2'], { home: 1, away: 3 });
  await assert.rejects(runTransaction(admin.db, async tx => {
    const current = await tx.get(inningGameRef);
    const patch = { homeScore: 99, scoreRevision: 4, scoredBy: admin.user.uid };
    tx.update(inningGameRef, patch);
    tx.set(doc(admin.db, 'scoreEvents', 'innings-test_4'), { ...scoreHistoryEntry('innings-test', current.data(), patch, admin.user.uid), recordedAt: serverTimestamp() });
  }), error => error.code === 'permission-denied');
  console.log('PASS: inning scores persist, earlier innings can be corrected, and independent total tampering is denied.');
  await runTransaction(scorer.db, async tx => {
    const ref = doc(scorer.db, 'games', 'innings-test');
    const current = await tx.get(ref);
    const patch = liveScoreUpdate(current.data(), { ...current.data(), status: 'completed' }, { uid: scorer.user.uid, role: 'scorekeeper' }, 3);
    tx.update(ref, patch);
    tx.set(doc(scorer.db, 'scoreEvents', 'innings-test_4'), { ...scoreHistoryEntry('innings-test', current.data(), patch, scorer.user.uid), recordedAt: serverTimestamp() });
  });
  await runTransaction(admin.db, async tx => {
    const current = await tx.get(inningGameRef);
    const patch = { ...inningScoreUpdate(current.data(), { inning: 2, home: 2, away: 3 }, 4), scoredBy: admin.user.uid };
    tx.update(inningGameRef, patch);
    tx.set(doc(admin.db, 'scoreEvents', 'innings-test_5'), { ...scoreHistoryEntry('innings-test', current.data(), patch, admin.user.uid, 'Corrected official inning record'), recordedAt: serverTimestamp() });
  });
  const finalInnings = (await getDoc(inningGameRef)).data();
  assert.equal(finalInnings.status, 'completed');
  assert.equal(finalInnings.homeScore, 2);
  assert.equal((await getDocs(query(collection(admin.db, 'scoreEvents'), where('gameId', '==', 'innings-test')))).size, 5);
  console.log('PASS: inning-based games finalize and retain organizer corrections in immutable history.');
  const archiveRef = doc(admin.db, 'players', 'child');
  const archiveOriginal = (await getDoc(archiveRef)).data();
  const archivePlayer = () => runTransaction(admin.db, async tx => {
    const current = await tx.get(archiveRef);
    const patch = checkedArchiveUpdate(archiveOriginal, current.exists() ? current.data() : null);
    tx.update(archiveRef, patch);
    tx.set(doc(admin.db, 'teamRoster', 'child'), rosterEntry({ ...current.data(), ...patch }));
  });
  const archiveRace = await Promise.allSettled([archivePlayer(), archivePlayer()]);
  assert.equal(archiveRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(archiveRace.filter(result => result.status === 'rejected').length, 1);
  const archivedPlayer = (await getDoc(archiveRef)).data();
  assert.equal(archivedPlayer.archived, true);
  assert.deepEqual((await getDoc(doc(admin.db, 'teamRoster', 'child'))).data(), rosterEntry(archivedPlayer));
  assert.equal(archivedPlayer.teamId, archiveOriginal.teamId);
  console.log('PASS: concurrent archive confirmations admit one writer and preserve the matching roster projection.');
} finally {
  await Promise.all(apps.map(deleteApp));
}
