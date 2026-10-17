import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';
import { validScoringRequest, automaticScoringEnabled } from '../server/scoring-request.mjs';

const valid = { gameId: 'game', expectedRevision: 0, engineVersion: 1,
  action: { schemaVersion: 1, type: 'play', elapsedMs: 0, runAward: 'ordinary',
    play: { schemaVersion: 1, type: 'pitch', pitch: 'ball' } } };

test('production scoring requires an explicit supported flag and unknown projects stay disabled', () => {
  assert.equal(automaticScoringEnabled('demo-recseason', undefined), true);
  assert.equal(automaticScoringEnabled('bosse-testing', 'v1'), true);
  for (const flag of [undefined, null, '', 'true', true, 'v2', ' v1']) assert.equal(automaticScoringEnabled('bosse-testing', flag), false);
  assert.equal(automaticScoringEnabled('other-project', 'v1'), false);
});
async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'],
    verifyToken: async token => { assert.equal(token, 'test-token'); return { uid: 'verified' }; },
    admit: async (uid, operation) => { assert.equal(uid, 'verified'); assert.equal(operation, 'record-play'); return true; },
    recordPlay: async request => { calls.push(request); return { status: 'live', revision: 1, private: 'secret' }; }, ...overrides }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (body = valid, headers = {}, method = 'POST', suffix = '') => fetch(`http://127.0.0.1:${server.address().port}/api/games/plays${suffix}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers },
    body: method === 'POST' ? typeof body === 'string' ? body : JSON.stringify(body) : undefined });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('scoring HTTP uses verified identity, exact requests and a minimal response', async () => {
  await fixture(async (send, calls) => {
    const result = await send(valid, { Origin: 'https://cbosse.github.io' });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { status: 'live', revision: 1 });
    assert.equal(result.headers.get('access-control-allow-origin'), 'https://cbosse.github.io');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [{ verifiedUid: 'verified', ...valid }]);
    for (const body of [null, [], {}, { ...valid, uid: 'forged' }, { ...valid, verifiedUid: 'forged' },
      { ...valid, gameId: '../games' }, { ...valid, expectedRevision: -1 }, { ...valid, expectedRevision: '0' },
      { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER }, { ...valid, engineVersion: 2 }, '{broken']) {
      assert.equal((await send(body)).status, 400);
    }
    assert.equal((await send('x'.repeat(1025))).status, 413);
    assert.equal((await send(valid, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(valid, { Authorization: '' })).status, 401);
    assert.equal((await send(valid, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await send(valid, {}, 'GET')).status, 405);
    assert.equal((await send(valid, {}, 'OPTIONS')).status, 204);
    assert.equal((await send(valid, {}, 'POST', '?uid=forged')).status, 404);
    assert.equal(calls.length, 1);
  });
});

test('scoring request schema rejects nested unknown fields, unsupported actions and unbounded outcomes', () => {
  const request = action => ({ ...valid, action });
  assert.equal(validScoringRequest(valid), true);
  assert.equal(validScoringRequest(request({ schemaVersion: 1, type: 'clock', elapsedMs: 10 })), true);
  const runner = { ...valid.action, play: { schemaVersion: 1, type: 'runners', includesBatter: true,
    outcomes: [{ runner: 'batter', destination: 'out', outType: 'batter-before-first' }] } };
  assert.equal(validScoringRequest(request(runner)), true);
  for (const action of [null, [], { ...valid.action, extra: true }, { ...valid.action, schemaVersion: 2 },
    { ...valid.action, elapsedMs: -1 }, { ...valid.action, elapsedMs: 0.5 }, { ...valid.action, type: 'guess' },
    { ...valid.action, runAward: 'guess' }, { ...valid.action, play: { ...valid.action.play, pitch: 'hit' } },
    { ...valid.action, play: { ...valid.action.play, extra: true } },
    ...[[], Array(5).fill({ runner: 'batter', destination: 'first' }), [null], [{ runner: 'unknown', destination: 'home' }],
      [{ runner: 'batter', destination: 'first', outType: 'tag' }], [{ runner: 'batter', destination: 'out' }],
      [{ runner: 'batter', destination: 'out', outType: 'guess' }]]
      .map(outcomes => ({ ...runner, play: { ...runner.play, outcomes } }))]) {
    assert.equal(validScoringRequest(request(action)), false);
  }
});

test('scoring HTTP hides failures, checks authentication, and supplies its own retry interval', async () => {
  await fixture(async send => {
    const result = await send(); assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '1');
  }, { admit: async () => false });
  for (const verifyToken of [async () => { throw new Error('revoked'); }, async () => ({ uid: '../forged' })]) {
    await fixture(async (send, calls) => { assert.equal((await send()).status, 401); assert.equal(calls.length, 0); }, { verifyToken });
  }
  for (const [code, status] of [['permission-denied', 403], ['game-unavailable', 409], ['game-incompatible', 409],
    ['history-inconsistent', 409], ['stale-revision', 409], ['invalid-action', 400], ['invalid-request', 400], ['scoring-disabled', 503], ['internal', 503]]) {
    await fixture(async send => {
      const response = await send(); assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: code === 'internal' ? 'temporarily-unavailable' : code });
    }, { recordPlay: async () => { throw Object.assign(new Error('secret'), { code }); } });
  }
});
