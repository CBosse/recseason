import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoringGame, applyGameAction, replayGameActions } from '../game-rules.mjs';

const rules = { innings: 2, ballsForWalk: 1, strikesForOut: 1, outsPerHalf: 1,
  startingBalls: 0, startingStrikes: 0, foulAtStrikeLimit: 'dead-ball', runsPerHalf: null,
  unlimitedFinalInning: false, mercy: null, timeLimitMinutes: null,
  tiePolicy: 'allow-tie', extraInningRunner: 'none' };
const snapshot = changes => ({ profileId: 'league', schemaVersion: 1, revision: 1,
  name: 'Test league', rules: { ...rules, ...changes } });
const pitch = (value = 'strike', elapsedMs = 0) => ({ schemaVersion: 1, type: 'play', elapsedMs,
  play: { schemaVersion: 1, type: 'pitch', pitch: value }, runAward: 'ordinary' });
const clock = elapsedMs => ({ schemaVersion: 1, type: 'clock', elapsedMs });
const scoreAll = (state, runAward = 'home-run') => ({ schemaVersion: 1, type: 'play', elapsedMs: state.elapsedMs,
  play: { schemaVersion: 1, type: 'runners', includesBatter: true,
    outcomes: ['third', 'second', 'first'].filter(base => state.bases[base]).concat('batter').map(runner => ({ runner, destination: 'home' })) }, runAward });
const strike = state => applyGameAction(state, pitch('strike', state.elapsedMs));
const walk = state => applyGameAction(state, pitch('ball', state.elapsedMs));
const homeRun = state => applyGameAction(state, scoreAll(state));

test('complete games advance innings and finalize ties, away wins and home leads without an unnecessary bottom', () => {
  const frames = replayGameActions(snapshot(), Array.from({ length: 4 }, () => pitch()));
  assert.deepEqual(frames.map(state => [state.inning, state.half, state.status]),
    [[1, 'bottom', 'live'], [2, 'top', 'live'], [2, 'bottom', 'live'], [2, 'bottom', 'completed']]);
  assert.equal(frames.at(-1).endReason, 'tie');
  let away = homeRun(createScoringGame(snapshot()));
  for (let i = 0; i < 4; i++) away = strike(away);
  assert.equal(away.awayScore, 1); assert.equal(away.status, 'completed'); assert.equal(away.endReason, 'regulation');
  let home = homeRun(strike(createScoringGame(snapshot())));
  home = strike(strike(home));
  assert.equal(home.half, 'top'); assert.equal(home.inning, 2); assert.equal(home.status, 'completed');
  assert.equal(home.lineScore[2].home, 0);
  assert.throws(() => strike(home), /already final/);
});

test('ordinary walk-offs award the winning run while home runs award the whole play', () => {
  let state = createScoringGame(snapshot({ innings: 1 }));
  state = strike(homeRun(walk(state)));
  state = walk(walk(walk(state)));
  const ordinary = applyGameAction(state, scoreAll(state, 'ordinary'));
  const homer = homeRun(state);
  assert.deepEqual([ordinary.homeScore, ordinary.awayScore, ordinary.status, ordinary.endReason], [3, 2, 'completed', 'walk-off']);
  assert.deepEqual([homer.homeScore, homer.awayScore, homer.status], [4, 2, 'completed']);
  assert.equal(state.homeScore, 0);
});

test('strict caps end a half, including home runs, while the scheduled final and extras can be unlimited', () => {
  let capped = createScoringGame(snapshot({ runsPerHalf: 2 }));
  capped = homeRun(walk(walk(capped)));
  assert.equal(capped.awayScore, 2); assert.equal(capped.half, 'bottom'); assert.equal(capped.outs, 0);
  let unlimited = createScoringGame(snapshot({ runsPerHalf: 1, unlimitedFinalInning: true }));
  unlimited = homeRun(homeRun(unlimited));
  assert.equal(unlimited.inning, 2); assert.equal(unlimited.half, 'top');
  unlimited = homeRun(homeRun(unlimited));
  assert.equal(unlimited.inning, 2); assert.equal(unlimited.half, 'top'); assert.equal(unlimited.awayScore, 3);
});

test('mercy gives the trailing home team its half and never activates before the configured inning', () => {
  const configured = snapshot({ innings: 4, mercy: { runs: 3, afterInning: 2 } });
  let away = homeRun(walk(walk(createScoringGame(configured))));
  away = strike(strike(away));
  assert.equal(away.status, 'live'); assert.equal(away.inning, 2);
  away = strike(away);
  assert.equal(away.half, 'bottom'); assert.equal(away.status, 'live');
  away = strike(away);
  assert.equal(away.status, 'completed'); assert.equal(away.endReason, 'mercy');
  let home = homeRun(walk(walk(strike(createScoringGame(configured)))));
  assert.equal(home.status, 'live');
  home = strike(strike(home));
  assert.equal(home.status, 'completed'); assert.equal(home.half, 'top'); assert.equal(home.endReason, 'mercy');
});

test('time limits use recorded elapsed time and finish the inning with a home opportunity', () => {
  let state = createScoringGame(snapshot({ innings: 7, timeLimitMinutes: 1 }));
  state = applyGameAction(state, clock(59999));
  assert.equal(state.lastInning, 7);
  state = applyGameAction(state, clock(60000));
  assert.equal(state.lastInning, 1); assert.equal(state.status, 'live');
  state = strike(homeRun(state));
  assert.equal(state.status, 'live'); assert.equal(state.half, 'bottom');
  state = strike(state);
  assert.equal(state.status, 'completed'); assert.equal(state.endReason, 'time-limit');
  let home = homeRun(strike(createScoringGame(snapshot({ innings: 7, timeLimitMinutes: 1 }))));
  home = applyGameAction(home, clock(60000));
  assert.equal(home.status, 'completed'); assert.equal(home.homeScore, 1);
});

test('tied games continue with a runner on second in both extra halves, including timed extras', () => {
  for (const timeLimitMinutes of [null, 1]) {
    let state = createScoringGame(snapshot({ innings: timeLimitMinutes ? 7 : 1, timeLimitMinutes,
      tiePolicy: 'extra-innings', extraInningRunner: 'second' }));
    if (timeLimitMinutes) state = applyGameAction(state, clock(60000));
    state = strike(strike(state));
    assert.equal(state.inning, 2); assert.equal(state.bases.second, true);
    state = strike(state);
    assert.equal(state.half, 'bottom'); assert.equal(state.bases.second, true);
    state = applyGameAction(state, { schemaVersion: 1, type: 'play', elapsedMs: state.elapsedMs, runAward: 'ordinary',
      play: { schemaVersion: 1, type: 'runners', includesBatter: false, outcomes: [{ runner: 'second', destination: 'home' }] } });
    assert.equal(state.homeScore, 1); assert.equal(state.status, 'completed');
  }
});

test('new halves restore custom starting counts and no runner appears during regulation', () => {
  let state = createScoringGame(snapshot({ ballsForWalk: 5, strikesForOut: 4, outsPerHalf: 2,
    startingBalls: 2, startingStrikes: 2, tiePolicy: 'extra-innings', extraInningRunner: 'second' }));
  for (let i = 0; i < 4; i++) state = strike(state);
  assert.deepEqual([state.balls, state.strikes, state.outs, state.half], [2, 2, 0, 'bottom']);
  assert.deepEqual(state.bases, { first: false, second: false, third: false });
});

test('timed extras are unlimited without retroactively removing the cap from the timed final inning', () => {
  let state = createScoringGame(snapshot({ innings: 7, timeLimitMinutes: 1, runsPerHalf: 1,
    unlimitedFinalInning: true, tiePolicy: 'extra-innings' }));
  state = applyGameAction(state, clock(60000));
  state = homeRun(state);
  assert.equal(state.half, 'bottom');
  state = homeRun(state);
  assert.equal(state.inning, 2); assert.equal(state.half, 'top');
  state = homeRun(homeRun(state));
  assert.equal(state.inning, 2); assert.equal(state.half, 'top'); assert.equal(state.awayScore, 3);
});

test('complete scoreless games honor minimum, standard and maximum out and strike thresholds', () => {
  for (const outsPerHalf of [1, 3, 12]) {
    for (const strikesForOut of [1, 3, 12]) {
      const configured = snapshot({ innings: 3, outsPerHalf, strikesForOut });
      const actions = Array.from({ length: 6 * outsPerHalf * strikesForOut }, () => pitch());
      const frames = replayGameActions(configured, actions);
      assert.equal(frames.at(-1).status, 'completed');
      assert.equal(frames.at(-1).endReason, 'tie');
      assert.equal(frames.slice(0, -1).every(frame => frame.status === 'live'), true);
      for (const frame of frames) assert.ok(frame.outs < outsPerHalf && frame.strikes < strikesForOut);
    }
  }
});

test('game replay is deterministic, detached from inputs, and preserves inning totals', () => {
  const source = snapshot(), actions = [pitch('ball'), pitch(), pitch(), pitch(), pitch()];
  const frames = replayGameActions(source, actions);
  assert.deepEqual(frames, replayGameActions(source, actions));
  source.rules.startingBalls = 99;
  actions[0].play.pitch = 'foul';
  assert.equal(frames[0].rulesSnapshot.rules.startingBalls, 0);
  assert.equal(frames[0].bases.first, true);
  for (const frame of frames) {
    for (const side of ['home', 'away']) assert.equal(frame[`${side}Score`], Object.values(frame.lineScore).reduce((sum, cell) => sum + cell[side], 0));
  }
});

test('corrupt states, backward clocks, invalid home runs and unsupported actions fail closed', () => {
  const state = applyGameAction(createScoringGame(snapshot()), clock(20));
  for (const action of [clock(19), clock(-1), clock(NaN), { ...clock(20), extra: true },
    { ...pitch(), schemaVersion: 2 }, { ...pitch('ball', 20), runAward: 'home-run' }, null]) {
    assert.throws(() => applyGameAction(state, action));
  }
  for (const patch of [{ homeScore: 1 }, { engineVersion: 2 }, { bases: undefined }, { outs: 1 },
    { lineScore: { 2: { home: 0, away: 0 } } }, { lastInning: 1 }, { endReason: 'tie' },
    { inning: 0 }, { extra: true }]) assert.throws(() => applyGameAction({ ...state, ...patch }, clock(20)));
  assert.throws(() => replayGameActions(snapshot(), {}));
  assert.throws(() => replayGameActions(snapshot(), Array(2)));
});

test('inning 99 never silently rolls over or fabricates a final result', () => {
  const configured = snapshot({ innings: 99, tiePolicy: 'extra-innings' });
  const state = replayGameActions(configured, Array.from({ length: 197 }, () => pitch())).at(-1);
  assert.equal(state.inning, 99); assert.equal(state.half, 'bottom');
  assert.throws(() => strike(state), /beyond inning 99/);
});
