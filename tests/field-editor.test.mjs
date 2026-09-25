import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldUpdate, fieldFitsGame, fieldWindow } from '../field-editor.mjs';
const field = { name: ' Main ', openTime: '09:00', closeTime: '21:00', availableDays: [5], hasLights: true, zipCode: '' };
test('field edits normalize names and days without writing unrelated fields', () => {
  const value = fieldUpdate({ ...field, availableDays: [5, 5, 1], id: 'ignore' });
  assert.equal(value.name, 'Main'); assert.deepEqual(value.availableDays, [1, 5]); assert.equal(value.id, undefined);
});
test('invalid field hours, weekdays, names and daylight locations reject', () => {
  for (const patch of [{ name: '' }, { openTime: '22:00' }, { closeTime: '09:00' }, { openTime: '24:00' }, { availableDays: [] }, { availableDays: [7] }, { hasLights: false }, { zipCode: 'bad' }]) assert.throws(() => fieldUpdate({ ...field, ...patch }));
  assert.equal(fieldUpdate({ ...field, hasLights: false, zipCode: '02101' }).zipCode, '02101');
});
test('existing games must fit field hours and weekdays, including their own duration', () => {
  const game = { date: '2026-09-25', time: '19:30', durationMinutes: 90 };
  assert.equal(fieldFitsGame(field, game, 120), true);
  assert.equal(fieldFitsGame(field, { ...game, time: '20:00' }, 90), false);
  assert.equal(fieldFitsGame(field, { ...game, date: '2026-09-26' }, 90), false);
  assert.equal(fieldFitsGame(field, { ...game, durationMinutes: 0 }, 90), false);
});
test('unlit scheduling fails closed on missing daylight and clips to verified daylight', () => {
  assert.deepEqual(fieldWindow(field, null), { open: '09:00', close: '21:00' });
  assert.equal(fieldWindow({ ...field, hasLights: false }, null), null);
  assert.deepEqual(fieldWindow({ ...field, hasLights: false }, { sunrise: '06:00', sunset: '18:30' }), { open: '09:00', close: '18:30' });
  assert.equal(fieldWindow({ ...field, hasLights: false, openTime: '19:00' }, { sunrise: '06:00', sunset: '18:30' }), null);
  assert.equal(fieldWindow({ ...field, closeTime: 'invalid' }, null), null);
});
