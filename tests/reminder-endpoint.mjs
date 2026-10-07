import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Both local emulators are required.');
assert.throws(() => openReminderRuntime('bosse-testing'));
const runtime = openReminderRuntime('demo-recseason');
const server = createServer(runtime.handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const uid = `endpoint-${Date.now()}`;
  const email = `${uid}@example.test`;
  await runtime.auth.createUser({ uid, email, password: 'Synthetic123!' });
  const login = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Synthetic123!', returnSecureToken: true }) });
  assert.equal(login.status, 200);
  const { idToken } = await login.json();
  const put = (collection, id, data) => runtime.db.collection(collection).doc(id).set(data);
  await put('users', uid, { role: 'leagueManager' });
  await put('teams', `${uid}-home`, { name: 'Home' });
  await put('teams', `${uid}-away`, { name: 'Away' });
  await put('fields', uid, { name: 'Field' });
  await put('players', uid, { name: 'Player', teamId: `${uid}-home`, archived: false });
  await put('users', `${uid}-player`, { role: 'player', linkedPlayerId: uid, email: 'controlled@example.test' });
  await put('games', uid, { status: 'scheduled', homeTeamId: `${uid}-home`, awayTeamId: `${uid}-away`, fieldId: uid, date: '2026-12-01', time: '18:00' });
  const request = token => fetch(`http://127.0.0.1:${server.address().port}/api/game-reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ gameId: uid }) });
  assert.equal((await request('invalid')).status, 401);
  const accepted = await request(idToken);
  assert.equal(accepted.status, 202); assert.equal((await accepted.json()).created, 1);
  assert.equal((await request(idToken)).status, 429);
  const clearLimit = () => runtime.db.collection('notificationLimits').doc(uid).delete();
  await clearLimit();
  assert.equal((await (await request(idToken)).json()).existing, 1);
  await clearLimit(); await put('users', uid, { role: 'player' });
  assert.equal((await request(idToken)).status, 403);
  await clearLimit(); await put('users', uid, { role: 'leagueManager' });
  await runtime.auth.updateUser(uid, { disabled: true });
  assert.equal((await request(idToken)).status, 401);
  const queued = await runtime.db.collection('notificationJobs').where('sourceId', '==', uid).get();
  assert.equal(queued.size, 1); assert.equal(queued.docs[0].data().requestedBy, uid);
  console.log('PASS: real emulator ID tokens, HTTP enqueue, durable rate limiting, deduplication, live role revocation and disabled-account rejection. No email sent.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
}
