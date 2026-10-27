import test from 'node:test';
import assert from 'node:assert/strict';
import { profileAccess, validateProfileAccess, validAccessShape, sameProfileAccess } from '../profile-access.mjs';
const empty = { role: 'player', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] };

test('account roles require coherent links while new players may remain unlinked', () => {
  for (const role of ['siteAdmin', 'commissioner', 'leagueManager', 'umpire', 'scorekeeper', 'visitor', 'player']) {
    assert.deepEqual(validateProfileAccess({ ...empty, role }), { ...empty, role });
    assert.throws(() => validateProfileAccess({ ...empty, role, linkedTeamId: 'team' }));
  }
  for (const role of ['player', 'captain']) assert.equal(validateProfileAccess({ ...empty, role, linkedTeamId: 'team', linkedPlayerId: 'player' }).role, role);
  assert.equal(validateProfileAccess({ ...empty, role: 'teamManager', linkedTeamId: 'team' }).role, 'teamManager');
  for (const role of ['captain', 'teamManager', 'parent']) assert.throws(() => validateProfileAccess({ ...empty, role }));
  assert.throws(() => validateProfileAccess({ ...empty, role: 'captain', linkedPlayerId: 'player' }));
  assert.throws(() => validateProfileAccess({ ...empty, role: 'teamManager', linkedTeamId: 'team', linkedPlayerId: 'player' }));
});

test('parents support thirty distinct children and no unrelated access fields', () => {
  const children = Array.from({ length: 30 }, (_, i) => `child-${i}`);
  const valid = { ...empty, role: 'parent', linkedPlayerIds: children };
  const result = validateProfileAccess(valid); children[0] = 'changed';
  assert.equal(result.linkedPlayerIds[0], 'child-0');
  for (const patch of [{ linkedPlayerIds: [...children, 'overflow'] }, { linkedPlayerIds: ['p', 'p'] }, { linkedPlayerIds: ['../p'] },
    { linkedTeamId: 'team' }, { linkedPlayerId: 'p' }, { extra: true }, { role: 'unknown' }]) assert.throws(() => validateProfileAccess({ ...valid, ...patch }));
  assert.equal(validAccessShape(null), false);
});

test('access snapshots omit private fields and preserve stale confirmation comparisons', () => {
  assert.deepEqual(profileAccess({ role: 'player', email: 'private@example.test' }), empty);
  assert.equal(sameProfileAccess(empty, { ...empty, linkedTeamId: 'team' }), false);
  assert.equal(sameProfileAccess(empty, profileAccess({ ...empty, displayName: 'Changed' })), true);
  // Structurally valid legacy mismatches may be confirmed and repaired by an administrator.
  assert.equal(validAccessShape({ ...empty, role: 'parent', linkedPlayerIds: ['p', 'p'] }), true);
});
