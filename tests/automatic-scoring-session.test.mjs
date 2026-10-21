import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoringSession, orderedRunnerOutcomes } from '../automatic-scoring-session.mjs';
import { liveScoreUpdate } from '../live-scoring.mjs';
import { inningScoreUpdate } from '../inning-scores.mjs';
const initial = { id: 'g', scoreRevision: 0, rulesSnapshot: { name: 'Frozen' } };
const saved = { ...initial, scoreRevision: 1, automaticScoring: {} };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('single-flight covers saving and authoritative reload, then applies a cooldown', async () => {
  const saving = deferred(), loading = deferred(); let calls = 0, now = 0;
  const session = createScoringSession({ initial, isCurrent: () => true, now: () => now,
    save: async () => { calls++; return saving.promise; }, load: () => loading.promise });
  const first = session.submit({});
  assert.equal(await session.submit({}), false); assert.equal(await session.refresh(), false);
  saving.resolve({ revision: 1 }); await Promise.resolve();
  assert.equal(session.busy, true); assert.equal(calls, 1);
  loading.resolve(saved); await first;
  assert.equal(session.game.scoreRevision, 1); assert.equal(session.waitMs, 1000);
  await assert.rejects(session.submit({}), /wait/);
  now = 1001; assert.equal(session.waitMs, 0);
});

test('uncertain saves freeze submissions until a successful authoritative refresh', async () => {
  let calls = 0;
  const session = createScoringSession({ initial, isCurrent: () => true, load: async () => saved,
    save: async () => { calls++; throw Object.assign(new Error('Unconfirmed'), { needsRefresh: true }); } });
  await assert.rejects(session.submit({})); assert.equal(session.refreshRequired, true);
  await assert.rejects(session.submit({}), /Refresh/); assert.equal(calls, 1);
  await session.refresh(); assert.equal(session.refreshRequired, false); assert.equal(session.game.scoreRevision, 1);
});

test('a saved play with a failed or stale reload stays blocked', async () => {
  for (const load of [async () => { throw new Error('Offline'); }, async () => initial,
    async () => ({ ...saved, scoreRevision: undefined }), async () => ({ ...saved, rulesSnapshot: {} })]) {
    const session = createScoringSession({ initial, isCurrent: () => true, save: async () => ({ revision: 1 }), load });
    await assert.rejects(session.submit({})); assert.equal(session.refreshRequired, true); assert.equal(session.busy, false);
  }
});

test('changed sessions cannot submit or consume a late reload', async () => {
  let current = false, calls = 0;
  const session = createScoringSession({ initial, isCurrent: () => current,
    save: async () => { calls++; return { revision: 1 }; }, load: async () => { current = false; return saved; } });
  await assert.rejects(session.submit({})); assert.equal(calls, 0);
  current = true; await assert.rejects(session.submit({})); assert.equal(session.refreshRequired, true);
  assert.equal(session.game.scoreRevision, 0);
});

test('runner order is explicit, complete and free from ties', () => {
  assert.deepEqual(orderedRunnerOutcomes([{ runner: 'batter', destination: 'out', outType: 'tag', order: '2' },
    { runner: 'third', destination: 'home', order: '1' }]), [{ runner: 'third', destination: 'home' }, { runner: 'batter', destination: 'out', outType: 'tag' }]);
  for (const orders of [[0], [2], [1, 1], [1, 3], [1.5]]) assert.throws(() => orderedRunnerOutcomes(orders.map(order => ({ order }))));
});

test('manual score helpers cannot desynchronize automatic games', () => {
  const game = { status: 'live', automaticScoring: {}, scoreRevision: 1 };
  assert.throws(() => liveScoreUpdate(game, {}, { uid: 'admin', role: 'siteAdmin' }, 1), /play scoring/);
  assert.throws(() => inningScoreUpdate(game, {}, 1), /play history/);
});
