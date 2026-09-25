import { newPlayerProfile } from '../accounts.mjs';

// These endpoints are deliberately fixed: this script must never seed production.
const authEndpoint = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key';
const database = 'projects/demo-recseason/databases/recseason';
const firestoreEndpoint = `http://127.0.0.1:8180/v1/${database}/documents`;
const password = 'LocalDemo123!';
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
const exists = await fetch(`${firestoreEndpoint}/config/schedule`, { headers });
if (exists.ok) throw new Error('Local demo already contains a season. Restart the emulators without imported data to reseed.');
if (exists.status !== 404) throw new Error(`Cannot verify empty local database: ${exists.status}`);

function value(data) {
  if (data === null) return { nullValue: null };
  if (typeof data === 'string') return { stringValue: data };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (typeof data === 'number') return { integerValue: String(data) };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(data).map(([key, item]) => [key, value(item)])) } };
}
const writes = [];
const add = (path, data) => writes.push({ update: { name: `${database}/documents/${path}`, fields: value(data).mapValue.fields }, currentDocument: { exists: false } });
const accounts = {};
for (const role of ['siteAdmin', 'leagueManager', 'teamManager', 'captain', 'player', 'parent', 'umpire', 'scorekeeper']) {
  const email = `${role.toLowerCase()}@recseason.test`;
  const response = await fetch(authEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Cannot create local ${role}: ${result.error?.message || response.status}`);
  accounts[role] = result.localId;
  const profile = { ...newPlayerProfile({ uid: result.localId, email }, `Demo ${role}`), role };
  if (role === 'teamManager') profile.linkedTeamId = 'home';
  if (role === 'player' || role === 'captain') profile.linkedPlayerId = role;
  if (role === 'parent') profile.linkedPlayerIds = ['child'];
  add(`users/${result.localId}`, profile);
}
add('teams/home', { name: 'Riverside', color: '#206c4b', homefield: 'Community Field' });
add('teams/away', { name: 'Northside', color: '#ad3b3b', homefield: 'Community Field' });
for (const [id, name, teamId] of [['player', 'Demo Player', 'home'], ['captain', 'Demo Captain', 'home'], ['child', 'Demo Child', 'away']]) add(`players/${id}`, { name, teamId, number: '1', phone: '' });
add('fields/main', { name: 'Community Field', availableDays: [0, 1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' });
const today = new Date().toISOString().slice(0, 10);
const end = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
add('config/schedule', { startDate: today, endDate: end, gameDuration: 90, bufferMinutes: 15, rounds: 1 });
add(`umpires/${accounts.umpire}`, { name: 'Demo Umpire', payRate: 50 });
add('games/demo-game', { date: today, time: '18:00', durationMinutes: 90, homeTeamId: 'home', homeName: 'Riverside', awayTeamId: 'away', awayName: 'Northside', fieldId: 'main', fieldName: 'Community Field', status: 'scheduled', homeScore: null, awayScore: null, locked: true, umpireId: accounts.umpire, scorekeeperId: accounts.scorekeeper });
const response = await fetch(`${firestoreEndpoint}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
if (!response.ok) throw new Error(`Local seed failed: ${await response.text()}`);
console.log('Local sample season created. Open http://127.0.0.1:8080/?emulator=1');
console.log('Accounts: siteadmin, leaguemanager, teammanager, captain, player, parent, umpire, scorekeeper @recseason.test');
console.log(`Local-only password: ${password}`);
