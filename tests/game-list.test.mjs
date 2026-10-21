import test from 'node:test';
import assert from 'node:assert/strict';
import { gameList } from '../game-list.mjs';
test('invalid scheduling records do not prevent valid games from updating', () => {
  const game = { id: 'good', date: '2026-10-19', time: '20:00', status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', fieldId: 'f' };
  const input = [game, { id: 'incomplete' }, { ...game, id: 'bad-date', date: '2026-02-30' },
    { ...game, id: 'bad-time', time: '25:00' }, { ...game, id: 'early', time: '18:00' }];
  const result = gameList(input);
  assert.deepEqual(result.games.map(item => item.id), ['early', 'good']);
  assert.deepEqual(result.invalidIds, ['incomplete', 'bad-date', 'bad-time']);
  assert.equal(input[0], game);
});
