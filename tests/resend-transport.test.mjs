import test from 'node:test';
import assert from 'node:assert/strict';
import { resendTransport } from '../server/resend-transport.mjs';

const config = { apiKey: 're_synthetic_test_only', sender: 'league@example.test' };
const message = { to: 'Player@Example.Test', subject: 'Game update', text: 'Synthetic notice.', idempotencyKey: 'a'.repeat(64) };
const response = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test('Resend transport sends one private recipient with fixed endpoint and stable idempotency header', async () => {
  let request;
  const transport = resendTransport({ ...config, fetcher: async (url, options) => { request = { url, options }; return response(200, { id: 'test-receipt' }); } });
  assert.deepEqual(await transport.send(message), { accepted: true, receipt: 'test-receipt' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Idempotency-Key'], message.idempotencyKey);
  assert.equal(request.options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.options.body), { from: 'RecSeason <league@example.test>', to: ['player@example.test'], subject: message.subject, text: message.text });
});

test('Resend transport rejects missing credentials and injected message fields before network access', async () => {
  for (const patch of [{ apiKey: '' }, { apiKey: 're_key\nsecret' }, { sender: 'x@example.test\nBcc: y@example.test' }, { timeoutMs: 120000 }]) assert.throws(() => resendTransport({ ...config, ...patch }));
  let calls = 0;
  const transport = resendTransport({ ...config, fetcher: async () => { calls++; } });
  for (const patch of [{ to: ['one@example.test', 'two@example.test'] }, { subject: 'Hi\nBcc: other' }, { text: '' }, { idempotencyKey: '../other' }]) await assert.rejects(transport.send({ ...message, ...patch }));
  assert.equal(calls, 0);
});

test('known rejections and rate-limit delays map to bounded queue outcomes', async () => {
  for (const status of [400, 401, 403, 404, 405, 422]) {
    const transport = resendTransport({ ...config, fetcher: async () => response(status) });
    assert.deepEqual(await transport.send(message), { accepted: false, retryable: false });
  }
  for (const [header, expected] of [['120', 120000], ['Thu, 01 Jan 1970 00:03:00 GMT', 180000], ['bad', 0], ['999999999999', 86400000]]) {
    const transport = resendTransport({ ...config, clock: () => 0, fetcher: async () => response(429, {}, { 'retry-after': header }) });
    assert.deepEqual(await transport.send(message), { accepted: false, retryable: true, retryAfterMs: expected });
  }
});

test('ambiguous responses and network errors expose no provider details and cannot report acceptance', async () => {
  for (const fetcher of [async () => { throw new Error(config.apiKey); }, ...[302, 408, 409, 500, 503].map(status => async () => response(status)), async () => response(200), async () => new Response('not json', { status: 200 })]) {
    await assert.rejects(resendTransport({ ...config, fetcher }).send(message), error => error.message === 'Email provider outcome is unknown.');
  }
});

test('provider requests carry a functioning timeout signal', async () => {
  const transport = resendTransport({ ...config, timeoutMs: 1, fetcher: async (_url, { signal }) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(signal.aborted, true);
    throw signal.reason;
  } });
  await assert.rejects(transport.send(message), /outcome is unknown/);
});
