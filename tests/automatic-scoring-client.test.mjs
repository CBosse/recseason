import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticScoringEndpoint, requestAutomaticPlay } from '../automatic-scoring-client.mjs';

const options = () => ({ endpoint: automaticScoringEndpoint(true), gameId: 'g', game: { status: 'scheduled',
  rulesSnapshot: { profileId: 'league', schemaVersion: 1, revision: 1, name: 'League', rules: {
    innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3, startingBalls: 0, startingStrikes: 0,
    foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
    timeLimitMinutes: null, tiePolicy: 'allow-tie', extraInningRunner: 'none' } } },
  action: { schemaVersion: 1, type: 'play', elapsedMs: 0, runAward: 'ordinary', play: { schemaVersion: 1, type: 'pitch', pitch: 'ball' } },
  user: { uid: 'scorer', getIdToken: async () => 'token' }, isCurrent: () => true });
const success = () => ({ status: 200, json: async () => ({ status: 'live', revision: 1 }) });

test('scoring client validates and captures a play before token refresh without ambient credentials', async () => {
  assert.equal(automaticScoringEndpoint(false), null);
  const request = options(), original = structuredClone(request.action);
  request.user.getIdToken = async () => { request.action.play.pitch = 'strike'; return 'token'; };
  const result = await requestAutomaticPlay({ ...request, fetcher: async (url, init) => {
    assert.equal(url, automaticScoringEndpoint(true));
    assert.deepEqual(JSON.parse(init.body), { gameId: 'g', expectedRevision: 0, engineVersion: 1, action: original });
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, 'Bearer token'); assert.ok(init.signal instanceof AbortSignal);
    return success();
  } });
  assert.deepEqual(result, { status: 'live', revision: 1 });
});

test('unsafe endpoints, invalid plays and expired sessions fail before any request', async () => {
  let calls = 0;
  for (const patch of [{ endpoint: null }, { endpoint: 'broken' }, { endpoint: 'http://foreign.test/api/games/plays' },
    { endpoint: 'https://user:password@example.test/api/games/plays' }, { endpoint: `${automaticScoringEndpoint(true)}?extra=1` },
    { endpoint: `${automaticScoringEndpoint(true)}#extra` }, { gameId: '../games' }, { user: null },
    { action: {} }, { isCurrent: () => false }, { game: { status: 'live' } }]) {
    await assert.rejects(requestAutomaticPlay({ ...options(), ...patch, fetcher: async () => { calls++; return success(); } }));
  }
  let current = true;
  await assert.rejects(requestAutomaticPlay({ ...options(), isCurrent: () => current,
    user: { uid: 'scorer', getIdToken: async () => { current = false; return 'token'; } },
    fetcher: async () => { calls++; return success(); } }), error => error.code === 'session-changed' && error.needsRefresh);
  assert.equal(calls, 0);
});

test('session changes during either response stage cannot be treated as a successful save', async () => {
  for (const stage of ['fetch', 'json']) {
    let current = true;
    await assert.rejects(requestAutomaticPlay({ ...options(), isCurrent: () => current, fetcher: async () => {
      if (stage === 'fetch') current = false;
      return { status: 200, json: async () => { current = false; return { status: 'live', revision: 1 }; } };
    } }), error => error.code === 'session-changed' && error.needsRefresh);
  }
});

test('lost, malformed and unrecognized responses require refresh with no automatic retry', async () => {
  for (const factory of [() => { throw new Error('private'); },
    () => ({ status: 200, json: async () => { throw new Error('private'); } }),
    ...[null, {}, { status: 'live', revision: 2 }, { status: 'live', revision: 1, extra: true }]
      .map(value => () => ({ status: 200, json: async () => value })),
    () => ({ status: 503, json: async () => ({ error: 'temporarily-unavailable' }) })]) {
    let calls = 0;
    await assert.rejects(requestAutomaticPlay({ ...options(), fetcher: async () => { calls++; return factory(); } }),
      error => error.code === 'unconfirmed' && error.needsRefresh && !error.message.includes('private'));
    assert.equal(calls, 1);
  }
});

test('known errors distinguish refresh-required results, disabled service and safe throttling', async () => {
  for (const [status, error, code, needsRefresh] of [[401, '', 'authentication-required', true], [403, '', 'permission-denied', true],
    [409, 'stale-revision', 'refresh-required', true], [409, 'history-inconsistent', 'refresh-required', true],
    [400, 'invalid-action', 'invalid-action', true], [503, 'scoring-disabled', 'scoring-disabled', false], [429, '', 'rate-limited', false]]) {
    await assert.rejects(requestAutomaticPlay({ ...options(), fetcher: async () => ({ status,
      headers: { get: () => '1' }, json: async () => ({ error }) }) }),
    failure => failure.code === code && failure.needsRefresh === needsRefresh && (status !== 429 || failure.retryAfterMs === 1000));
  }
  for (const getIdToken of [async () => { throw new Error('private'); }, async () => '', async () => 'invalid token']) {
    await assert.rejects(requestAutomaticPlay({ ...options(), user: { uid: 'scorer', getIdToken },
      fetcher: async () => assert.fail('Must not send without a valid token') }), error => error.code === 'authentication-required');
  }
});
