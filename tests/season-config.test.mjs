import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeasonChange } from '../season-config.mjs';
const config = { startDate: '2026-09-01', endDate: '2026-10-01', gameDuration: 90, bufferMinutes: 15, rounds: 1 };
const game = { id: 'g', status: 'scheduled', date: '2026-09-15', time: '18:00', durationMinutes: 90, fieldId: 'f', homeTeamId: 'a', awayTeamId: 'b' };
test('season edits cannot exclude scheduled or live games', () => {
  assert.throws(() => validateSeasonChange({ ...config, startDate: '2026-09-16' }, config, [game]), /exclude/);
  assert.throws(() => validateSeasonChange({ ...config, endDate: '2026-09-14' }, config, [{ ...game, status: 'live' }]), /exclude/);
  assert.doesNotThrow(() => validateSeasonChange({ ...config, startDate: '2026-09-16' }, config, [{ ...game, status: 'cancelled' }]));
});
test('buffer changes reject conflicts and default duration cannot silently extend legacy games', () => {
  const later = { ...game, id: 'later', time: '19:45' };
  assert.doesNotThrow(() => validateSeasonChange(config, config, [game, later]));
  assert.throws(() => validateSeasonChange({ ...config, bufferMinutes: 20 }, config, [game, later]), /conflict/);
  assert.throws(() => validateSeasonChange({ ...config, gameDuration: 120 }, config, [{ ...game, durationMinutes: undefined }]), /explicit durations/);
  assert.doesNotThrow(() => validateSeasonChange({ ...config, gameDuration: 120 }, config, [game]));
});
