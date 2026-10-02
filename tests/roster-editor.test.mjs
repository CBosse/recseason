import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterUpdate, checkedArchiveUpdate } from '../roster-editor.mjs';
test('player edits preserve links and archive metadata by returning only editable fields', () => {
  assert.deepEqual(rosterUpdate('player', { name: ' Alex ', number: ' 7 ', phone: ' 555 ', teamId: 'other', archived: true, id: 'other' }), { name: 'Alex', number: '7', phone: '555' });
});
test('team edits are trimmed and limited to team metadata', () => {
  assert.deepEqual(rosterUpdate('team', { name: ' Club ', color: 'Green', homefield: 'Main', id: 'other' }), { name: 'Club', color: 'Green', homefield: 'Main' });
});
test('invalid roster names and oversized fields are rejected', () => {
  assert.throws(() => rosterUpdate('player', { name: '  ' }));
  assert.throws(() => rosterUpdate('player', { name: 'A', phone: 'x'.repeat(41) }));
  assert.throws(() => rosterUpdate('team', { name: 'x'.repeat(101) }));
});

test('archive transitions preserve unrelated metadata and support legacy active players', () => {
  const original = { teamId: 't', name: 'Alex' };
  assert.deepEqual(checkedArchiveUpdate(original, { ...original, name: 'Updated', archived: false }), { archived: true });
  assert.deepEqual(checkedArchiveUpdate({ ...original, archived: true }, { ...original, archived: true }), { archived: false });
});

test('archive confirmation cannot act on a transferred, removed or already changed player', () => {
  const original = { teamId: 't', archived: false };
  assert.throws(() => checkedArchiveUpdate(original, null), /removed/);
  assert.throws(() => checkedArchiveUpdate(original, { ...original, teamId: 'other' }), /changed teams/);
  assert.throws(() => checkedArchiveUpdate(original, { ...original, archived: true }), /archive status/);
  assert.throws(() => checkedArchiveUpdate({ ...original, archived: true }, original), /archive status/);
});
