export function newPlayerProfile(user, displayName, createdAt = new Date().toISOString()) {
  if (!user?.uid || !user.email) throw new Error('An authenticated email account is required.');
  return {
    email: user.email,
    displayName: (displayName || user.email).trim().slice(0, 100),
    role: 'player',
    linkedTeamId: null,
    linkedPlayerId: null,
    linkedPlayerIds: [],
    createdAt,
  };
}
