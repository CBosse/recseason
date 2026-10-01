import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterRevision, nextRosterRevision } from '../roster-version.mjs';
test('roster version starts at zero and stale deletion snapshots are rejected', () => {
  assert.equal(rosterRevision(), 0);
  assert.deepEqual(nextRosterRevision(undefined, 0, 'manager'), { revision: 1, updatedBy: 'manager' });
  assert.throws(() => nextRosterRevision({ revision: 1 }, 0, 'admin'), /another session/);
  assert.throws(() => rosterRevision({ revision: -1 }), /Invalid/);
  assert.throws(() => nextRosterRevision({ revision: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER, 'admin'), /Cannot/);
});
