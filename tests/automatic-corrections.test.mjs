import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticScoreEntry, automaticCorrectionEntry, replayAutomaticHistory } from '../automatic-scoring.mjs';
import { scoringPlayback } from '../scoring-playback.mjs';

const snapshot = { profileId: 'league', schemaVersion: 1, revision: 1, name: 'League', rules: {
  innings: 1, ballsForWalk: 1, strikesForOut: 1, outsPerHalf: 1, startingBalls: 0, startingStrikes: 0,
  foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
  timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none',
} };
const pitch = (value, elapsedMs = 0) => ({ schemaVersion: 1, type: 'play', elapsedMs, runAward: 'ordinary',
  play: { schemaVersion: 1, type: 'pitch', pitch: value } });
const correction = (targetRevision, replacement) => ({ schemaVersion: 1, type: 'correction', targetRevision, replacement, reason: 'Scorer entered the wrong play' });
function fixture(actions) {
  let game = { id: 'g', status: 'scheduled', rulesSnapshot: structuredClone(snapshot) }; const entries = [];
  const record = action => {
    const create = action.type === 'correction' ? automaticCorrectionEntry : automaticScoreEntry;
    const result = create({ gameId: 'g', game, entries, action, uid: 'scorer', expectedRevision: entries.length, engineVersion: 1 });
    game = { ...game, ...result.patch }; entries.push(result.entry); return result;
  };
  actions.forEach(record);
  return { get game() { return game; }, entries, record };
}

test('voiding the final out reopens a game without changing its original events', () => {
  const f = fixture([pitch('strike'), pitch('strike')]), original = structuredClone(f.entries);
  assert.equal(f.game.status, 'completed');
  f.record(correction(2, null));
  assert.equal(f.game.status, 'live'); assert.equal(f.game.half, 'bottom'); assert.equal(f.game.scoreRevision, 3);
  assert.deepEqual(f.entries.slice(0, 2), original);
  assert.equal(f.entries[2].before.status, 'completed'); assert.equal(f.entries[2].after.status, 'live');
  f.record(pitch('strike'));
  assert.equal(f.game.status, 'completed');
  assert.deepEqual(replayAutomaticHistory('g', f.game, f.entries).at(-1), f.game.automaticScoring);
});

test('replacements replay subsequent actions and can restore a previously voided action', () => {
  const f = fixture([pitch('ball'), pitch('ball')]);
  f.record(correction(1, null));
  assert.equal(f.game.bases.first, true); assert.equal(f.game.bases.second, false);
  f.record(correction(1, pitch('ball')));
  assert.equal(f.game.bases.second, true);
  f.record(correction(1, pitch('foul')));
  assert.equal(f.game.bases.second, false);
  const replay = scoringPlayback(f.game, f.entries);
  assert.equal(replay.verifiedActions, true); assert.match(replay.frames.at(-1).action, /Correction to #1: Foul/);
});

test('removing all actions leaves an initialized live game that can continue', () => {
  const f = fixture([pitch('ball')]); f.record(correction(1, null));
  assert.equal(f.game.status, 'live'); assert.equal(f.game.lineScoreInning, 1); assert.equal(f.game.bases.first, false);
  f.record(pitch('strike'));
  assert.deepEqual(replayAutomaticHistory('g', f.game, f.entries).at(-1), f.game.automaticScoring);
});

test('corrections reject incompatible runner plays, clock order and early finalization', () => {
  const f = fixture([pitch('ball'), { schemaVersion: 1, type: 'play', elapsedMs: 0, runAward: 'ordinary',
    play: { schemaVersion: 1, type: 'runners', includesBatter: false, outcomes: [{ runner: 'first', destination: 'second' }] } }]);
  const original = structuredClone(f.game);
  assert.throws(() => f.record(correction(1, null)), error => error.code === 'correction-conflict');
  assert.deepEqual(f.game, original); assert.equal(f.entries.length, 2);
  const timed = fixture([pitch('ball', 1000), pitch('ball', 2000)]);
  assert.throws(() => timed.record(correction(1, pitch('ball', 3000))), error => error.code === 'correction-conflict');
  const early = fixture([pitch('ball'), pitch('strike'), pitch('ball')]);
  assert.throws(() => early.record(correction(1, pitch('strike'))), error => error.code === 'correction-conflict');
});

test('corrections require an original action, a reason, a real change and current revision', () => {
  const f = fixture([pitch('ball')]); f.record(correction(1, null));
  for (const action of [correction(1, null), correction(2, null), correction(3, null), correction(0, null),
    { ...correction(1, pitch('ball')), reason: '' }, { ...correction(1, pitch('ball')), reason: ' ' },
    { ...correction(1, pitch('ball')), reason: 'x'.repeat(301) }, { ...correction(1, pitch('ball')), extra: true },
    correction(1, correction(1, null))]) assert.throws(() => f.record(action));
  assert.throws(() => automaticCorrectionEntry({ gameId: 'g', game: f.game, entries: f.entries, action: correction(1, pitch('ball')),
    uid: 'scorer', expectedRevision: 1, engineVersion: 1 }), error => error.code === 'stale-revision');
});

test('tampered correction histories and mismatched reasons fail independent replay', () => {
  const f = fixture([pitch('ball')]); f.record(correction(1, null));
  for (const change of [event => { event.reason = 'Other'; }, event => { event.automatic.action.targetRevision = 2; },
    event => { event.automatic.action.replacement = pitch('strike'); }, event => { event.automatic.after.bases.first = true; }]) {
    const entries = structuredClone(f.entries); change(entries[1]);
    assert.throws(() => replayAutomaticHistory('g', f.game, entries));
    assert.equal(scoringPlayback(f.game, entries).verifiedActions, false);
  }
});

test('voiding a scoring play recomputes inning totals and final result while retaining the old result', () => {
  const homeRun = { schemaVersion: 1, type: 'play', elapsedMs: 0, runAward: 'home-run',
    play: { schemaVersion: 1, type: 'runners', includesBatter: true, outcomes: [{ runner: 'batter', destination: 'home' }] } };
  const f = fixture([homeRun, pitch('strike'), pitch('strike')]);
  assert.equal(f.game.awayScore, 1); assert.equal(f.game.automaticScoring.endReason, 'regulation');
  const original = structuredClone(f.entries), action = correction(1, null);
  const result = f.record(action);
  assert.equal(f.game.awayScore, 0); assert.equal(f.game.automaticScoring.endReason, 'tie');
  assert.deepEqual(f.game.lineScore, { 1: { home: 0, away: 0 } });
  assert.equal(result.entry.before.awayScore, 1); assert.equal(result.entry.after.awayScore, 0);
  assert.deepEqual(f.entries.slice(0, 3), original);
  action.reason = 'Changed later'; result.patch.automaticScoring.awayScore = 99;
  assert.equal(result.entry.automatic.action.reason, 'Scorer entered the wrong play');
  assert.equal(result.entry.automatic.after.awayScore, 0);
});

test('a correction cannot build on an incomplete or corrupted history', () => {
  const f = fixture([pitch('ball')]);
  for (const entries of [[], [null], [{ ...f.entries[0], scoredBy: '' }]]) {
    assert.throws(() => automaticCorrectionEntry({ gameId: 'g', game: f.game, entries, action: correction(1, null),
      uid: 'scorer', expectedRevision: 1, engineVersion: 1 }), error => error.code === 'history-inconsistent');
  }
});
