import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldDeletionEndpoint, requestFieldDeletion } from '../field-deletion-client.mjs';
const options = () => ({ endpoint: fieldDeletionEndpoint(true), fieldId: 'main', expectedScheduleRevision: 2,
  user: { uid: 'organizer', getIdToken: async () => 'token' }, isCurrent: () => true });
const response = (status = 200, value = { status: 'deleted' }) => ({ status, json: async () => value });

test('field removal sends its revision without ambient credentials or claimed identity', async () => {
  assert.equal(fieldDeletionEndpoint(false), null);
  assert.deepEqual(await requestFieldDeletion({ ...options(), fetcher: async (url, init) => {
    assert.equal(url, fieldDeletionEndpoint(true)); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { fieldId: 'main', expectedScheduleRevision: 2 });
    return response();
  } }), { status: 'deleted' });
});

test('field removal rejects unsafe requests and session changes before writing', async () => {
  let calls = 0;
  for (const patch of [{ endpoint: null }, { endpoint: 'http://other.test/api/fields/delete' }, { endpoint: `${fieldDeletionEndpoint(true)}?x=1` },
    { fieldId: '../main' }, { expectedScheduleRevision: -1 }, { user: null }, { isCurrent: () => false }]) {
    await assert.rejects(requestFieldDeletion({ ...options(), ...patch, fetcher: async () => { calls++; return response(); } }));
  }
  let active = true;
  await assert.rejects(requestFieldDeletion({ ...options(), isCurrent: () => active,
    user: { uid: 'organizer', getIdToken: async () => { active = false; return 'token'; } }, fetcher: async () => { calls++; return response(); } }));
  assert.equal(calls, 0);
});

test('field removal reports reference conflicts and uncertain responses without retrying', async () => {
  for (const [status, body, pattern] of [[409, { error: 'field-in-use' }, /linked/], [409, { error: 'stale-revision' }, /schedule changed/],
    [401, {}, /Sign in/], [403, {}, /organizer/], [429, {}, /wait/], [200, { status: 'deleted', extra: true }, /not be confirmed/]]) {
    let calls = 0;
    await assert.rejects(requestFieldDeletion({ ...options(), fetcher: async () => { calls++; return response(status, body); } }), pattern);
    assert.equal(calls, 1);
  }
  for (const stage of ['fetch', 'json']) {
    let active = true;
    await assert.rejects(requestFieldDeletion({ ...options(), isCurrent: () => active, fetcher: async () => {
      if (stage === 'fetch') active = false;
      return { status: 200, json: async () => { active = false; return { status: 'deleted' }; } };
    } }), /access changed/);
  }
});
