import test from 'node:test';
import assert from 'node:assert/strict';
import { requestGameCreation, gameCreationEndpoint } from '../game-creation-client.mjs';
const values = { date: '2026-06-01', time: '18:00', durationMinutes: 90, homeTeamId: 'a', awayTeamId: 'b', fieldId: 'f', umpireId: null, scorekeeperId: null, locked: true, ruleProfileId: null, ruleProfileRevision: null };
const input = () => ({ endpoint: gameCreationEndpoint(true), gameId: 'game', expectedScheduleRevision: 4, values: { ...values },
  user: { uid: 'organizer', getIdToken: async () => 'token' }, isCurrent: () => true });
const response = (status = 201, body = { status: 'created', gameId: 'game' }) => ({ status, json: async () => body });
test('creation client captures inputs before token refresh and matches returned identity exactly', async () => {
  const args = input();
  args.user.getIdToken = async () => { args.values.time = '20:00'; return 'token'; };
  args.fetcher = async (url, options) => {
    assert.equal(url, gameCreationEndpoint(true)); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(options.body), { gameId: 'game', expectedScheduleRevision: 4, values }); return response();
  };
  assert.deepEqual(await requestGameCreation(args), { status: 'created', gameId: 'game' });
  assert.equal(gameCreationEndpoint(false), null);
});
test('creation client rejects unsafe endpoints, invalid inputs and stale sessions before sending', async () => {
  for (const patch of [{ endpoint: 'http://foreign.test/api/games/create' }, { endpoint: 'https://user:pass@example.test/api/games/create' },
    { gameId: '../game' }, { expectedScheduleRevision: -1 }, { values: { ...values, homeScore: 2 } }, { isCurrent: () => false }]) {
    let sent = false;
    await assert.rejects(requestGameCreation({ ...input(), ...patch, fetcher: async () => { sent = true; return response(); } }));
    assert.equal(sent, false);
  }
  let current = true, sent = false;
  await assert.rejects(requestGameCreation({ ...input(), isCurrent: () => current,
    user: { uid: 'organizer', getIdToken: async () => { current = false; return 'token'; } }, fetcher: async () => { sent = true; return response(); } }), { requiresRefresh: true });
  assert.equal(sent, false);
});
test('uncertain or conflicting creation requires inspection without automatic retry', async () => {
  for (const fetcher of [async () => { throw new Error('lost'); }, async () => response(201, { status: 'created', gameId: 'different' }),
    async () => response(409, { error: 'stale-revision' }), async () => response(403, {}), async () => response(503, {}),
    async () => ({ status: 201, json: async () => { throw new Error('bad JSON'); } })]) {
    let calls = 0;
    await assert.rejects(requestGameCreation({ ...input(), fetcher: async (...args) => { calls++; return fetcher(...args); } }), { requiresRefresh: true });
    assert.equal(calls, 1);
  }
  for (const stage of ['fetch', 'json']) {
    let current = true;
    await assert.rejects(requestGameCreation({ ...input(), isCurrent: () => current, fetcher: async () => {
      if (stage === 'fetch') current = false;
      return { status: 201, json: async () => { current = false; return { status: 'created', gameId: 'game' }; } };
    } }), { requiresRefresh: true });
  }
  await assert.rejects(requestGameCreation({ ...input(), fetcher: async () => response(429, {}) }), /one minute/);
  await assert.rejects(requestGameCreation({ ...input(), fetcher: async () => response(503, { error: 'daylight-unavailable' }) }), /Daylight/);
});
