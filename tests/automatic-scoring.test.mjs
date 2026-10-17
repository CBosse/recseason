import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticScoreEntry, replayAutomaticHistory } from '../automatic-scoring.mjs';
import { scoreReplay } from '../score-replay.mjs';

const snapshot = { profileId: 'league', schemaVersion: 1, revision: 1, name: 'League', rules: {
  innings: 1, ballsForWalk: 1, strikesForOut: 1, outsPerHalf: 1, startingBalls: 0, startingStrikes: 0,
  foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
  timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none' } };
const original = () => ({ id: 'g', status: 'scheduled', rulesSnapshot: structuredClone(snapshot) });
const pitch = value => ({ schemaVersion: 1, type: 'play', elapsedMs: 0,
  play: { schemaVersion: 1, type: 'pitch', pitch: value }, runAward: 'ordinary' });
const entryFor = (game, action = pitch('strike'), extra = {}) => automaticScoreEntry({ gameId: 'g', game,
  action, uid: 'scorer', expectedRevision: game.scoreRevision ?? 0, engineVersion: 1, ...extra });
const recordedGame = () => {
  let game = original(); const entries = [];
  for (const value of ['ball', 'strike', 'strike']) {
    const { patch, entry } = entryFor(game, pitch(value));
    game = { ...game, ...patch }; entries.push(entry);
  }
  return { game, entries };
};

test('automatic actions preserve legacy snapshot replay while independently recomputing the full game', () => {
  const { game, entries } = recordedGame();
  assert.equal(game.status, 'completed');
  assert.deepEqual(scoreReplay(game, entries).warnings, []);
  const frames = replayAutomaticHistory('g', game, [...entries].reverse());
  assert.equal(frames.length, 4);
  assert.deepEqual(frames.at(-1), game.automaticScoring);
  assert.equal(frames[1].bases.first, true);
  assert.equal(game.scoreCarry.home, 0);
});

test('first automatic entry requires a clean scheduled game and explicit engine version', () => {
  for (const patch of [{ status: 'live' }, { status: 'completed' }, { homeScore: 0 }, { scoreRevision: 1 },
    { lineScore: {} }, { bases: { first: false, second: false, third: false } }, { rulesSnapshot: null }]) {
    assert.throws(() => entryFor({ ...original(), ...patch }));
  }
  for (const extra of [{ engineVersion: 2 }, { expectedRevision: 1 }, { expectedRevision: -1 }, { uid: '../other' }]) {
    assert.throws(() => entryFor(original(), undefined, extra));
  }
});

test('changed rules, changed projection and stale revisions are rejected before another action', () => {
  const start = original(), first = entryFor(start, pitch('ball'));
  const game = { ...start, ...first.patch };
  assert.throws(() => entryFor(game, pitch('ball'), { expectedRevision: 0 }), error => error.code === 'stale-revision');
  for (const patch of [{ homeScore: 1 }, { balls: 1 }, { scoreCarry: { home: 1, away: 0 } },
    { rulesSnapshot: { ...snapshot, name: 'Changed' } }, { automaticScoring: null }, { lineScoreInning: 0 }]) {
    assert.throws(() => entryFor({ ...game, ...patch }), error => error.code === 'history-inconsistent');
  }
  assert.equal(start.status, 'scheduled'); assert.equal(start.automaticScoring, undefined);
});

test('action replay rejects missing, duplicate, foreign, altered and discontinuous events', () => {
  const { game, entries } = recordedGame();
  const variants = [entries.slice(1), [entries[0], entries[0], entries[2]], Array(3)];
  for (const change of [event => { event.gameId = 'foreign'; }, event => { event.automatic.action.play.pitch = 'ball'; },
    event => { event.automatic.before.outs = 9; }, event => { event.automatic.after.homeScore = 7; },
    event => { event.after.homeScore = 7; }, event => { event.before.status = 'completed'; }]) {
    const changed = structuredClone(entries); change(changed[1]); variants.push(changed);
  }
  for (const variant of variants) assert.throws(() => replayAutomaticHistory('g', game, variant));
  assert.throws(() => replayAutomaticHistory('g', { ...game, awayScore: 7 }, entries));
  assert.throws(() => replayAutomaticHistory('g', { ...game, automaticScoring: null }, entries));
  assert.throws(() => replayAutomaticHistory('g', null, entries), error => error.code === 'history-inconsistent');
});

test('saved action and state snapshots are detached from caller input', () => {
  const game = original(), action = pitch('ball');
  const result = entryFor(game, action);
  action.play.pitch = 'strike'; game.rulesSnapshot.rules.innings = 8;
  assert.equal(result.entry.automatic.action.play.pitch, 'ball');
  assert.equal(result.entry.automatic.before.rulesSnapshot.rules.innings, 1);
  result.patch.automaticScoring.bases.first = false;
  assert.equal(result.entry.automatic.after.bases.first, true);
});
