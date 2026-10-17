import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceWalk, resolveRunnerPlay } from '../runner-rules.mjs';

const rules = { innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3,
  startingBalls: 0, startingStrikes: 0, foulAtStrikeLimit: 'dead-ball', runsPerHalf: null,
  unlimitedFinalInning: false, mercy: null, timeLimitMinutes: null,
  tiePolicy: 'extra-innings', extraInningRunner: 'none' };
const empty = { first: false, second: false, third: false };
const move = (runner, destination) => ({ runner, destination });
const out = (runner, outType = 'tag') => ({ runner, destination: 'out', outType });
const play = (outcomes, includesBatter = true) => ({ schemaVersion: 1, includesBatter, outcomes });
const run = (bases, outcomes, outs = 0, includesBatter = true, custom = rules) =>
  resolveRunnerPlay(custom, { bases, outs }, play(outcomes, includesBatter));

test('walks force only a contiguous chain and conserve runners for every occupancy', () => {
  const expected = [
    [true, false, false, 0], [true, true, false, 0], [true, true, false, 0], [true, true, true, 0],
    [true, false, true, 0], [true, true, true, 0], [true, true, true, 0], [true, true, true, 1],
  ];
  for (let mask = 0; mask < 8; mask++) {
    const bases = Object.freeze({ first: Boolean(mask & 1), second: Boolean(mask & 2), third: Boolean(mask & 4) });
    const result = advanceWalk(bases);
    assert.deepEqual([...Object.values(result.bases), result.runs], expected[mask]);
    assert.equal(Object.values(bases).filter(Boolean).length + 1, Object.values(result.bases).filter(Boolean).length + result.runs);
  }
});

test('explicit destinations support unequal advancement, home runs and non-batter plays', () => {
  assert.deepEqual(run({ ...empty, first: true, third: true }, [move('third', 'home'), move('first', 'third'), move('batter', 'first')]),
    { bases: { first: true, second: false, third: true }, outs: 0, runs: 1, halfEnded: false });
  assert.deepEqual(run({ first: true, second: true, third: true }, ['third', 'second', 'first', 'batter'].map(runner => move(runner, 'home'))),
    { bases: empty, outs: 0, runs: 4, halfEnded: false });
  assert.deepEqual(run({ ...empty, first: true }, [move('first', 'second')], 1, false),
    { bases: { ...empty, second: true }, outs: 1, runs: 0, halfEnded: false });
});

test('inning-ending tag outs count only earlier runs at every supported out threshold', () => {
  for (let outsPerHalf = 1; outsPerHalf <= 12; outsPerHalf++) {
    const custom = { ...rules, outsPerHalf };
    const bases = { ...empty, third: true };
    assert.deepEqual(run(bases, [move('third', 'home'), out('batter')], outsPerHalf - 1, true, custom),
      { bases: empty, outs: outsPerHalf, runs: 1, halfEnded: true });
    assert.equal(run(bases, [out('batter'), move('third', 'home')], outsPerHalf - 1, true, custom).runs, 0);
    assert.equal(run(bases, [move('third', 'home'), out('batter', 'batter-before-first')], outsPerHalf - 1, true, custom).runs, 0);
  }
});

test('inning-ending force outs erase runs while earlier force outs do not', () => {
  const bases = { ...empty, first: true, third: true };
  const outcomes = [move('third', 'home'), out('first', 'force'), move('batter', 'first')];
  assert.deepEqual(run(bases, outcomes, 2), { bases: empty, outs: 3, runs: 0, halfEnded: true });
  assert.deepEqual(run(bases, outcomes, 1), { bases: { ...empty, first: true }, outs: 2, runs: 1, halfEnded: false });
  assert.deepEqual(run({ ...empty, first: true }, [out('first', 'force'), out('batter', 'batter-before-first')], 1),
    { bases: empty, outs: 3, runs: 0, halfEnded: true });
});

test('missing, duplicated, backward, colliding and malformed runner outcomes fail closed', () => {
  const bases = { ...empty, first: true };
  for (const outcomes of [[], [move('batter', 'first')], [move('first', 'second'), move('first', 'third')],
    [move('second', 'third'), move('batter', 'first')], [move('first', 'first'), move('batter', 'first')],
    [move('first', 'batter'), move('batter', 'first')], [out('first', 'batter-before-first'), move('batter', 'first')],
    [out('first', 'unknown'), move('batter', 'first')], [move('first', 'second'), out('batter', 'force')],
    [{ ...move('first', 'second'), extra: true }, move('batter', 'first')]]) assert.throws(() => run(bases, outcomes));
  assert.throws(() => run({ ...empty, third: true }, [move('third', 'second')], 0, false));
  assert.throws(() => run(bases, [out('first', 'force')], 0, false));
  assert.throws(() => run(bases, [out('first'), out('batter')], 2));
  for (const outs of [-1, 3, 0.5, '0', NaN]) assert.throws(() => run(empty, [move('batter', 'first')], outs));
  assert.throws(() => advanceWalk({ first: 1, second: false, third: false }));
  assert.throws(() => advanceWalk(undefined));
  assert.throws(() => run(undefined, [move('batter', 'first')]));
  assert.throws(() => run({ ...empty, first: true, second: true }, [move('first', 'third'), move('second', 'second'), move('batter', 'first')]));
  assert.throws(() => run({ ...empty, first: true }, [move('batter', 'home'), move('first', 'third')]));
  assert.throws(() => resolveRunnerPlay(rules, { bases: empty, outs: 0 }, { ...play([move('batter', 'first')]), schemaVersion: 2 }));
});

test('runner plays replay deterministically without mutating their inputs', () => {
  const state = Object.freeze({ bases: Object.freeze({ ...empty, third: true }), outs: 2 });
  const action = Object.freeze(play(Object.freeze([Object.freeze(move('third', 'home')), Object.freeze(out('batter'))])));
  assert.deepEqual(resolveRunnerPlay(rules, state, action), resolveRunnerPlay(rules, state, action));
  assert.equal(state.bases.third, true);
  assert.equal(state.outs, 2);
});
