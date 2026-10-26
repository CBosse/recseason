import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reminderHandler } from '../server/reminder-http.mjs';

const valid = { fieldId: 'main', expectedScheduleRevision: 4, values: { name: 'Main', availableDays: [1], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' } };
async function fixture(run, overrides = {}) {
  const calls = [];
  const server = createServer(reminderHandler({ origins: ['https://cbosse.github.io'], verifyToken: async () => ({ uid: 'verified' }),
    admit: async (uid, operation) => { assert.equal(uid, 'verified'); assert.equal(operation, 'update-field'); return true; },
    updateField: async request => { calls.push(request); return { status: 'updated', private: 'secret' }; }, ...overrides }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (body = valid, headers = {}, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}/api/fields/update`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  try { await run(send, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('field update HTTP verifies identity and exact nested payload; never accepts client daylight', async () => {
  await fixture(async (send, calls) => {
    const response = await send(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'updated' });
    assert.deepEqual(calls, [{ verifiedUid: 'verified', ...valid }]);
    for (const body of [null, [], {}, { ...valid, verifiedUid: 'forged' }, { ...valid, fieldId: '../fields' }, { ...valid, expectedScheduleRevision: -1 },
      { ...valid, values: { ...valid.values, sunrise: '00:00' } }, { ...valid, values: { ...valid.values, openTime: ['08:00'] } },
      { ...valid, values: { ...valid.values, availableDays: [7] } }, { ...valid, values: { ...valid.values, hasLights: false } }]) assert.equal((await send(body)).status, 400);
    assert.equal(calls.length, 1);
    assert.equal((await send(valid, { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await send(valid, { Authorization: '' })).status, 401);
    assert.equal((await send(valid, {}, 'GET')).status, 405);
    assert.equal((await send(valid, {}, 'OPTIONS')).status, 204);
    assert.equal((await send({ ...valid, junk: 'x'.repeat(1024) })).status, 413);
  });
});

test('field update maps conflicts and outages without leaking details, and uses independent throttling', async () => {
  for (const [overrides, status] of [[{ admit: async () => false }, 429], [{ verifyToken: async () => { throw new Error('secret'); } }, 401],
    ...[['permission-denied', 403], ['booking-conflict', 409], ['field-unavailable', 409], ['stale-revision', 409], ['invalid-request', 400], ['daylight-unavailable', 503], ['internal', 503]]
      .map(([code, status]) => [{ updateField: async () => { throw Object.assign(new Error('secret'), { code }); } }, status])]) {
    await fixture(async send => { const response = await send(); assert.equal(response.status, status); assert.ok(!(await response.text()).includes('secret')); }, overrides);
  }
});
