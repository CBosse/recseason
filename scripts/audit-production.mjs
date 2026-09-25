import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Deliberately fixed to the app's named database. This script never writes remotely.
const project = 'bosse-testing';
const database = 'recseason';
const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const account = auth.getGlobalDefaultAccount();
if (!account) throw new Error('Sign in with Firebase CLI before running the audit.');
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
async function get(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Read-only audit request failed (HTTP ${response.status}).`);
  return response.json();
}
const firestore = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}`;
const metadata = await get(firestore);
const release = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore/${database}`);
const rules = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
const stamp = new Date().toISOString().replaceAll(':', '-');
const folder = `.tools/production-audit/${stamp}`;
await mkdir(folder, { recursive: true });
await writeFile(`${folder}/rules-snapshot.json`, JSON.stringify({ release, rules }, null, 2));

function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  return undefined;
}
async function documents(collection) {
  const result = [];
  let pageToken = '';
  do {
    const url = new URL(`${firestore}/documents/${collection}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await get(url);
    for (const document of page.documents || []) result.push({
      id: document.name.split('/').at(-1),
      keys: Object.keys(document.fields || {}),
      data: Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)])),
    });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return result;
}
const users = await documents('users');
const players = await documents('players');
const teams = await documents('teams');
const fields = await documents('fields');
const games = await documents('games');
const rsvps = await documents('rsvps');
const teamIds = new Set(teams.map(d => d.id));
const playerIds = new Set(players.map(d => d.id));
const fieldIds = new Set(fields.map(d => d.id));
const gameIds = new Set(games.map(d => d.id));
const roles = ['siteAdmin', 'commissioner', 'leagueManager', 'teamManager', 'captain', 'player', 'parent', 'umpire', 'scorekeeper', 'visitor'];
const profileKeys = ['email', 'displayName', 'role', 'linkedTeamId', 'linkedPlayerId', 'linkedPlayerIds', 'createdAt', 'acceptedInvitationId'];
const profileSchemaDetails = users.map(({ keys, data: d }) => ({
  unknownKeys: keys.filter(k => !profileKeys.includes(k)),
  missingKeys: ['email', 'displayName', 'role', 'linkedTeamId', 'linkedPlayerId', 'linkedPlayerIds'].filter(k => !keys.includes(k)),
  invalidRole: !roles.includes(d.role),
  childLinksAreArray: Array.isArray(d.linkedPlayerIds),
}));
const invalidProfiles = users.filter(({ keys, data: d }) =>
  keys.some(k => !profileKeys.includes(k)) || typeof d.email !== 'string' ||
  typeof d.displayName !== 'string' || d.displayName.length > 100 || !roles.includes(d.role) ||
  !(d.linkedTeamId === null || typeof d.linkedTeamId === 'string') ||
  !(d.linkedPlayerId === null || typeof d.linkedPlayerId === 'string') ||
  (d.linkedPlayerIds !== undefined && (!Array.isArray(d.linkedPlayerIds) || d.linkedPlayerIds.length > 30))).length;
const candidate = await readFile('firestore.rules', 'utf8');
const hash = text => createHash('sha256').update(text.replaceAll('\r\n', '\n').trim()).digest('hex');
const report = {
  auditedAt: new Date().toISOString(), project, database, ruleset: release.rulesetName,
  candidateRulesDeployed: rules.source.files.some(file => hash(file.content) === hash(candidate)),
  pointInTimeRecovery: metadata.pointInTimeRecoveryEnablement,
  deletionProtection: metadata.deleteProtectionState,
  counts: { users: users.length, players: players.length, teams: teams.length, fields: fields.length, games: games.length, rsvps: rsvps.length },
  profileSchemaDetails,
  issues: {
    profilesIncompatibleWithCandidateRules: invalidProfiles,
    missingAdmin: users.some(d => d.data.role === 'siteAdmin') ? 0 : 1,
    profilesWithBrokenLinks: users.filter(({ data: d }) =>
      (d.linkedTeamId && !teamIds.has(d.linkedTeamId)) || (d.linkedPlayerId && !playerIds.has(d.linkedPlayerId)) ||
      (Array.isArray(d.linkedPlayerIds) && d.linkedPlayerIds.some(id => !playerIds.has(id)))).length,
    playersWithoutTeam: players.filter(d => !teamIds.has(d.data.teamId)).length,
    gamesWithMissingTeamOrField: games.filter(({ data: d }) => !teamIds.has(d.homeTeamId) || !teamIds.has(d.awayTeamId) || !fieldIds.has(d.fieldId)).length,
    rsvpsWithMissingGameOrPlayer: rsvps.filter(({ data: d }) => !gameIds.has(d.gameId) || !playerIds.has(d.playerId)).length,
    rsvpsRequiringScheduleReconfirmation: rsvps.filter(({ data: d }) => {
      const game = games.find(g => g.id === d.gameId)?.data;
      return !game || d.gameDate !== game.date || d.gameTime !== game.time || d.gameFieldId !== game.fieldId;
    }).length,
  },
  limitations: 'Schema and reference preflight only; not a data backup or authenticated production acceptance test.',
};
await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Local rules snapshot and report: ${folder}`);
