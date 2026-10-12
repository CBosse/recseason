import test from 'node:test';
import assert from 'node:assert/strict';
import { parentInvitationEndpoint, requestParentAcceptance } from '../parent-invitation-client.mjs';

const options = () => ({ endpoint: parentInvitationEndpoint(true), invitationId: 'invite', user: { getIdToken: async () => 'token' }, isCurrent: () => true });

test('parent client sends only invitation ID with token and no ambient credentials', async () => {
  assert.equal(parentInvitationEndpoint(false), null);
  for (const status of ['accepted', 'already-accepted']) {
    const result = await requestParentAcceptance({ ...options(), fetcher: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:8082/api/parent-invitations/accept');
      assert.deepEqual(JSON.parse(init.body), { invitationId: 'invite' });
      assert.equal(init.headers.Authorization, 'Bearer token');
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
      return { status: 200, json: async () => ({ status, private: 'ignored' }) };
    } });
    assert.deepEqual(result, { status });
  }
});

test('parent client fails closed on disabled service, unsafe addresses, malformed IDs and changed sessions', async () => {
  let calls = 0;
  const base = { ...options(), fetcher: async () => { calls++; } };
  for (const patch of [{ endpoint: null }, { endpoint: 'http://foreign.test/api/parent-invitations/accept' },
    { endpoint: `${base.endpoint}?token=bad` }, { invitationId: '../users' }, { isCurrent: () => false }]) {
    await assert.rejects(requestParentAcceptance({ ...base, ...patch }));
  }
  let current = true;
  await assert.rejects(requestParentAcceptance({ ...base, isCurrent: () => current, user: { getIdToken: async () => { current = false; return 'token'; } } }), /account changed/);
  assert.equal(calls, 0);
  current = true;
  await assert.rejects(requestParentAcceptance({ ...options(), isCurrent: () => current, fetcher: async () => {
    current = false; return { status: 200, json: async () => ({ status: 'accepted' }) };
  } }), /account changed/);
});

test('parent client surfaces bounded errors without retrying uncertain requests', async () => {
  for (const status of [401, 403, 409, 429, 503]) {
    let calls = 0;
    await assert.rejects(requestParentAcceptance({ ...options(), fetcher: async () => { calls++; return { status }; } }));
    assert.equal(calls, 1);
  }
  await assert.rejects(requestParentAcceptance({ ...options(), fetcher: async () => { throw new Error('private'); } }), /could not be confirmed/);
  for (const value of [null, {}, { status: 'pending' }]) await assert.rejects(requestParentAcceptance({ ...options(), fetcher: async () => ({ status: 200, json: async () => value }) }), /could not be confirmed/);
});
