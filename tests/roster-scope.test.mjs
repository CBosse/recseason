import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterPresentation } from '../roster-scope.mjs';

const players = [{ id: 'a', teamId: 'home' }, { id: 'b', teamId: 'home', archived: true }];

test('organizer roster counts exclude archived players', () => {
  for (const role of ['siteAdmin', 'commissioner', 'leagueManager']) {
    const view = rosterPresentation({ role }, players);
    assert.equal(view.count, '1 active player');
    assert.equal(view.heading, 'All Players');
  }
});

test('manager only describes their linked team as a full roster', () => {
  const user = { role: 'teamManager', linkedTeamId: 'home' };
  assert.equal(rosterPresentation(user, players, 'home').count, '1 active player');
  assert.equal(rosterPresentation(user, players).heading, 'Team Players');
  assert.equal(rosterPresentation(user, [], 'away').count, 'Roster restricted');
  assert.equal(rosterPresentation({ role: 'teamManager' }, []).scope, 'restricted');
});

test('participants never present their visible records as full team totals', () => {
  for (const role of ['parent', 'player', 'captain']) {
    const view = rosterPresentation({ role }, players, 'home');
    assert.equal(view.count, '1 linked player');
    assert.equal(view.heading, 'Linked Players');
    assert.equal(view.note, 'Linked players only');
    assert.equal(rosterPresentation({ role }, players, 'away').count, '0 linked players');
    assert.equal(rosterPresentation({ role }, [], 'away').empty, 'No linked players.');
  }
});

test('officials and signed-out visitors see restricted, not empty rosters', () => {
  for (const user of [null, { role: 'visitor' }, { role: 'scorekeeper' }, { role: 'umpire' }]) {
    assert.equal(rosterPresentation(user, []).count, 'Roster restricted');
    assert.equal(rosterPresentation(user, []).empty, 'Roster access is restricted.');
  }
});
