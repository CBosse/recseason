import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationDetails, invitationProfilePatch } from '../invitations.mjs';
const context = { teams: [{ id: 'a' }], players: [{ id: 'p', teamId: 'a' }, { id: 'old', teamId: 'a', archived: true }] };
test('invitations normalize email and derive links from the selected role', () => {
  const invite = invitationDetails({ email: ' PERSON@Example.Test ', role: 'captain', linkedPlayerId: 'p', linkedPlayerIds: ['old'] }, context);
  assert.deepEqual(invite, { email: 'person@example.test', role: 'captain', linkedTeamId: 'a', linkedPlayerId: 'p', linkedPlayerIds: [] });
  assert.equal(invitationProfilePatch('invite', invite).acceptedInvitationId, 'invite');
});
test('parent links are explicit, unique and limited to active players', () => {
  const base = { email: 'parent@example.test', role: 'parent' };
  assert.deepEqual(invitationDetails({ ...base, linkedPlayerIds: ['p', 'p'] }, context).linkedPlayerIds, ['p']);
  for (const linkedPlayerIds of [[], ['unknown'], ['old']]) assert.throws(() => invitationDetails({ ...base, linkedPlayerIds }, context));
});
test('invalid emails, elevated roles and missing links are rejected', () => {
  for (const value of [{ email: 'bad', role: 'umpire' }, { email: 'a@b.test', role: 'siteAdmin' }, { email: 'a@b.test', role: 'teamManager' }, { email: 'a@b.test', role: 'player', linkedPlayerId: 'old' }]) assert.throws(() => invitationDetails(value, context));
});
