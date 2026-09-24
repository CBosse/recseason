import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScore, scoreUpdate, standings } from '../results.mjs';

const teams = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
const game = { homeTeamId: 'a', awayTeamId: 'b', status: 'completed' };
test('scores accept zero and reject missing, negative, fractional and unsafe values', () => {
  assert.equal(parseScore('0'), 0);
  assert.equal(parseScore(' 12 '), 12);
  for (const invalid of ['', ' ', null, undefined, -1, 1.5, '2.9', '1e2', Infinity, true, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseScore(invalid));
});
test('result patch contains no schedule or umpire fields', () => {
  assert.deepEqual(scoreUpdate('2', '1'), { homeScore: 2, awayScore: 1, status: 'completed' });
});
test('wins, losses and ties update both teams and points', () => {
  const rows = standings(teams, [{ ...game, homeScore: 3, awayScore: 1 }, { ...game, homeScore: 0, awayScore: 0 }]);
  assert.deepEqual(rows[0], { name: 'Alpha', GP: 2, W: 1, L: 0, T: 1, GF: 3, GA: 1, Pts: 4 });
  assert.deepEqual(rows[1], { name: 'Beta', GP: 2, W: 0, L: 1, T: 1, GF: 1, GA: 3, Pts: 1 });
});
test('invalid, unplayed, missing-team and self matches do not affect standings', () => {
  const rows = standings(teams, [{ ...game, homeScore: null, awayScore: null }, { ...game, homeScore: -1, awayScore: 2 }, { ...game, homeScore: 2, awayScore: 1, status: 'scheduled' }, { ...game, homeScore: 2, awayScore: 1, awayTeamId: 'a' }, { ...game, homeScore: 2, awayScore: 1, awayTeamId: 'missing' }]);
  assert.ok(rows.every(row => row.GP === 0 && row.Pts === 0));
});
test('ties use goal difference, goals for, then name', () => {
  const extra = [...teams, { id: 'c', name: 'Gamma' }, { id: 'd', name: 'Delta' }];
  const rows = standings(extra, [{ ...game, homeScore: 2, awayScore: 0 }, { ...game, homeTeamId: 'c', awayTeamId: 'd', homeScore: 4, awayScore: 0 }]);
  assert.equal(rows[0].name, 'Gamma');
  assert.equal(standings(extra, [])[0].name, 'Alpha');
});
