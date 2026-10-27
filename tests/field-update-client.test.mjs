import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldUpdateEndpoint, requestFieldUpdate } from '../field-update-client.mjs';
const options = () => ({ endpoint: fieldUpdateEndpoint(true), fieldId: 'main', expectedScheduleRevision: 2,
  values: { name: ' Main ', availableDays: [1], openTime: '08:00', closeTime: '22:00', hasLights: true, zipCode: '' },
  user: { uid: 'organizer', getIdToken: async () => 'token' }, isCurrent: () => true });
const response = (status = 200, value = { status: 'updated' }) => ({ status, json: async () => value });

test('field update captures normalized values before token refresh without ambient identity', async () => {
  assert.equal(fieldUpdateEndpoint(false), null);
  const input = options();
  input.user.getIdToken = async () => { input.values.availableDays.push(2); return 'token'; };
  assert.deepEqual(await requestFieldUpdate({ ...input, fetcher: async (url, init) => {
    assert.equal(url, fieldUpdateEndpoint(true)); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { fieldId: 'main', expectedScheduleRevision: 2, values: { ...options().values, name: 'Main' } });
    return response();
  } }), { status: 'updated' });
});

test('field updates reject unsafe inputs and changed sessions before writing', async () => {
  let calls = 0;
  for (const patch of [{ endpoint: null }, { endpoint: 'http://other.test/api/fields/update' }, { endpoint: `${fieldUpdateEndpoint(true)}?x=1` },
    { fieldId: '../main' }, { expectedScheduleRevision: -1 }, { user: null }, { isCurrent: () => false }, { values: { ...options().values, closeTime: '07:00' } }]) {
    await assert.rejects(requestFieldUpdate({ ...options(), ...patch, fetcher: async () => { calls++; return response(); } }));
  }
  let active = true;
  await assert.rejects(requestFieldUpdate({ ...options(), isCurrent: () => active,
    user: { uid: 'organizer', getIdToken: async () => { active = false; return 'token'; } }, fetcher: async () => { calls++; return response(); } }));
  assert.equal(calls, 0);
});

test('field update conflicts, uncertain outcomes and late responses never auto-retry', async () => {
  for (const [status, body, refresh] of [[409, { error: 'booking-conflict' }, false], [409, { error: 'stale-revision' }, true],
    [503, { error: 'daylight-unavailable' }, false], [401, {}, false], [403, {}, false], [429, {}, false], [200, { status: 'updated', extra: true }, true]]) {
    let calls = 0;
    await assert.rejects(requestFieldUpdate({ ...options(), fetcher: async () => { calls++; return response(status, body); } }), error => Boolean(error.requiresRefresh) === refresh);
    assert.equal(calls, 1);
  }
  for (const stage of ['fetch', 'json']) {
    let calls = 0;
    await assert.rejects(requestFieldUpdate({ ...options(), fetcher: async () => {
      calls++; if (stage === 'fetch') throw new Error('network');
      return { status: 200, json: async () => { throw new Error('lost body'); } };
    } }), error => error.requiresRefresh === true);
    assert.equal(calls, 1);
    let active = true;
    await assert.rejects(requestFieldUpdate({ ...options(), isCurrent: () => active, fetcher: async () => {
      if (stage === 'fetch') active = false;
      return { status: 200, json: async () => { active = false; return { status: 'updated' }; } };
    } }), /access changed/);
  }
});
