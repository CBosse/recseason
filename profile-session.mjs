export function profileSession(user, data, previous = null) {
  if (!data) throw new Error('Your account profile is unavailable. Please sign in again.');
  const next = {
    uid: user.uid, email: user.email,
    displayName: data.displayName || user.email,
    role: data.role || 'player',
    linkedPlayerId: data.linkedPlayerId || null,
    linkedTeamId: data.linkedTeamId || null,
    linkedLeagueId: data.linkedLeagueId || null,
    linkedLeagueIds: data.linkedLeagueIds || [],
    linkedPlayerIds: data.linkedPlayerIds || [],
    emailReminders: data.emailReminders !== false,
  };
  const keys = ['uid', 'role', 'linkedPlayerId', 'linkedTeamId', 'linkedLeagueId', 'linkedLeagueIds', 'linkedPlayerIds'];
  const accessChanged = !previous || keys.some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
  return { user: accessChanged ? next : { ...previous, ...next }, accessChanged };
}
