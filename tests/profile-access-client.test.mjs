import test from 'node:test';
import assert from 'node:assert/strict';
import { requestProfileAccess, profileAccessEndpoint } from '../profile-access-client.mjs';
const empty = { role: 'player', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] };
const options = () => ({ endpoint: profileAccessEndpoint(true), targetUid: 'target', expectedAccess: { ...empty }, expectedRosterRevision: 2,
  access: { ...empty, role: 'parent', linkedPlayerIds: ['p'] }, user: { uid: 'admin', getIdToken: async () => 'token' }, isCurrent: () => true });
const response = (status = 200, value = { status: 'updated' }) => ({ status, json: async () => value });
test('account client captures links before token refresh without sending acting identity or cookies', async () => {
  assert.equal(profileAccessEndpoint(false), null);
  const input = options(); input.user.getIdToken = async () => { input.access.linkedPlayerIds.push('late'); return 'token'; };
  await requestProfileAccess({ ...input, fetcher: async (url, init) => {
    assert.equal(url, profileAccessEndpoint(true)); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { targetUid: 'target', expectedAccess: empty, expectedRosterRevision: 2, access: { ...empty, role: 'parent', linkedPlayerIds: ['p'] } });
    return response();
  } });
});
test('account client rejects unsafe endpoints, inputs and sessions before submission', async () => {
  let calls = 0;
  for (const patch of [{ endpoint: null }, { endpoint: 'http://foreign.test/api/accounts/access' }, { endpoint: `${profileAccessEndpoint(true)}?x=1` },
    { targetUid: '../target' }, { expectedAccess: null }, { expectedRosterRevision: -1 }, { access: { ...empty, role: 'parent' } }, { isCurrent: () => false }]) {
    await assert.rejects(requestProfileAccess({ ...options(), ...patch, fetcher: async () => { calls++; return response(); } }));
  }
  let active = true;
  await assert.rejects(requestProfileAccess({ ...options(), isCurrent: () => active, user: { uid: 'admin', getIdToken: async () => { active = false; return 'token'; } }, fetcher: async () => { calls++; return response(); } }));
  assert.equal(calls, 0);
});
test('account client requires refresh on stale, uncertain or late results without retrying', async () => {
  for (const [status, body, refresh] of [[409, { error: 'stale-profile' }, true], [409, { error: 'invalid-links' }, true], [409, { error: 'self-demotion' }, false],
    [401, {}, true], [403, {}, true], [429, {}, false], [200, { status: 'updated', extra: true }, true]]) {
    let calls = 0;
    await assert.rejects(requestProfileAccess({ ...options(), fetcher: async () => { calls++; return response(status, body); } }), error => Boolean(error.requiresRefresh) === refresh);
    assert.equal(calls, 1);
  }
  await assert.rejects(requestProfileAccess({ ...options(), fetcher: async () => { throw new Error('network'); } }), error => error.requiresRefresh);
  for (const stage of ['fetch', 'json']) {
    let active = true;
    await assert.rejects(requestProfileAccess({ ...options(), isCurrent: () => active, fetcher: async () => {
      if (stage === 'fetch') active = false;
      return { status: 200, json: async () => { active = false; return { status: 'updated' }; } };
    } }), /session changed/);
  }
});
