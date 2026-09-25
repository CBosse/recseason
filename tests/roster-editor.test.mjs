import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterUpdate } from '../roster-editor.mjs';
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
