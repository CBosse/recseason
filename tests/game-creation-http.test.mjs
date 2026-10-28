import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';
const valid = { gameId: 'g', expectedScheduleRevision: 2, values: { date: '2026-06-01', time: '18:00', durationMinutes: 90,
  homeTeamId: 'a', awayTeamId: 'b', fieldId: 'f', umpireId: null, scorekeeperId: null, locked: true, ruleProfileId: null, ruleProfileRevision: null } };
async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'], verifyToken: async () => ({ uid: 'verified' }),
    admit: async (uid, operation) => { assert.equal(uid, 'verified'); assert.equal(operation, 'create-game'); return true; },
    createGame: async request => { calls.push(request); return { status: 'created', gameId: request.gameId, private: 'secret' }; }, ...overrides }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (body = valid, headers = {}, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}/api/games/create`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('creation HTTP verifies identity, rejects forged fields and supports maximum length references', async () => {
  await fixture(async (send, calls) => {
    const response = await send(); assert.equal(response.status, 201); assert.deepEqual(await response.json(), { status: 'created', gameId: 'g' });
    assert.deepEqual(calls, [{ verifiedUid: 'verified', ...valid }]);
    for (const body of [null, [], {}, { ...valid, verifiedUid: 'forged' }, { ...valid, gameId: '../g' }, { ...valid, expectedScheduleRevision: -1 },
      ...[{ sunrise: '00:00' }, { status: 'completed' }, { homeScore: 5 }, { homeName: 'Forged' }, { durationMinutes: '90' }].map(patch => ({ ...valid, values: { ...valid.values, ...patch } }))]) assert.equal((await send(body)).status, 400);
    assert.equal(calls.length, 1);
    const maximum = structuredClone(valid); maximum.gameId = 'g'.repeat(128);
    for (const key of ['homeTeamId', 'awayTeamId', 'fieldId', 'umpireId', 'scorekeeperId', 'ruleProfileId']) maximum.values[key] = key[0].repeat(128);
    maximum.values.ruleProfileRevision = Number.MAX_SAFE_INTEGER;
    assert.ok(JSON.stringify(maximum).length > 1024);
    assert.equal((await send(maximum)).status, 201);
    assert.equal((await send({ ...valid, junk: 'x'.repeat(4096) })).status, 413);
    assert.equal((await send(valid, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(valid, { Authorization: '' })).status, 401);
    assert.equal((await send(valid, {}, 'GET')).status, 405);
    assert.equal((await send(valid, {}, 'OPTIONS')).status, 204);
  });
});
test('creation HTTP reports actionable conflicts and hides internal failures', async () => {
  for (const [code, status] of [['permission-denied', 403], ['invalid-request', 400], ...['stale-revision', 'game-exists', 'reference-unavailable', 'invalid-field', 'stale-field', 'invalid-config', 'booking-conflict', 'invalid-booking', 'stale-rules', 'invalid-rules'].map(code => [code, 409]), ['daylight-unavailable', 503], ['unknown', 503]]) {
    await fixture(async send => { const response = await send(); assert.equal(response.status, status); assert.ok(!(await response.text()).includes('secret')); },
      { createGame: async () => { throw Object.assign(new Error('secret'), { code }); } });
  }
  await fixture(async send => { const response = await send(); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60'); }, { admit: async () => false });
  await fixture(async send => assert.equal((await send()).status, 401), { verifyToken: async () => { throw new Error('invalid token'); } });
});
