import test from 'node:test';
import assert from 'node:assert/strict';
import { baseOccupancy, baseLabel } from '../base-occupancy.mjs';
import { liveScoreUpdate } from '../live-scoring.mjs';
import { scoreHistoryEntry } from '../score-history.mjs';
test('runner state defaults for legacy games and rejects malformed states', () => {
  assert.deepEqual(baseOccupancy(), { first: false, second: false, third: false });
  for (const value of [null, [], {}, { first: 1, second: false, third: false }, { first: true, second: true, third: true, fourth: true }]) assert.throws(() => baseOccupancy(value), /runner state/);
  assert.equal(baseLabel({ first: true, second: false, third: true }), '1st, 3rd');
});
test('runner updates persist in the score patch and before/after history', () => {
  const user = { uid: 's', role: 'scorekeeper' };
  const game = { status: 'live', scorekeeperId: 's', bases: { first: true, second: false, third: false } };
  const values = { status: 'live', homeScore: 0, awayScore: 1, inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, bases: { first: false, second: true, third: true } };
  const patch = liveScoreUpdate(game, values, user, 0);
  assert.deepEqual(patch.bases, values.bases);
  const entry = scoreHistoryEntry('g', game, patch, 's');
  assert.deepEqual(entry.before.bases, game.bases);
  assert.deepEqual(entry.after.bases, values.bases);
  const { bases, ...legacy } = values;
  assert.deepEqual(liveScoreUpdate(game, legacy, user, 0).bases, game.bases);
});
