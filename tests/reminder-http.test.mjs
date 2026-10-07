import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';

async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'], verifyToken: async token => { assert.equal(token, 'test-token'); return { uid: 'trusted' }; }, admit: async () => true,
    enqueue: async request => { calls.push(request); return { created: 1, existing: 0, recipients: 1, playersWithoutRecipient: 0, private: 'must-not-leak' }; }, ...overrides }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/game-reminders`;
  const send = (body = { gameId: 'game' }, headers = {}, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('reminder endpoint uses verified identity and returns only aggregate counts', async () => {
  await fixture(async (send, calls) => {
    const response = await send(); assert.equal(response.status, 202);
    assert.deepEqual(calls, [{ verifiedUid: 'trusted', gameId: 'game' }]);
    assert.deepEqual(await response.json(), { created: 1, existing: 0, recipients: 1, playersWithoutRecipient: 0 });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    for (const body of [{ gameId: 'game', verifiedUid: 'admin' }, { gameId: 'game', recipients: ['attacker@example.test'] }, null, [], { gameId: '../users' }]) assert.equal((await send(body)).status, 400);
    assert.equal(calls.length, 1);
  });
});

test('endpoint rejects foreign origins, methods, missing auth and unbounded bodies', async () => {
  await fixture(async send => {
    assert.equal((await send(undefined, { Origin: 'https://attacker.test' })).status, 403);
    assert.equal((await send(undefined, {}, 'GET')).status, 405);
    assert.equal((await send(undefined, { Authorization: '' })).status, 401);
    assert.equal((await send(undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await send({ gameId: 'x'.repeat(2000) })).status, 413);
    const preflight = await send(undefined, { Origin: 'https://cbosse.github.io' }, 'OPTIONS');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://cbosse.github.io');
  });
});

test('auth errors, throttle and storage errors fail closed without exposing details', async () => {
  for (const [overrides, status] of [
    [{ verifyToken: async () => { throw new Error('secret'); } }, 401],
    [{ admit: async () => false }, 429],
    [{ enqueue: async () => { throw Object.assign(new Error('secret'), { code: 'permission-denied' }); } }, 403],
    [{ enqueue: async () => { throw Object.assign(new Error('secret'), { code: 'game-unavailable' }); } }, 409],
    [{ enqueue: async () => { throw new Error('secret'); } }, 503],
  ]) await fixture(async send => { const response = await send(); assert.equal(response.status, status); assert.ok(!(await response.text()).includes('secret')); }, overrides);
});
