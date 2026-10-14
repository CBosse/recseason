import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleState, scheduleChanged, scheduleChangeUpdate } from '../schedule-history.mjs';

const game = { status: 'scheduled', date: '2026-10-20', time: '18:00', durationMinutes: 90,
  fieldId: 'main', fieldName: 'Main', homeTeamId: 'home', awayTeamId: 'away', homeName: 'Home', awayName: 'Away' };

test('schedule changes capture bounded public before/after state without mutating the game', () => {
  const before = { ...game, privateNote: 'excluded', scoreRevision: 3 };
  const after = { ...before, time: '19:00', fieldId: 'second', fieldName: 'Second' };
  const change = scheduleChangeUpdate(before, after, 'organizer', 'server-time').lastScheduleChange;
  assert.deepEqual(change, { revision: 1, before: game, after: { ...game, time: '19:00', fieldId: 'second', fieldName: 'Second' }, changedBy: 'organizer', changedAt: 'server-time' });
  assert.equal(before.lastScheduleChange, undefined);
  assert.equal(before.time, '18:00');
  const next = scheduleChangeUpdate({ ...after, lastScheduleChange: change }, before, 'organizer', 'later').lastScheduleChange;
  assert.equal(next.revision, 2);
  assert.equal(next.before.time, '19:00');
  assert.equal(next.after.time, '18:00');
});

test('every reservation change and cancellation restoration is distinct from scoring and metadata', () => {
  for (const key of ['date', 'time', 'durationMinutes', 'fieldId', 'homeTeamId', 'awayTeamId']) assert.equal(scheduleChanged(game, { ...game, [key]: 'changed' }), true);
  for (const patch of [{ status: 'live' }, { status: 'completed' }, { status: 'cancelled' }, { locked: false }, { homeScore: 3 }, { fieldName: 'Renamed' }, { umpireId: 'new' }]) {
    assert.deepEqual(scheduleChangeUpdate(game, { ...game, ...patch }, 'organizer', 'now'), {});
  }
  assert.equal(scheduleChangeUpdate({ ...game, status: 'cancelled' }, game, 'organizer', 'now').lastScheduleChange.revision, 1);
});

test('schedule history rejects missing identity, invalid revisions and overflow; legacy omissions are explicit', () => {
  const after = { ...game, time: '19:00' };
  for (const revision of [null, undefined, -1, 0.5, '1', Number.MAX_SAFE_INTEGER, NaN]) assert.throws(() => scheduleChangeUpdate({ ...game, lastScheduleChange: { revision } }, after, 'organizer', 'now'));
  for (const actor of ['', '../users', null]) assert.throws(() => scheduleChangeUpdate(game, after, actor, 'now'));
  assert.throws(() => scheduleChangeUpdate(game, after, 'organizer', null));
  assert.throws(() => scheduleChangeUpdate(null, after, 'organizer', 'now'));
  assert.equal(scheduleState({}).durationMinutes, null);
  assert.equal(Object.keys(scheduleState({})).length, 10);
});
