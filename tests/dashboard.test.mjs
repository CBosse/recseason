import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardScope, upcomingGames, rsvpTotals, dashboardRecord } from '../dashboard.mjs';
import { rsvpSchedule } from '../rsvps.mjs';
const players = [{ id: 'child', teamId: 'a' }, { id: 'archived', teamId: 'b', archived: true }];
const games = [
  { id: 'live', homeTeamId: 'a', awayTeamId: 'b', date: '2026-09-25', time: '18:00', status: 'live' },
  { id: 'next', homeTeamId: 'a', awayTeamId: 'b', date: '2026-09-25', time: '20:00', fieldId: 'main', status: 'scheduled' },
  { id: 'cancelled', homeTeamId: 'a', awayTeamId: 'b', date: '2026-09-25', time: '17:00', status: 'cancelled' },
  { id: 'unrelated', homeTeamId: 'c', awayTeamId: 'd', date: '2026-09-25', time: '16:00', status: 'scheduled' },
];
test('parent dashboard follows linked active children and excludes other teams', () => {
  const scope = dashboardScope({ role: 'parent', linkedPlayerIds: ['child', 'archived'] }, players, games);
  assert.deepEqual(scope.teamIds, ['a']);
  assert.equal(scope.games.some(g => g.id === 'unrelated'), false);
  assert.equal(dashboardScope({ role: 'player' }, players, games).games.length, 0);
  assert.equal(dashboardScope({ role: 'siteAdmin' }, players, games).games.length, 4);
});
test('next game excludes live and cancelled games; live games can appear separately', () => {
  assert.deepEqual(upcomingGames(games.slice(0, 3), '2026-09-25').map(g => g.id), ['next']);
  assert.deepEqual(upcomingGames(games.slice(0, 3), '2026-09-25', true).map(g => g.id), ['live', 'next']);
});
test('RSVP totals exclude archived and unrelated players and duplicate responses', () => {
  const rsvps = ['child', 'child', 'archived', 'unknown'].map(playerId => ({ playerId, gameId: 'next', status: 'going', ...rsvpSchedule(games[1]) }));
  assert.deepEqual(rsvpTotals(games[1], players, rsvps), { going: 1, total: 1 });
});
test('record uses team IDs even for duplicate names and rejects null scores', () => {
  const teams = [{ id: 'a', name: 'Same' }, { id: 'b', name: 'Same' }];
  const played = [{ ...games[0], status: 'completed', homeScore: 5, awayScore: 2 }, { ...games[1], status: 'completed', homeScore: null, awayScore: null }];
  assert.deepEqual(dashboardRecord(teams, played, ['a']), { wins: 1, losses: 0, ties: 0 });
  assert.deepEqual(dashboardRecord(teams, played, ['b']), { wins: 0, losses: 1, ties: 0 });
});
