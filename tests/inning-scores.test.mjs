import test from 'node:test';
import assert from 'node:assert/strict';
import { inningScoreUpdate } from '../inning-scores.mjs';
import { liveScoreUpdate } from '../live-scoring.mjs';
test('inning entries derive totals and replacing an inning does not double count', () => {
  let game = { status: 'scheduled', homeScore: null, awayScore: null };
  game = { ...game, ...inningScoreUpdate(game, { inning: 1, home: 2, away: 0 }, 0) };
  game = { ...game, ...inningScoreUpdate(game, { inning: 2, home: 1, away: 3 }, 1) };
  assert.equal(game.homeScore, 3); assert.equal(game.awayScore, 3);
  const corrected = inningScoreUpdate(game, { inning: 1, home: 0, away: 1 }, 2);
  assert.equal(corrected.homeScore, 1); assert.equal(corrected.awayScore, 4);
  assert.equal(corrected.inning, 2); assert.equal(corrected.lineScoreInning, 1);
  assert.deepEqual(corrected.lineScore['2'], { home: 1, away: 3 });
});
test('legacy totals remain explicitly unallocated and final corrections remain final', () => {
  const game = { status: 'completed', homeScore: 5, awayScore: 4 };
  const next = inningScoreUpdate(game, { inning: 7, home: 1, away: 0 }, 0);
  assert.deepEqual(next.scoreCarry, { home: 5, away: 4 });
  assert.equal(next.homeScore, 6); assert.equal(next.status, 'completed');
  assert.deepEqual(Object.keys(next.lineScore), ['7']);
});
test('invalid innings, scores, stale revisions and total overflow are rejected', () => {
  const game = { status: 'live' };
  for (const values of [{ inning: 0, home: 0, away: 0 }, { inning: 100, home: 0, away: 0 }, { inning: 1, home: -1, away: 0 }, { inning: 1, home: '', away: 0 }]) assert.throws(() => inningScoreUpdate(game, values, 0));
  assert.throws(() => inningScoreUpdate({ ...game, scoreRevision: 1 }, { inning: 1, home: 0, away: 0 }, 0), /changed/);
  assert.throws(() => inningScoreUpdate({ ...game, homeScore: Number.MAX_SAFE_INTEGER }, { inning: 1, home: 1, away: 0 }, 0));
});
test('live counter editor cannot overwrite inning-derived totals', () => {
  assert.throws(() => liveScoreUpdate({ status: 'live', lineScore: { '1': { home: 1, away: 0 } }, homeScore: 1, awayScore: 0 }, { status: 'live', homeScore: 2, awayScore: 0 }, { uid: 'admin', role: 'siteAdmin' }, 0), /Record inning/);
});
