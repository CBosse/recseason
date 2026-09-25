import test from 'node:test';
import assert from 'node:assert/strict';
import { rsvpSchedule, isCurrentRsvp } from '../rsvps.mjs';
import { rsvpTotals } from '../dashboard.mjs';
const game = { id: 'g', date: '2026-09-25', time: '18:00', fieldId: 'main', homeTeamId: 'a', awayTeamId: 'b' };
const response = { gameId: 'g', playerId: 'p', status: 'going', ...rsvpSchedule(game) };

test('RSVP confirms the current date, time and field, not score or assignments', () => {
  assert.equal(isCurrentRsvp(response, game), true);
  for (const change of [{ date: '2026-09-26' }, { time: '20:00' }, { fieldId: 'other' }, { id: 'other' }]) {
    assert.equal(isCurrentRsvp(response, { ...game, ...change }), false);
  }
  assert.equal(isCurrentRsvp(response, { ...game, umpireId: 'new', homeScore: 4 }), true);
});

test('legacy and stale responses require reconfirmation and do not count as going', () => {
  assert.equal(isCurrentRsvp({ gameId: 'g', status: 'going' }, game), false);
  assert.equal(isCurrentRsvp({ gameId: 'g' }, { id: 'g' }), false);
  const moved = { ...game, time: '20:00' };
  const players = [{ id: 'p', teamId: 'a' }];
  assert.deepEqual(rsvpTotals(moved, players, [response]), { going: 0, total: 1 });
  assert.deepEqual(rsvpTotals(moved, players, [{ ...response, ...rsvpSchedule(moved) }]), { going: 1, total: 1 });
});
