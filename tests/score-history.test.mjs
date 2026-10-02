import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreHistoryEntry, correctionReason } from '../score-history.mjs';
import { createBackup, validateBackup } from '../scripts/backup-format.mjs';
test('score history preserves before and after state and requires the next revision', () => {
  const before = { status: 'scheduled', homeScore: null, awayScore: null };
  const patch = { status: 'live', homeScore: 1, awayScore: 0, scoreRevision: 1 };
  const entry = scoreHistoryEntry('game', before, patch, 'scorer');
  assert.equal(entry.before.homeScore, null);
  assert.equal(entry.after.homeScore, 1);
  assert.equal(entry.after.inning, 1);
  assert.throws(() => scoreHistoryEntry('game', before, { ...patch, scoreRevision: 2 }, 'scorer'), /changed/);
});
test('final-result corrections require a bounded nonblank reason', () => {
  assert.throws(() => correctionReason('completed', ' '), /reason/);
  assert.equal(correctionReason('scheduled', ''), '');
  const before = { status: 'completed', scoreRevision: 2 };
  const patch = { scoreRevision: 3, homeScore: 2, awayScore: 1 };
  for (const reason of ['', '  ', 'x'.repeat(301)]) assert.throws(() => scoreHistoryEntry('g', before, patch, 'admin', reason), /reason/);
  assert.equal(scoreHistoryEntry('g', before, patch, 'admin', ' Scorebook correction ').reason, 'Scorebook correction');
});
test('backups include score history while prior backups remain readable', () => {
  const backup = createBackup([], new Date().toISOString());
  assert.ok(backup.collections.includes('scoreEvents'));
  assert.doesNotThrow(() => validateBackup({ ...backup, collections: backup.collections.filter(c => c !== 'scoreEvents') }));
});
