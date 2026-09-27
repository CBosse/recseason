import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRevision, nextScheduleRevision } from '../schedule-version.mjs';
test('schedule revision starts at zero and advances exactly once per publication', () => {
  assert.equal(scheduleRevision(undefined), 0);
  assert.deepEqual(nextScheduleRevision(undefined, 0, 'admin'), { revision: 1, updatedBy: 'admin' });
  assert.deepEqual(nextScheduleRevision({ revision: 4 }, 4, 'admin'), { revision: 5, updatedBy: 'admin' });
});
test('stale or invalid schedule versions reject publication', () => {
  assert.throws(() => nextScheduleRevision({ revision: 5 }, 4, 'admin'), /another session/);
  for (const revision of [-1, 0.5, '1', NaN]) assert.throws(() => scheduleRevision({ revision }));
  assert.throws(() => nextScheduleRevision({ revision: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER, 'admin'));
});
