export const INVITABLE_ROLES = ['commissioner', 'leagueManager', 'teamManager', 'captain', 'player', 'parent', 'umpire', 'scorekeeper'];

export function invitationDetails(values, { teams, players }) {
  const email = String(values.email ?? '').trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (!INVITABLE_ROLES.includes(values.role)) throw new Error('Choose an invitation role.');
  let linkedTeamId = null, linkedPlayerId = null, linkedPlayerIds = [];
  if (values.role === 'teamManager') {
    linkedTeamId = values.linkedTeamId;
    if (!teams.some(t => t.id === linkedTeamId)) throw new Error('Choose a team.');
  }
  if (['player', 'captain'].includes(values.role)) {
    linkedPlayerId = values.linkedPlayerId;
    const player = players.find(p => p.id === linkedPlayerId && !p.archived);
    if (!player) throw new Error('Choose an active roster player.');
    linkedTeamId = player.teamId;
  }
  if (values.role === 'parent') {
    linkedPlayerIds = [...new Set(values.linkedPlayerIds || [])];
    if (!linkedPlayerIds.length || linkedPlayerIds.length > 30 || linkedPlayerIds.some(id => !players.some(p => p.id === id && !p.archived))) throw new Error('Choose between one and thirty active children.');
  }
  return { email, role: values.role, linkedTeamId, linkedPlayerId, linkedPlayerIds };
}

export function invitationProfilePatch(id, invitation) {
  return { role: invitation.role, linkedTeamId: invitation.linkedTeamId, linkedPlayerId: invitation.linkedPlayerId, linkedPlayerIds: invitation.linkedPlayerIds, acceptedInvitationId: id };
}
