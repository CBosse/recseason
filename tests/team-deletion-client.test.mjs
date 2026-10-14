import test from 'node:test';
import assert from 'node:assert/strict';
import { teamDeletionEndpoint, requestTeamDeletion } from '../team-deletion-client.mjs';
const base = () => ({ endpoint: teamDeletionEndpoint(true), teamId: 'empty', expectedRosterRevision: 3, expectedScheduleRevision: 5,
  user: { getIdToken: async () => 'token' }, isCurrent: () => true });

test('team client preserves confirmation revisions and sends no ambient credentials', async () => {
  assert.equal(teamDeletionEndpoint(false), null);
  assert.deepEqual(await requestTeamDeletion({ ...base(), fetcher: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8082/api/teams/delete');
    assert.deepEqual(JSON.parse(init.body), { teamId: 'empty', expectedRosterRevision: 3, expectedScheduleRevision: 5 });
    assert.equal(init.headers.Authorization, 'Bearer token');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    return { status: 200, json: async () => ({ status: 'deleted' }) };
  } }), { status: 'deleted' });
});
test('team client rejects unsafe requests and changed sessions without writing', async () => {
  let calls = 0;
  const options = { ...base(), fetcher: async () => { calls++; } };
  for (const patch of [{ endpoint: null }, { endpoint: 'http://other.test/api/teams/delete' }, { endpoint: `${options.endpoint}?extra=1` },
    { teamId: '../users' }, { expectedRosterRevision: -1 }, { expectedScheduleRevision: 1.5 }, { isCurrent: () => false }]) await assert.rejects(requestTeamDeletion({ ...options, ...patch }));
  let current = true;
  await assert.rejects(requestTeamDeletion({ ...options, isCurrent: () => current, user: { getIdToken: async () => { current = false; return 'token'; } } }), /access changed/);
  assert.equal(calls, 0);
  current = true;
  await assert.rejects(requestTeamDeletion({ ...base(), isCurrent: () => current, fetcher: async () => {
    current = false; return { status: 200, json: async () => ({ status: 'deleted' }) };
  } }), /access changed/);
});
test('team client reports stale, linked and uncertain results without automatic retries', async () => {
  for (const [status, error, pattern] of [[409, 'team-in-use', /linked accounts/], [409, 'stale-revision', /roster or schedule changed/],
    [409, 'team-unavailable', /already removed/], [401, '', /Sign in/], [403, '', /organizer access/], [429, '', /one minute/], [503, '', /unavailable/]]) {
    let calls = 0;
    await assert.rejects(requestTeamDeletion({ ...base(), fetcher: async () => { calls++; return { status, json: async () => ({ error }) }; } }), pattern);
    assert.equal(calls, 1);
  }
  await assert.rejects(requestTeamDeletion({ ...base(), fetcher: async () => { throw new Error('private'); } }), /could not be confirmed/);
  await assert.rejects(requestTeamDeletion({ ...base(), fetcher: async () => ({ status: 200, json: async () => ({ status: 'pending' }) }) }), /could not be confirmed/);
});
