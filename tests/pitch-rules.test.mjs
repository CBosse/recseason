import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePitch } from '../pitch-rules.mjs';

const rules = { innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3,
  startingBalls: 0, startingStrikes: 0, foulAtStrikeLimit: 'dead-ball', runsPerHalf: null,
  unlimitedFinalInning: false, mercy: null, timeLimitMinutes: null,
  tiePolicy: 'extra-innings', extraInningRunner: 'none' };

test('every supported threshold and count resolves balls, strikes and both foul policies', () => {
  for (let ballsForWalk = 1; ballsForWalk <= 12; ballsForWalk++) {
    for (let strikesForOut = 1; strikesForOut <= 12; strikesForOut++) {
      for (const foulAtStrikeLimit of ['dead-ball', 'strikeout']) {
        const configured = { ...rules, ballsForWalk, strikesForOut, foulAtStrikeLimit,
          startingBalls: ballsForWalk - 1, startingStrikes: strikesForOut - 1 };
        for (let balls = 0; balls < ballsForWalk; balls++) {
          for (let strikes = 0; strikes < strikesForOut; strikes++) {
            const count = Object.freeze({ balls, strikes });
            const walk = balls === ballsForWalk - 1;
            assert.deepEqual(resolvePitch(configured, count, 'ball'), walk
              ? { balls: configured.startingBalls, strikes: configured.startingStrikes, outcome: 'walk' }
              : { balls: balls + 1, strikes, outcome: 'continue' });
            for (const pitch of ['strike', 'foul']) {
              const atLimit = strikes === strikesForOut - 1;
              const out = atLimit && (pitch === 'strike' || foulAtStrikeLimit === 'strikeout');
              assert.deepEqual(resolvePitch(configured, count, pitch), out
                ? { balls: configured.startingBalls, strikes: configured.startingStrikes, outcome: 'strikeout' }
                : { balls, strikes: atLimit ? strikes : strikes + 1, outcome: 'continue' });
            }
          }
        }
      }
    }
  }
});

test('pitch sequences are deterministic and leave frozen inputs unchanged', () => {
  const frozen = Object.freeze({ ...rules, startingBalls: 1, startingStrikes: 1 });
  const actions = ['ball', 'foul', 'foul', 'strike', 'ball', 'ball', 'ball'];
  const replay = () => {
    let count = { balls: frozen.startingBalls, strikes: frozen.startingStrikes };
    return actions.map(action => {
      const result = resolvePitch(frozen, count, action);
      count = { balls: result.balls, strikes: result.strikes };
      return result;
    });
  };
  const frames = replay();
  assert.deepEqual(replay(), frames);
  assert.deepEqual(frames.map(frame => frame.outcome), ['continue', 'continue', 'continue', 'strikeout', 'continue', 'continue', 'walk']);
  assert.deepEqual(frames.at(-1), { balls: 1, strikes: 1, outcome: 'walk' });
});

test('invalid counts, actions and malformed rules fail closed', () => {
  for (const count of [null, [], {}, { balls: 0 }, { balls: 0, strikes: 0, outs: 0 },
    { balls: '0', strikes: 0 }, { balls: -1, strikes: 0 }, { balls: 4, strikes: 0 },
    { balls: 0, strikes: 3 }, { balls: 0, strikes: NaN }, { balls: 0.5, strikes: 0 }]) {
    assert.throws(() => resolvePitch(rules, count, 'ball'));
  }
  for (const pitch of [null, {}, 'hit', 'Ball', '']) assert.throws(() => resolvePitch(rules, { balls: 0, strikes: 0 }, pitch));
  assert.throws(() => resolvePitch({ ...rules, strikesForOut: 0 }, { balls: 0, strikes: 0 }, 'strike'));
});
