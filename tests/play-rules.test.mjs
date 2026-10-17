import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlay } from '../play-rules.mjs';

const rules = { innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3,
  startingBalls: 1, startingStrikes: 1, foulAtStrikeLimit: 'dead-ball', runsPerHalf: null,
  unlimitedFinalInning: false, mercy: null, timeLimitMinutes: null,
  tiePolicy: 'extra-innings', extraInningRunner: 'none' };
const empty = { first: false, second: false, third: false };
const initial = { balls: 1, strikes: 1, outs: 0, bases: empty };
const pitch = value => ({ schemaVersion: 1, type: 'pitch', pitch: value });
const runners = (outcomes, includesBatter = false) => ({ schemaVersion: 1, type: 'runners', includesBatter, outcomes });

test('a replayed half with four walks and three strikeouts derives one run and clears bases', () => {
  const actions = [...Array(12).fill(pitch('ball')), ...Array(6).fill(pitch('strike'))];
  const replay = () => {
    let state = structuredClone(initial), runs = 0;
    return actions.map(action => {
      const result = resolvePlay(rules, state, action);
      state = result.state; runs += result.runs;
      return { ...result, cumulativeRuns: runs };
    });
  };
  const frames = replay();
  assert.deepEqual(frames, replay());
  assert.deepEqual(frames.at(-1), { state: { ...initial, outs: 3 }, runs: 0,
    halfEnded: true, outcome: 'strikeout', cumulativeRuns: 1 });
  assert.throws(() => resolvePlay(rules, frames.at(-1).state, pitch('ball')));
  assert.deepEqual(initial, { balls: 1, strikes: 1, outs: 0, bases: empty });
});

test('steals preserve the count, completed batter plays reset it, and a final caught stealing resets it', () => {
  const state = { balls: 2, strikes: 2, outs: 1, bases: { ...empty, first: true } };
  const stolen = resolvePlay(rules, state, runners([{ runner: 'first', destination: 'second' }]));
  assert.deepEqual(stolen.state, { ...state, bases: { ...empty, second: true } });
  const hit = resolvePlay(rules, stolen.state, runners([
    { runner: 'second', destination: 'home' }, { runner: 'batter', destination: 'first' },
  ], true));
  assert.equal(hit.runs, 1);
  assert.deepEqual(hit.state, { ...initial, outs: 1, bases: { ...empty, first: true } });
  const caught = resolvePlay(rules, { ...state, outs: 2 }, runners([{ runner: 'first', destination: 'out', outType: 'tag' }]));
  assert.deepEqual(caught.state, { ...initial, outs: 3 });
  assert.equal(caught.halfEnded, true);
});

test('league foul strikeouts apply an out while dead-ball fouls leave runners and count unchanged', () => {
  const state = { ...initial, strikes: 2, bases: { ...empty, third: true } };
  assert.deepEqual(resolvePlay(rules, state, pitch('foul')).state, state);
  assert.deepEqual(resolvePlay({ ...rules, foulAtStrikeLimit: 'strikeout' }, state, pitch('foul')).state,
    { ...state, strikes: 1, outs: 1 });
});

test('unrecognized versions, extra fields and corrupt states cannot enter the action stream', () => {
  for (const action of [null, {}, { ...pitch('ball'), schemaVersion: 2 }, { ...pitch('ball'), uid: 'forged' },
    { ...pitch('ball'), type: 'unknown' }, { ...runners([]), includesBatter: 'true' }]) {
    assert.throws(() => resolvePlay(rules, initial, action));
  }
  for (const state of [null, {}, { ...initial, outs: 3 }, { ...initial, balls: '1' },
    { ...initial, strikes: 3 }, { ...initial, bases: null }, { ...initial, bases: undefined }, { ...initial, extra: true }]) {
    assert.throws(() => resolvePlay(rules, state, pitch('ball')));
  }
});
