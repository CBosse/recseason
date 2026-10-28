import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSelection } from '../profile-access-editor.mjs';
const teams = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const players = [{ id: 'p', name: 'Player', teamId: 'b' }, { id: 'old', teamId: 'a', archived: true }, { id: 'orphan', teamId: 'missing' }];
const selection = { role: 'player', playerId: 'p', teamId: 'a', childIds: ['p'] };
test('account editor derives player team and clears links irrelevant to the chosen role', () => {
  assert.deepEqual(accessSelection(selection, teams, players), { role: 'player', linkedPlayerId: 'p', linkedTeamId: 'b', linkedPlayerIds: [] });
  assert.deepEqual(accessSelection({ ...selection, role: 'scorekeeper' }, teams, players), { role: 'scorekeeper', linkedPlayerId: null, linkedTeamId: null, linkedPlayerIds: [] });
  assert.equal(accessSelection({ ...selection, role: 'teamManager' }, teams, players).linkedTeamId, 'a');
  assert.deepEqual(accessSelection({ ...selection, role: 'parent' }, teams, players).linkedPlayerIds, ['p']);
});
test('account editor rejects unavailable selections, empty parent/captain links, and more than thirty children', () => {
  for (const patch of [{ playerId: 'old' }, { playerId: 'orphan' }, { role: 'captain', playerId: '' }, { role: 'parent', childIds: [] },
    { role: 'parent', childIds: ['old'] }, { role: 'parent', childIds: ['p', 'p'] }, { role: 'teamManager', teamId: 'missing' }]) {
    assert.throws(() => accessSelection({ ...selection, ...patch }, teams, players));
  }
  const many = Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, teamId: 'a' }));
  assert.throws(() => accessSelection({ role: 'parent', childIds: many.map(p => p.id) }, teams, many));
  assert.equal(accessSelection({ role: 'parent', childIds: many.slice(0, 30).map(p => p.id) }, teams, many).linkedPlayerIds.length, 30);
});
