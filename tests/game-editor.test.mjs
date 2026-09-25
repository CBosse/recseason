import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGame } from '../game-editor.mjs';

const teams = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }));
const field = { id: 'f', name: 'Main', availableDays: [4], openTime: '09:00', closeTime: '21:00' };
const config = { startDate: '2026-09-01', endDate: '2026-09-30', gameDuration: 90, bufferMinutes: 15 };
const game = { id: 'g', date: '2026-09-24', time: '10:00', durationMinutes: 90, fieldId: 'f', homeTeamId: 'a', awayTeamId: 'b', umpireId: 'u' };
const context = { teams, fields: [field], games: [], config };

test('manual game resolves current names and numeric duration', () => {
  const result = validateGame({ ...game, durationMinutes: '90' }, context);
  assert.equal(result.durationMinutes, 90);
  assert.equal(result.homeName, 'A');
  assert.equal(result.awayName, 'B');
  assert.equal(result.fieldName, 'Main');
});

test('rejects invalid dates, times, duration, season, and references', () => {
  for (const patch of [{ date: '2026-09-31' }, { date: '2026-10-01' }, { time: '24:00' }, { durationMinutes: 0 }, { durationMinutes: 1.5 }, { durationMinutes: 1441 }, { homeTeamId: 'b' }, { fieldId: 'missing' }, { awayTeamId: 'missing' }]) {
    assert.throws(() => validateGame({ ...game, ...patch }, context));
  }
});

test('requires valid field hours and available weekday', () => {
  for (const patch of [{ availableDays: [] }, { openTime: '11:00' }, { closeTime: '11:00' }, { closeTime: undefined }, { availableDays: '4' }]) {
    assert.throws(() => validateGame(game, { ...context, fields: [{ ...field, ...patch }] }), /availability/);
  }
});

test('editing excludes itself but rejects shared field, team, or umpire overlaps', () => {
  assert.doesNotThrow(() => validateGame(game, { ...context, games: [game] }));
  for (const other of [
    { ...game, id: 'other' },
    { ...game, id: 'other', fieldId: 'elsewhere', umpireId: null },
    { ...game, id: 'other', fieldId: 'elsewhere', homeTeamId: 'c', awayTeamId: 'd' },
  ]) assert.throws(() => validateGame(game, { ...context, games: [other] }), /Conflict/);
});

test('buffer applies while cancelled games do not block bookings', () => {
  const other = { ...game, id: 'other', time: '08:30' };
  assert.throws(() => validateGame(game, { ...context, games: [other] }), /Conflict/);
  assert.doesNotThrow(() => validateGame(game, { ...context, games: [{ ...other, status: 'cancelled' }] }));
  assert.doesNotThrow(() => validateGame(game, { ...context, config: { ...config, bufferMinutes: 0 }, games: [other] }));
});
