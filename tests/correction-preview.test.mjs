import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticScoreEntry, automaticCorrectionEntry } from '../automatic-scoring.mjs';
import { correctionTargets } from '../correction-preview.mjs';
import { requestAutomaticPlay, automaticScoringEndpoint } from '../automatic-scoring-client.mjs';

function fixture() {
  let game = { id: 'g', status: 'scheduled', rulesSnapshot: { profileId: 'league', schemaVersion: 1, revision: 1, name: 'League', rules: {
    innings: 1, ballsForWalk: 1, strikesForOut: 1, outsPerHalf: 1, startingBalls: 0, startingStrikes: 0,
    foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
    timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none',
  } } };
  const entries = [], pitch = value => ({ schemaVersion: 1, type: 'play', elapsedMs: 0, runAward: 'ordinary', play: { schemaVersion: 1, type: 'pitch', pitch: value } });
  const record = action => {
    const create = action.type === 'correction' ? automaticCorrectionEntry : automaticScoreEntry;
    const { patch, entry } = create({ gameId: 'g', game, entries, action, uid: 'organizer', expectedRevision: entries.length, engineVersion: 1 });
    game = { ...game, ...patch }; entries.push(entry);
  };
  record(pitch('ball')); record(pitch('ball'));
  return { get game() { return game; }, entries, record };
}
const correction = { schemaVersion: 1, type: 'correction', targetRevision: 1, replacement: null, reason: 'Wrong pitch' };

test('correction targets use effective earlier actions and retain originals for restoration', () => {
  const f = fixture(); assert.equal(correctionTargets(f.game, f.entries)[1].before.bases.first, true);
  f.record(correction);
  const targets = correctionTargets(f.game, [...f.entries].reverse());
  assert.equal(targets.length, 2); assert.equal(targets[0].action, null);
  assert.equal(targets[0].original.play.pitch, 'ball'); assert.equal(targets[1].before.bases.first, false);
  targets[0].original.play.pitch = 'strike'; assert.equal(f.entries[0].automatic.action.play.pitch, 'ball');
  assert.throws(() => correctionTargets(f.game, f.entries.slice(1)));
});

test('correction client verifies history and captures confirmed payload before asynchronous token retrieval', async () => {
  const f = fixture(), action = structuredClone(correction);
  const request = { endpoint: automaticScoringEndpoint(true), gameId: 'g', game: f.game, entries: f.entries, action,
    user: { uid: 'organizer', getIdToken: async () => { action.reason = 'Changed later'; return 'token'; } }, isCurrent: () => true };
  let calls = 0;
  const fetcher = async (url, init) => {
    calls++; assert.deepEqual(JSON.parse(init.body).action, correction); assert.equal(init.credentials, 'omit');
    return { status: 200, json: async () => ({ status: 'live', revision: 3 }) };
  };
  assert.deepEqual(await requestAutomaticPlay({ ...request, fetcher }), { status: 'live', revision: 3 });
  await assert.rejects(requestAutomaticPlay({ ...request, entries: [], fetcher }));
  assert.equal(calls, 1);
});

test('correction client retains uncertain-save and stale-history safeguards', async () => {
  const f = fixture();
  const request = { endpoint: automaticScoringEndpoint(true), gameId: 'g', game: f.game, entries: f.entries, action: correction,
    user: { uid: 'organizer', getIdToken: async () => 'token' }, isCurrent: () => true };
  for (const [status, error] of [[409, 'correction-conflict'], [409, 'stale-revision'], [400, 'invalid-correction'], [503, 'unknown']]) {
    let calls = 0;
    await assert.rejects(requestAutomaticPlay({ ...request, fetcher: async () => { calls++; return { status, json: async () => ({ error }) }; } }),
      failure => failure.needsRefresh === true);
    assert.equal(calls, 1);
  }
});
