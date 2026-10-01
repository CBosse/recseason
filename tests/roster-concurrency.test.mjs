import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedRosterUpdate } from '../roster-editor.mjs';
const player = { name: 'Player', number: '12', phone: '', teamId: 'home' };
const edit = { name: 'Renamed', number: '12', phone: '' };
test('stale player edits reject changed metadata, transfers and archive changes', () => {
  for (const patch of [{ name: 'Other edit' }, { number: '13' }, { phone: '555' }, { teamId: 'away' }, { archived: true }]) {
    assert.throws(() => checkedRosterUpdate('player', player, { ...player, ...patch }, edit), /another session/);
  }
  assert.throws(() => checkedRosterUpdate('player', player, null, edit), /removed/);
});
test('current player edits preserve legacy archive defaults and return metadata only', () => {
  assert.deepEqual(checkedRosterUpdate('player', player, { ...player, archived: false }, { ...edit, teamId: 'away', archived: true }), edit);
});
test('stale team edits reject overwritten metadata', () => {
  const team = { name: 'Home', color: 'Green', homefield: 'Park' };
  assert.throws(() => checkedRosterUpdate('team', team, { ...team, homefield: 'New park' }, team), /another session/);
  assert.deepEqual(checkedRosterUpdate('team', team, team, { ...team, name: 'Updated' }), { ...team, name: 'Updated' });
});
