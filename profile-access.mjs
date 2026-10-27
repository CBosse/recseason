const roles = ['siteAdmin', 'commissioner', 'leagueManager', 'teamManager', 'captain', 'player', 'parent', 'umpire', 'scorekeeper', 'visitor'];
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const keys = ['role', 'linkedTeamId', 'linkedPlayerId', 'linkedPlayerIds'];

export function profileAccess(profile) {
  return { role: profile.role, linkedTeamId: profile.linkedTeamId ?? null,
    linkedPlayerId: profile.linkedPlayerId ?? null, linkedPlayerIds: [...(profile.linkedPlayerIds ?? [])] };
}

export function validAccessShape(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)) && roles.includes(value.role) &&
    (value.linkedTeamId === null || validId(value.linkedTeamId)) && (value.linkedPlayerId === null || validId(value.linkedPlayerId)) &&
    Array.isArray(value.linkedPlayerIds) && value.linkedPlayerIds.length <= 30 && value.linkedPlayerIds.every(validId));
}

export function validateProfileAccess(value) {
  if (!validAccessShape(value) || new Set(value.linkedPlayerIds).size !== value.linkedPlayerIds.length) throw new Error('Invalid account links.');
  const team = value.linkedTeamId !== null, player = value.linkedPlayerId !== null, children = value.linkedPlayerIds.length;
  const valid = value.role === 'parent' ? !team && !player && children > 0 :
    value.role === 'teamManager' ? team && !player && !children :
    value.role === 'captain' ? team && player && !children :
    value.role === 'player' ? team === player && !children : !team && !player && !children;
  if (!valid) throw new Error('The selected role and account links do not match.');
  return profileAccess(value);
}

export function sameProfileAccess(left, right) {
  return keys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
