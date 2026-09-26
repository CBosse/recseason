import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterEntry } from '../team-roster.mjs';
test('team roster projection excludes contact and arbitrary private metadata', () => {
  assert.deepEqual(rosterEntry({ name: 'Player', teamId: 'a', phone: 'private', email: 'private', notes: 'private' }),
    { name: 'Player', number: '', teamId: 'a', archived: false });
  assert.equal(rosterEntry({ name: 'Player', teamId: 'a', number: '7', archived: true }).archived, true);
});
