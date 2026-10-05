import test from 'node:test';
import assert from 'node:assert/strict';
import { liveScoreEntry } from '../live-scoring.mjs';
import { scoreReplay } from '../score-replay.mjs';

const game = { status: 'live', scorekeeperId: 's', homeScore: 0, awayScore: 0, scoreRevision: 1 };
const user = { uid: 's', role: 'scorekeeper' };
const values = { homeScore: 0, awayScore: 0, inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, status: 'live', bases: { first: true, second: false, third: false }, note: ' Single to left. ' };

test('a scoreless play note is attached to the same revision and runner snapshot', () => {
  const { patch, entry } = liveScoreEntry('g', game, values, user, 1);
  assert.equal(patch.scoreRevision, 2);
  assert.equal(entry.reason, 'Single to left.');
  assert.equal(entry.scoredBy, 's');
  assert.equal(entry.after.bases.first, true);
  assert.equal(entry.after.homeScore, 0);
  assert.equal(scoreReplay({ ...game, ...patch, id: 'g' }, [entry]).frames.at(-1).reason, 'Single to left.');
  assert.equal('note' in patch, false);
});

test('play notes retain length, stale-score and assignment checks', () => {
  assert.throws(() => liveScoreEntry('g', game, { ...values, note: 'x'.repeat(301) }, user, 1), /300/);
  assert.throws(() => liveScoreEntry('g', game, values, user, 0), /another session/);
  assert.throws(() => liveScoreEntry('g', game, values, { ...user, uid: 'other' }, 1), /assigned/);
  assert.equal(liveScoreEntry('g', game, { ...values, note: '' }, user, 1).entry.reason, '');
});
