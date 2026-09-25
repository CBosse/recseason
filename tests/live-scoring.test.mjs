import test from 'node:test';
import assert from 'node:assert/strict';
import { canScore, liveScoreUpdate } from '../live-scoring.mjs';
const user = { uid: 'scorer', role: 'scorekeeper' };
const game = { status: 'scheduled', scorekeeperId: 'scorer' };
const values = { homeScore: '3', awayScore: '0', inning: '2', half: 'bottom', balls: '0', strikes: '1', outs: '2', status: 'live' };
test('only assigned scorers and league organizers can score', () => {
  assert.equal(canScore(user, game), true);
  for (const other of [null, { ...user, uid: 'someone' }, { ...user, role: 'player' }, { role: 'siteAdmin' }]) assert.equal(canScore(other, game), false);
  for (const role of ['siteAdmin', 'commissioner', 'leagueManager']) assert.equal(canScore({ uid: 'admin', role }, game), true);
});
test('live scores preserve scheduling metadata and increment revision', () => {
  const patch = liveScoreUpdate(game, values, user, 0);
  assert.deepEqual(patch, { homeScore: 3, awayScore: 0, status: 'live', inning: 2, balls: 0, strikes: 1, outs: 2, half: 'bottom', scoreRevision: 1, scoredBy: 'scorer' });
  assert.equal(liveScoreUpdate({ ...game, status: 'live' }, { ...values, status: 'completed' }, user, 0).status, 'completed');
});
test('closed games, assignment changes and stale revisions reject writes', () => {
  for (const other of [null, { ...game, status: 'cancelled' }, { ...game, status: 'completed' }, { ...game, scorekeeperId: 'other' }, { ...game, scoreRevision: 1 }]) assert.throws(() => liveScoreUpdate(other, values, user, 0));
});
test('invalid counters, scores and states cannot be persisted', () => {
  for (const patch of [{ homeScore: '' }, { awayScore: '-1' }, { inning: 0 }, { inning: 1.5 }, { balls: 4 }, { strikes: 3 }, { outs: 3 }, { half: 'middle' }, { status: 'scheduled' }, { balls: '' }]) assert.throws(() => liveScoreUpdate(game, { ...values, ...patch }, user, 0));
});
