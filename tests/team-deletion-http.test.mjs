import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';

const valid = { teamId: 'empty', expectedRosterRevision: 3, expectedScheduleRevision: 4 };
async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'],
    verifyToken: async () => ({ uid: 'verified-organizer' }),
    admit: async (uid, operation) => { assert.equal(uid, 'verified-organizer'); assert.equal(operation, 'delete-team'); return true; },
    removeTeam: async request => { calls.push(request); return { status: 'deleted', private: 'secret' }; }, ...overrides,
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (body = valid, headers = {}, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}/api/teams/delete`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('team deletion endpoint uses verified identity and exact revision contract', async () => {
  await fixture(async (send, calls) => {
    const response = await send();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'deleted' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [{ verifiedUid: 'verified-organizer', ...valid }]);
    for (const body of [null, [], {}, { ...valid, verifiedUid: 'victim' }, { ...valid, teamId: '../users' },
      { ...valid, expectedRosterRevision: -1 }, { ...valid, expectedScheduleRevision: 1.5 },
      { ...valid, expectedRosterRevision: '3' }, { teamId: 'empty', expectedRosterRevision: 3 }]) assert.equal((await send(body)).status, 400);
    assert.equal(calls.length, 1);
    assert.equal((await send(valid, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(valid, { Authorization: '' })).status, 401);
    assert.equal((await send(valid, {}, 'GET')).status, 405);
    assert.equal((await send({ ...valid, teamId: 'x'.repeat(2000) })).status, 413);
    assert.equal((await send(valid, { Origin: 'https://cbosse.github.io' }, 'OPTIONS')).status, 204);
  });
});

test('team endpoint maps errors without leaking reference data and rate limits independently', async () => {
  for (const [overrides, expected] of [
    [{ verifyToken: async () => { throw new Error('secret'); } }, 401],
    [{ admit: async () => false }, 429],
    ...[['permission-denied', 403], ['team-in-use', 409], ['team-unavailable', 409], ['stale-revision', 409], ['internal', 503]]
      .map(([code, status]) => [{ removeTeam: async () => { throw Object.assign(new Error('secret'), { code }); } }, status]),
  ]) await fixture(async send => {
    const response = await send(); assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes('secret'));
    if (expected === 429) assert.equal(response.headers.get('retry-after'), '60');
  }, overrides);
});
