import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGameCreation } from '../server/game-creation-service.mjs';
const values = { date: '2026-06-01', time: '18:00', durationMinutes: 90, homeTeamId: 'a', awayTeamId: 'b', fieldId: 'f', umpireId: null, scorekeeperId: null, locked: true, ruleProfileId: null, ruleProfileRevision: null };
test('creation accepts only explicit scheduling inputs, never caller supplied score or names', () => {
  assert.deepEqual(validateGameCreation(values), values);
  for (const patch of [{ status: 'completed' }, { homeScore: 7 }, { homeName: 'Forged' }, { date: '2026-02-30' }, { time: '24:00' }, { durationMinutes: '90' }, { durationMinutes: 0 }, { homeTeamId: 'b' }, { fieldId: '../f' }, { locked: 'true' }, { umpireId: '' }, { scorekeeperId: {} }, { ruleProfileId: 'p' }, { ruleProfileRevision: 1 }]) {
    assert.throws(() => validateGameCreation({ ...values, ...patch }), { code: 'invalid-request' });
  }
  assert.doesNotThrow(() => validateGameCreation({ ...values, ruleProfileId: 'p', ruleProfileRevision: 1 }));
});
