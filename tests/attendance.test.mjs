import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInTeams, attendanceUpdate } from '../attendance.mjs';
const game = { id: 'g', status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', date: '2026-09-26', time: '18:00', fieldId: 'f' };
const player = { id: 'p', name: 'Player', teamId: 'a' };
test('check-in access is scoped to active captain or manager team and open games', () => {
  assert.deepEqual(checkInTeams({ role: 'captain', linkedPlayerId: 'p' }, [player], game), ['a']);
  assert.deepEqual(checkInTeams({ role: 'captain', linkedPlayerId: 'p' }, [{ ...player, archived: true }], game), []);
  assert.deepEqual(checkInTeams({ role: 'parent' }, [player], game), []);
  assert.deepEqual(checkInTeams({ role: 'teamManager', linkedTeamId: 'b' }, [], game), ['b']);
  assert.deepEqual(checkInTeams({ role: 'siteAdmin' }, [], game), ['a', 'b']);
  assert.deepEqual(checkInTeams({ role: 'siteAdmin' }, [], { ...game, status: 'completed' }), []);
});
test('attendance validates roster and status and records schedule and next revision', () => {
  const result = attendanceUpdate(game, player, 'present', { revision: 2 }, 'captain');
  assert.equal(result.revision, 3); assert.equal(result.checkedBy, 'captain'); assert.equal(result.gameTime, '18:00');
  assert.throws(() => attendanceUpdate(game, { ...player, archived: true }, 'present', null, 'c'));
  assert.throws(() => attendanceUpdate(game, { ...player, teamId: 'other' }, 'present', null, 'c'));
  assert.throws(() => attendanceUpdate(game, player, 'going', null, 'c'));
  assert.throws(() => attendanceUpdate({ ...game, status: 'cancelled' }, player, 'present', null, 'c'));
});
