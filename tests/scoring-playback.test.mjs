import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticScoreEntry } from '../automatic-scoring.mjs';
import { scoringPlayback } from '../scoring-playback.mjs';
import { scoreReplay } from '../score-replay.mjs';

function fixture() {
  let game = { id: 'g', status: 'scheduled', rulesSnapshot: {
    profileId: 'league', schemaVersion: 1, revision: 1, name: 'League', rules: {
      innings: 1, ballsForWalk: 1, strikesForOut: 1, outsPerHalf: 1, startingBalls: 0, startingStrikes: 0,
      foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
      timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none',
    },
  } };
  const entries = [];
  const pitch = value => ({ schemaVersion: 1, type: 'play', elapsedMs: 1000, runAward: 'ordinary',
    play: { schemaVersion: 1, type: 'pitch', pitch: value } });
  const actions = [pitch('ball'), { schemaVersion: 1, type: 'play', elapsedMs: 1000, runAward: 'home-run',
    play: { schemaVersion: 1, type: 'runners', includesBatter: true, outcomes: [
      { runner: 'first', destination: 'home' }, { runner: 'batter', destination: 'home' },
    ] } }, { schemaVersion: 1, type: 'clock', elapsedMs: 2000 }];
  for (const action of actions) {
    const { patch, entry } = automaticScoreEntry({ gameId: 'g', game, action, uid: 'scorer',
      expectedRevision: entries.length, engineVersion: 1 });
    game = { ...game, ...patch }; entries.push(entry);
  }
  return { game, entries };
}

test('automatic playback derives states and ordered action labels from verified plays', () => {
  const { game, entries } = fixture(), before = structuredClone(entries);
  const replay = scoringPlayback(game, [...entries].reverse());
  assert.equal(replay.verifiedActions, true);
  assert.equal(replay.frames.length, 4);
  assert.deepEqual(replay.frames.at(-1).state, game.automaticScoring);
  assert.equal(replay.frames[1].action, 'Ball at 1s');
  assert.equal(replay.frames[2].action, 'Over-the-fence home run at 1s: 1. Runner on first scores; 2. Batter scores');
  assert.equal(replay.frames[3].action, 'Clock: 2s');
  assert.deepEqual(entries, before);
});

test('automatic playback never falls back to snapshots for invalid or missing action history', () => {
  const { game, entries } = fixture();
  const altered = structuredClone(entries); altered[0].automatic.action.play.pitch = 'strike';
  for (const events of [[], null, entries.slice(1), altered, Array(3), entries.map(({ automatic, ...rest }) => rest)]) {
    const replay = scoringPlayback(game, events);
    assert.deepEqual(replay.frames, []); assert.equal(replay.verifiedActions, false); assert.equal(replay.warnings.length, 1);
  }
  const { automaticScoring, ...withoutMarker } = game;
  assert.equal(scoringPlayback(withoutMarker, entries).verifiedActions, false);
});

test('legacy history retains existing snapshot behavior and incomplete-history warnings', () => {
  const game = { id: 'legacy', status: 'scheduled' };
  assert.deepEqual(scoringPlayback(game, []), scoreReplay(game, []));
});
