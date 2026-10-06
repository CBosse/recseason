import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationUpdate, reschedulingUpdate } from '../game-status.mjs';
import { remainingMatchups } from '../scheduling.mjs';

test('cancellation only changes status and regeneration lock', () => {
  assert.deepEqual(cancellationUpdate({ status: 'scheduled', locked: true, homeScore: null }), { status: 'cancelled', locked: false });
  for (const game of [null, { status: 'completed' }, { status: 'live' }, { status: 'cancelled' }, { status: 'scheduled', homeScore: 0 }, { status: 'scheduled', scoreRevision: 1 }]) assert.throws(() => cancellationUpdate(game));
});

test('only unscored cancellations can be rescheduled', () => {
  assert.deepEqual(reschedulingUpdate({ status: 'cancelled', homeScore: null }), { status: 'scheduled' });
  assert.deepEqual(reschedulingUpdate({ status: 'live' }), {});
  for (const state of [{ homeScore: 0 }, { awayScore: 1 }, { scoreRevision: 1 }]) assert.throws(() => reschedulingUpdate({ status: 'cancelled', ...state }));
});

test('preserved games consume only their matching home-away quotas', () => {
  const ab = { home: { id: 'a' }, away: { id: 'b' } };
  const ba = { home: { id: 'b' }, away: { id: 'a' } };
  const played = { homeTeamId: 'a', awayTeamId: 'b', status: 'completed' };
  assert.deepEqual(remainingMatchups([ab, ba, ab, ba], [played]), [ba, ab, ba]);
  assert.deepEqual(remainingMatchups([ab, ba], [played, played, played]), [ba]);
  assert.deepEqual(remainingMatchups([ab, ba], [{ ...played, status: 'cancelled' }]), [ab, ba]);
  assert.deepEqual(remainingMatchups([ab, ba], [{ ...played, status: 'scheduled', locked: true }]), [ba]);
  assert.deepEqual(remainingMatchups([ab], [{ ...played, awayTeamId: 'unknown' }]), [ab]);
});
