import { isCurrentRsvp } from './rsvps.mjs';
import { rosterScope } from './roster-scope.mjs';

export function gameRsvpSummary(user, game, players, responses) {
  return [[game.homeTeamId, game.homeName], [game.awayTeamId, game.awayName]].flatMap(([teamId, name]) => {
    const scope = rosterScope(user, teamId);
    const active = new Set(players.filter(p => p.teamId === teamId && !p.archived).map(p => p.id));
    if (scope === 'restricted' || (scope === 'linked' && active.size === 0)) return [];
    const current = new Map(responses.filter(r => r.teamId === teamId && active.has(r.playerId) && isCurrentRsvp(r, game)).map(r => [r.playerId, r]));
    const count = status => [...current.values()].filter(r => r.status === status).length;
    return [{ label: `${name}${scope === 'linked' ? ' (linked players)' : ''}`, going: count('going'), maybe: count('maybe'), out: count('not_going') }];
  });
}
