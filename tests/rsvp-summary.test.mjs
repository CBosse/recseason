import test from 'node:test';
import assert from 'node:assert/strict';
import { gameRsvpSummary } from '../rsvp-summary.mjs';
import { rsvpSchedule } from '../rsvps.mjs';
const game = { id: 'g', homeTeamId: 'a', awayTeamId: 'b', homeName: 'Home', awayName: 'Away', date: '2026-10-01', time: '18:00', fieldId: 'f' };
const players = [{ id: 'p', teamId: 'a' }, { id: 'q', teamId: 'b' }, { id: 'old', teamId: 'a', archived: true }];
const responses = players.map(p => ({ playerId: p.id, teamId: p.teamId, gameId: 'g', status: 'going', ...rsvpSchedule(game) }));
test('parent summary labels linked records and omits inaccessible team totals', () => {
  assert.deepEqual(gameRsvpSummary({ role: 'parent' }, game, [players[1]], responses), [{ label: 'Away (linked players)', going: 1, maybe: 0, out: 0 }]);
});
test('manager summary excludes the opponent; officials have no private totals', () => {
  assert.deepEqual(gameRsvpSummary({ role: 'teamManager', linkedTeamId: 'a' }, game, players, responses), [{ label: 'Home', going: 1, maybe: 0, out: 0 }]);
  assert.deepEqual(gameRsvpSummary({ role: 'scorekeeper' }, game, players, responses), []);
});
test('organizer counts exclude archived, stale and duplicate responses', () => {
  const result = gameRsvpSummary({ role: 'siteAdmin' }, game, [...players, { id: 'stale', teamId: 'b' }], [...responses, responses[0], { ...responses[1], playerId: 'stale', gameTime: '17:00' }]);
  assert.deepEqual(result.map(r => r.going), [1, 1]);
  assert.deepEqual(gameRsvpSummary({ role: 'player' }, game, [], responses), []);
});
