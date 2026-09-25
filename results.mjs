export function parseScore(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Enter a non-negative whole-number score.');
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw new Error('Enter a non-negative whole-number score.');
  const score = Number(value);
  if (!Number.isSafeInteger(score) || score < 0) throw new Error('Enter a non-negative whole-number score.');
  return score;
}

export function scoreUpdate(home, away) {
  return { homeScore: parseScore(home), awayScore: parseScore(away), status: 'completed' };
}

export function standings(teams, games) {
  const rows = new Map(teams.map(team => [team.id, { id: team.id, name: team.name, GP: 0, W: 0, L: 0, T: 0, GF: 0, GA: 0, Pts: 0 }]));
  for (const game of games) {
    if (game.status !== 'completed' || game.homeTeamId === game.awayTeamId) continue;
    const home = rows.get(game.homeTeamId), away = rows.get(game.awayTeamId);
    if (!home || !away) continue;
    let hs, as;
    try { hs = parseScore(game.homeScore); as = parseScore(game.awayScore); }
    catch { continue; }
    home.GP++; away.GP++; home.GF += hs; home.GA += as; away.GF += as; away.GA += hs;
    if (hs > as) { home.W++; home.Pts += 3; away.L++; }
    else if (as > hs) { away.W++; away.Pts += 3; home.L++; }
    else { home.T++; away.T++; home.Pts++; away.Pts++; }
  }
  return [...rows.values()].sort((a, b) => b.Pts - a.Pts || (b.GF - b.GA) - (a.GF - a.GA) || b.GF - a.GF || a.name.localeCompare(b.name));
}
