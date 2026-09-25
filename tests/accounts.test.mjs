import test from 'node:test';
import assert from 'node:assert/strict';
import { newPlayerProfile } from '../accounts.mjs';

test('every signup starts without elevated permissions or player links', () => {
  const profile = newPlayerProfile({ uid: 'new', email: 'new@example.com', role: 'siteAdmin', linkedTeamId: 'secret' }, 'New User', '2026-09-24');
  assert.equal(profile.role, 'player');
  assert.equal(profile.linkedTeamId, null);
  assert.equal(profile.linkedPlayerId, null);
  assert.deepEqual(profile.linkedPlayerIds, []);
  assert.equal(profile.displayName, 'New User');
});
test('profiles require authentication and limit display name size', () => {
  assert.throws(() => newPlayerProfile(null));
  assert.throws(() => newPlayerProfile({ uid: 'new' }));
  assert.equal(newPlayerProfile({ uid: 'new', email: 'new@example.com' }, 'a'.repeat(101)).displayName.length, 100);
  assert.equal(newPlayerProfile({ uid: 'new', email: 'new@example.com' }).displayName, 'new@example.com');
});
