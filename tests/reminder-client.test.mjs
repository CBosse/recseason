import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderEndpoint, requestGameReminder, requestReminderStatus } from '../reminder-client.mjs';
import { summarizeNotifications } from '../notification-status.mjs';
const result = { created: 1, existing: 2, recipients: 3, playersWithoutRecipient: 0 };
const options = { endpoint: reminderEndpoint(true), gameId: 'game', user: { getIdToken: async () => 'test-token' }, isCurrent: () => true };

test('status client uses authenticated status route and validates aggregate response', async () => {
  const summary = summarizeNotifications([{ status: 'accepted' }, { status: 'needs-review' }]);
  assert.deepEqual(await requestReminderStatus({ ...options, fetcher: async (url, request) => {
    assert.equal(url, `${options.endpoint}/status`); assert.equal(request.headers.Authorization, 'Bearer test-token');
    return new Response(JSON.stringify(summary), { status: 200 });
  } }), summary);
  await assert.rejects(requestReminderStatus({ ...options, fetcher: async () => new Response(JSON.stringify({ total: 0 }), { status: 200 }) }), /Invalid/);
});

test('production queue action stays disabled until endpoint release gates pass', () => {
  assert.equal(reminderEndpoint(false), null);
  assert.equal(reminderEndpoint(true), 'http://127.0.0.1:8082/api/game-reminders');
});
test('client sends only game identity with bearer token and strips unexpected response data', async () => {
  assert.deepEqual(await requestGameReminder({ ...options, fetcher: async (url, request) => {
    assert.equal(url, options.endpoint); assert.deepEqual(JSON.parse(request.body), { gameId: 'game' });
    assert.equal(request.headers.Authorization, 'Bearer test-token'); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
    return new Response(JSON.stringify({ ...result, private: 'hidden' }), { status: 202 });
  } }), result);
});
test('client rejects unsafe endpoints and session changes before sending', async () => {
  for (const endpoint of ['http://example.test/api/game-reminders', 'https://user:password@example.test/api/game-reminders', `${options.endpoint}?target=other`, null])
    await assert.rejects(requestGameReminder({ ...options, endpoint, fetcher: () => assert.fail('Must not send') }));
  let current = true;
  await assert.rejects(requestGameReminder({ ...options, user: { getIdToken: async () => { current = false; return 'token'; } }, isCurrent: () => current, fetcher: () => assert.fail('Must not send') }), /account changed/);
});
test('client reports auth, access, stale-game, throttle and uncertain network failures without auto-retry', async () => {
  for (const [status, message] of [[401, /Sign in again/], [403, /organizer/], [409, /Refresh/], [429, /one minute/], [503, /temporarily/]]) {
    let calls = 0;
    await assert.rejects(requestGameReminder({ ...options, fetcher: async () => { calls++; return new Response('private backend detail', { status }); } }), message);
    assert.equal(calls, 1);
  }
  await assert.rejects(requestGameReminder({ ...options, fetcher: async () => { throw new Error('private network detail'); } }), /could not be confirmed/);
  for (const body of [{ ...result, created: -1 }, { ...result, recipients: 100 }, { ...result, existing: '2' }])
    await assert.rejects(requestGameReminder({ ...options, fetcher: async () => new Response(JSON.stringify(body), { status: 202 }) }), /invalid result/);
});
