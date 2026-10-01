import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSession } from '../profile-session.mjs';

const auth = { uid: 'user', email: 'user@example.test' };
const profile = { role: 'parent', linkedPlayerIds: ['child'] };

test('role and link changes discard selections and impersonation from the prior access scope', () => {
  const previous = { ...profileSession(auth, profile).user, _selectedChildId: 'child', _impersonatingPlayerId: 'other' };
  for (const patch of [{ role: 'player' }, { linkedPlayerIds: ['new-child'] }, { linkedTeamId: 'team' }, { linkedPlayerId: 'self' }]) {
    const next = profileSession(auth, { ...profile, ...patch }, previous);
    assert.equal(next.accessChanged, true);
    assert.equal(next.user._selectedChildId, undefined);
    assert.equal(next.user._impersonatingPlayerId, undefined);
  }
});

test('display-name edits preserve selection and do not restart subscriptions', () => {
  const previous = { ...profileSession(auth, profile).user, _selectedChildId: 'child' };
  const next = profileSession(auth, { ...profile, displayName: 'New name' }, previous);
  assert.equal(next.accessChanged, false);
  assert.equal(next.user.displayName, 'New name');
  assert.equal(next.user._selectedChildId, 'child');
});

test('missing profiles fail closed and legacy optional links normalize consistently', () => {
  assert.throws(() => profileSession(auth, null), /unavailable/);
  const previous = profileSession(auth, { role: 'siteAdmin' }).user;
  assert.equal(profileSession(auth, { role: 'siteAdmin', linkedPlayerIds: [] }, previous).accessChanged, false);
  assert.equal(profileSession({ ...auth, uid: 'different' }, { role: 'siteAdmin' }, previous).accessChanged, true);
});
