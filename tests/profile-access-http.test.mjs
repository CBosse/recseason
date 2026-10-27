import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';
const empty = { role: 'player', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] };
const valid = { targetUid: 'target', expectedAccess: empty, expectedRosterRevision: 2, access: { ...empty, role: 'scorekeeper' } };
async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'], verifyToken: async () => ({ uid: 'verified' }),
    admit: async (uid, operation) => { assert.equal(uid, 'verified'); assert.equal(operation, 'update-access'); return true; },
    updateAccess: async request => { calls.push(request); return { status: 'updated', private: 'secret' }; }, ...overrides }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (body = valid, headers = {}, route = 'accounts/access', method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('account access HTTP verifies acting identity and exact role/link confirmation contract', async () => {
  await fixture(async (send, calls) => {
    const result = await send(); assert.equal(result.status, 200); assert.deepEqual(await result.json(), { status: 'updated' });
    assert.deepEqual(calls, [{ verifiedUid: 'verified', ...valid }]);
    for (const body of [null, [], {}, { ...valid, verifiedUid: 'forged' }, { ...valid, targetUid: '../target' },
      { ...valid, expectedRosterRevision: '2' }, { ...valid, expectedAccess: { ...empty, email: 'secret' } },
      { ...valid, access: { ...empty, role: 'captain' } }, { ...valid, access: { ...empty, role: 'parent', linkedPlayerIds: ['p', 'p'] } }]) assert.equal((await send(body)).status, 400);
    assert.equal(calls.length, 1);
    assert.equal((await send(valid, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(valid, { Authorization: '' })).status, 401);
    assert.equal((await send(valid, {}, 'accounts/access', 'GET')).status, 405);
    assert.equal((await send(valid, {}, 'accounts/access', 'OPTIONS')).status, 204);
  });
});

test('account access payload limit accommodates thirty maximum-length child ids without enlarging other routes', async () => {
  const parent = { ...empty, role: 'parent', linkedPlayerIds: Array.from({ length: 30 }, (_, i) => `${i}`.padStart(128, 'p')) };
  const body = { ...valid, expectedAccess: parent, access: parent };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 1024);
  await fixture(async send => {
    assert.equal((await send(body)).status, 200);
    assert.equal((await send(body, {}, 'fields/update')).status, 413);
    assert.equal((await send({ ...body, junk: 'x'.repeat(16384) })).status, 413);
  });
});

test('account access HTTP hides internal details and rejects revoked tokens or throttled requests', async () => {
  for (const [overrides, status] of [[{ admit: async () => false }, 429], [{ verifyToken: async () => { throw new Error('secret'); } }, 401],
    ...[['permission-denied', 403], ['self-demotion', 409], ['account-unavailable', 409], ['stale-profile', 409], ['stale-roster', 409], ['invalid-links', 409], ['invalid-request', 400], ['internal', 503]]
      .map(([code, status]) => [{ updateAccess: async () => { throw Object.assign(new Error('secret'), { code }); } }, status])]) {
    await fixture(async send => { const response = await send(); assert.equal(response.status, status); assert.ok(!(await response.text()).includes('secret')); }, overrides);
  }
});
