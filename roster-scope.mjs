export function rosterScope(user, teamId = null) {
  if (['siteAdmin', 'commissioner', 'leagueManager'].includes(user?.role)) return 'full';
  if (user?.role === 'teamManager' && user.linkedTeamId && (!teamId || user.linkedTeamId === teamId)) return 'team';
  if (['parent', 'player', 'captain'].includes(user?.role)) return 'linked';
  return 'restricted';
}

export function rosterPresentation(user, players, teamId = null) {
  const scope = rosterScope(user, teamId);
  const active = players.filter(p => !p.archived && (!teamId || p.teamId === teamId)).length;
  const noun = scope === 'linked' ? 'linked player' : 'active player';
  return {
    scope,
    count: scope === 'restricted' ? 'Roster restricted' : `${active} ${noun}${active === 1 ? '' : 's'}`,
    heading: scope === 'full' ? 'All Players' : scope === 'team' ? 'Team Players' : scope === 'linked' ? 'Linked Players' : 'Players',
    empty: scope === 'restricted' ? 'Roster access is restricted.' : scope === 'linked' ? 'No linked players.' : 'No players on this roster yet.',
    note: scope === 'linked' ? 'Linked players only' : scope === 'restricted' ? 'Roster restricted' : '',
  };
}
