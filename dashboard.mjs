import { standings } from './results.mjs';

export function dashboardScope(user, players, games) {
  if (['siteAdmin', 'commissioner', 'leagueManager', 'visitor'].includes(user?.role)) return { games, teamIds: null };
  const playerIds = user?.role === 'parent' ? (user.linkedPlayerIds || []) : [user?.linkedPlayerId];
  const teamIds = [...new Set(user?.role === 'teamManager' ? [user.linkedTeamId].filter(Boolean) :
    players.filter(p => playerIds.includes(p.id) && !p.archived).map(p => p.teamId))];
  return { teamIds, games: games.filter(g => teamIds.includes(g.homeTeamId) || teamIds.includes(g.awayTeamId)) };
}

export function upcomingGames(games, today, includeLive = false) {
  return games.filter(g => (g.status === 'scheduled' || (includeLive && g.status === 'live')) && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export function rsvpTotals(game, players, rsvps) {
  const ids = new Set(players.filter(p => !p.archived && [game.homeTeamId, game.awayTeamId].includes(p.teamId)).map(p => p.id));
  const going = new Set(rsvps.filter(r => r.gameId === game.id && r.status === 'going' && ids.has(r.playerId)).map(r => r.playerId)).size;
  return { going, total: ids.size };
}

export function dashboardRecord(teams, games, teamIds) {
  return standings(teams, games).filter(row => teamIds === null || teamIds.includes(row.id))
    .reduce((record, row) => ({ wins: record.wins + row.W, losses: record.losses + row.L, ties: record.ties + row.T }), { wins: 0, losses: 0, ties: 0 });
}
