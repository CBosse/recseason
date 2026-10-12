import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';

async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({
    origins: ['https://cbosse.github.io'],
    verifyToken: async () => ({ uid: 'verified-parent' }),
    admit: async (uid, operation) => { assert.equal(uid, 'verified-parent'); assert.equal(operation, 'accept-parent'); return true; },
    acceptParent: async request => { calls.push(request); return { status: 'accepted', private: 'secret' }; },
    ...overrides,
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/parent-invitations/accept`;
  const send = (body = { invitationId: 'invite' }, headers = {}, method = 'POST') => fetch(url, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('parent endpoint accepts only invitation ID and takes identity from verified token', async () => {
  await fixture(async (send, calls) => {
    const response = await send();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'accepted' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [{ verifiedUid: 'verified-parent', invitationId: 'invite' }]);
    for (const body of [null, [], { invitationId: '../users' }, { gameId: 'game' },
      { invitationId: 'invite', verifiedUid: 'victim' }, { invitationId: 'invite', linkedPlayerIds: ['child'] }]) {
      assert.equal((await send(body)).status, 400);
    }
    assert.equal(calls.length, 1);
    assert.equal((await send(undefined, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(undefined, { Authorization: '' })).status, 401);
    assert.equal((await send(undefined, {}, 'GET')).status, 405);
    assert.equal((await send(undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await send({ invitationId: 'x'.repeat(2000) })).status, 413);
    const preflight = await send(undefined, { Origin: 'https://cbosse.github.io' }, 'OPTIONS');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://cbosse.github.io');
  });
});

test('parent endpoint rejects invalid auth, throttles, and returns bounded errors without private details', async () => {
  for (const [overrides, expected] of [
    [{ verifyToken: async () => { throw new Error('secret'); } }, 401],
    [{ verifyToken: async () => ({ uid: '../victim' }) }, 401],
    [{ admit: async () => false }, 429],
    ...[['permission-denied', 403], ['invitation-unavailable', 409], ['stale-links', 409], ['internal', 503]]
      .map(([code, status]) => [{ acceptParent: async () => { throw Object.assign(new Error('secret'), { code }); } }, status]),
  ]) await fixture(async send => {
    const response = await send();
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes('secret'));
    if (expected === 429) assert.equal(response.headers.get('retry-after'), '60');
  }, overrides);
});
