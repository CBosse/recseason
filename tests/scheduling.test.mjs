import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMatchups, gamesConflict, validateScheduleConfig } from '../scheduling.mjs';

const team = id => ({ id, name: id });
const pair = (home, away) => ({ home: team(home), away: team(away) });
const slot = (fieldId, time) => ({ date: '2026-06-01', fieldId, time });
const game = { ...slot('f1', '18:00'), homeTeamId: 'a', awayTeamId: 'b' };

test('one field slot cannot host unrelated games', () => {
  const result = allocateMatchups([pair('a', 'b'), pair('c', 'd')], [slot('f1', '18:00')], 90, 0);
  assert.equal(result.games.length, 1);
  assert.equal(result.skipped, 1);
});
test('staggered fields cannot double-book a team', () => {
  const result = allocateMatchups([pair('a', 'b'), pair('a', 'c')], [slot('f1', '18:00'), slot('f2', '18:30')], 90, 0);
  assert.equal(result.games.length, 1);
});
test('independent games can run simultaneously on separate fields', () => {
  assert.equal(allocateMatchups([pair('a', 'b'), pair('c', 'd')], [slot('f1', '18:00'), slot('f2', '18:00')], 90, 0).games.length, 2);
});
test('buffer applies to overlapping intervals but allows exact boundary', () => {
  assert.equal(gamesConflict(game, { ...game, time: '19:30' }, 90, 15), true);
  assert.equal(gamesConflict(game, { ...game, time: '19:45' }, 90, 15), false);
  assert.equal(gamesConflict(game, { ...game, time: '19:30' }, 90, 0), false);
});
test('preserved games reserve their field and team', () => {
  assert.equal(allocateMatchups([pair('c', 'd')], [slot('f1', '18:00')], 90, 0, [game]).skipped, 1);
});
test('invalid configuration fails before slot generation', () => {
  const config = { gameDuration: 90, bufferMinutes: 0, rounds: 1, startDate: '2026-06-01', endDate: '2026-07-01' };
  assert.doesNotThrow(() => validateScheduleConfig(config));
  for (const change of [{ gameDuration: -1 }, { bufferMinutes: -90 }, { rounds: 0 }, { startDate: '2026-02-30' }, { endDate: '2025-01-01' }]) {
    assert.throws(() => validateScheduleConfig({ ...config, ...change }));
  }
});
