import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLeagueRules, nextRulesProfile, gameRulesSnapshot } from '../league-rules.mjs';

const rules = { innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3, startingBalls: 0, startingStrikes: 0,
  foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null, timeLimitMinutes: null, tiePolicy: 'extra-innings', extraInningRunner: 'none' };
const values = { name: 'Example division', rules };

test('league profiles support count, run-cap, mercy, time and extra-inning variations', () => {
  assert.deepEqual(validateLeagueRules(rules), rules);
  const custom = { ...rules, innings: 6, ballsForWalk: 5, strikesForOut: 4, outsPerHalf: 4, startingBalls: 1, startingStrikes: 1,
    foulAtStrikeLimit: 'strikeout', runsPerHalf: 5, unlimitedFinalInning: true, mercy: { runs: 10, afterInning: 4 }, timeLimitMinutes: 75, extraInningRunner: 'second' };
  assert.deepEqual(validateLeagueRules(custom), custom);
});
test('invalid, missing and unsupported league rules are rejected explicitly', () => {
  for (const patch of [{ innings: 0 }, { ballsForWalk: 0 }, { strikesForOut: 13 }, { outsPerHalf: 1.5 }, { startingBalls: 4 }, { startingStrikes: 3 },
    { runsPerHalf: 0 }, { unlimitedFinalInning: true }, { mercy: { runs: 10, afterInning: 8 } }, { timeLimitMinutes: 0 }, { tiePolicy: 'allow-tie', extraInningRunner: 'second' }, { unknown: true }]) assert.throws(() => validateLeagueRules({ ...rules, ...patch }));
  assert.throws(() => validateLeagueRules({}));
});
test('profile revisions reject stale writes and return independent values', () => {
  const first = nextRulesProfile(null, values, 0);
  const second = nextRulesProfile(first, { ...values, rules: { ...rules, innings: 9 } }, 1);
  assert.equal(first.revision, 1); assert.equal(second.revision, 2);
  assert.throws(() => nextRulesProfile(second, values, 1), /another session/);
  first.rules.innings = 5; assert.equal(rules.innings, 7);
});
test('game snapshot keeps original profile revision after league edits and cannot alias it', () => {
  const first = nextRulesProfile(null, values, 0);
  const snapshot = gameRulesSnapshot({ status: 'scheduled' }, 'division-a', first);
  const second = nextRulesProfile(first, { ...values, rules: { ...rules, innings: 9 } }, 1);
  const retained = gameRulesSnapshot({ status: 'live', rulesSnapshot: snapshot }, 'division-b', second);
  assert.deepEqual(retained, snapshot); assert.equal(retained.revision, 1); assert.equal(retained.rules.innings, 7);
  retained.rules.innings = 8; assert.equal(snapshot.rules.innings, 7); assert.equal(first.rules.innings, 7);
});
test('scored legacy games and invalid snapshots cannot silently adopt new rules', () => {
  const profile = nextRulesProfile(null, values, 0);
  for (const game of [{ status: 'live' }, { status: 'completed' }, { status: 'scheduled', scoreRevision: 1 }, { status: 'scheduled', homeScore: 0 }, { status: 'scheduled', rulesSnapshot: null }]) assert.throws(() => gameRulesSnapshot(game, 'division', profile));
  assert.throws(() => gameRulesSnapshot({ status: 'scheduled' }, '../config', profile));
});
