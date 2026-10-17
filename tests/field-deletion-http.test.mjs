import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';

const valid = { fieldId: 'unused', expectedScheduleRevision: 4 };
async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'], verifyToken: async () => ({ uid: 'verified' }),
    admit: async (uid, operation) => { assert.equal(uid, 'verified'); assert.equal(operation, 'delete-field'); return true; },
    removeField: async request => { calls.push(request); return { status: 'deleted', private: 'secret' }; }, ...overrides }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (body = valid, headers = {}, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}/api/fields/delete`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('field deletion accepts only verified identity and an exact revision contract', async () => {
  await fixture(async (send, calls) => {
    const response = await send(); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'deleted' });
    assert.deepEqual(calls, [{ verifiedUid: 'verified', ...valid }]);
    for (const body of [null, [], {}, { ...valid, verifiedUid: 'forged' }, { ...valid, fieldId: '../fields' },
      { ...valid, expectedScheduleRevision: -1 }, { ...valid, expectedScheduleRevision: '4' }, { ...valid, expectedScheduleRevision: 1.5 }]) assert.equal((await send(body)).status, 400);
    assert.equal(calls.length, 1);
    assert.equal((await send(valid, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(valid, { Authorization: '' })).status, 401);
    assert.equal((await send(valid, {}, 'GET')).status, 405);
    assert.equal((await send(valid, {}, 'OPTIONS')).status, 204);
  });
});
test('field deletion hides private failures and respects its own throttle', async () => {
  for (const [overrides, status] of [[{ admit: async () => false }, 429],
    ...[['permission-denied', 403], ['field-in-use', 409], ['field-unavailable', 409], ['stale-revision', 409], ['internal', 503]]
      .map(([code, status]) => [{ removeField: async () => { throw Object.assign(new Error('secret'), { code }); } }, status])]) {
    await fixture(async send => { const response = await send(); assert.equal(response.status, status); assert.ok(!(await response.text()).includes('secret')); }, overrides);
  }
});
