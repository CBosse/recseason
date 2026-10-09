import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRulesProfile, gameRulesSnapshot, scoreCounterLimits } from '../league-rules.mjs';
import { liveScoreEntry } from '../live-scoring.mjs';
import { scoreReplay } from '../score-replay.mjs';

const user = { uid: 'scorer', role: 'scorekeeper' };
const base = { id: 'game', status: 'scheduled', scorekeeperId: user.uid };
const rules = { innings: 7, ballsForWalk: 5, strikesForOut: 4, outsPerHalf: 4, startingBalls: 1, startingStrikes: 1,
  foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null, timeLimitMinutes: null,
  tiePolicy: 'extra-innings', extraInningRunner: 'none' };
const gameFor = changes => ({ ...base, rulesSnapshot: gameRulesSnapshot(base, 'custom', nextRulesProfile(null, { name: 'Custom league', rules: { ...rules, ...changes } }, 0)) });
const values = { homeScore: 0, awayScore: 0, status: 'live', inning: 1, half: 'top', balls: 4, strikes: 3, outs: 3 };

test('custom game counters survive scoring history and replay without using current league profiles', () => {
  const game = gameFor({});
  const { patch, entry } = liveScoreEntry(game.id, game, values, user, 0);
  const replay = scoreReplay({ ...game, ...patch }, [entry]);
  assert.deepEqual(replay.warnings, []);
  assert.equal(replay.frames.at(-1).state.balls, 4);
  assert.equal(replay.frames.at(-1).state.strikes, 3);
  assert.equal(replay.frames.at(-1).state.outs, 3);
  for (const [key, value] of Object.entries({ balls: 5, strikes: 4, outs: 4 })) {
    assert.throws(() => liveScoreEntry(game.id, game, { ...values, [key]: value }, user, 0), /Invalid/);
    assert.equal(scoreReplay({ ...game, ...patch }, [{ ...entry, after: { ...entry.after, [key]: value } }]).frames.length, 0);
  }
});

test('minimum and maximum league thresholds are respected by scoring and replay', () => {
  for (const threshold of [1, 12]) {
    const game = gameFor({ ballsForWalk: threshold, strikesForOut: threshold, outsPerHalf: threshold, startingBalls: 0, startingStrikes: 0 });
    const counters = { balls: threshold - 1, strikes: threshold - 1, outs: threshold - 1 };
    assert.deepEqual(scoreCounterLimits(game), counters);
    const { patch, entry } = liveScoreEntry(game.id, game, { ...values, ...counters }, user, 0);
    assert.deepEqual(scoreReplay({ ...game, ...patch }, [entry]).warnings, []);
    for (const key of Object.keys(counters)) assert.throws(() => liveScoreEntry(game.id, game, { ...values, ...counters, [key]: threshold }, user, 0));
  }
});

test('malformed rule snapshots fail closed and legacy counters remain unchanged', () => {
  assert.deepEqual(scoreCounterLimits(base), { balls: 3, strikes: 2, outs: 2 });
  assert.throws(() => liveScoreEntry(base.id, base, values, user, 0));
  for (const snapshot of [null, {}, { ...gameFor({}).rulesSnapshot, rules: { ...rules, ballsForWalk: 0 } }]) {
    const game = { ...base, rulesSnapshot: snapshot };
    assert.throws(() => liveScoreEntry(game.id, game, values, user, 0));
    const validGame = gameFor({});
    const { entry } = liveScoreEntry(validGame.id, validGame, values, user, 0);
    assert.equal(scoreReplay(game, [entry]).frames.length, 0);
  }
});
