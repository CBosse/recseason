export function gameList(records) {
  const games = [], invalidIds = [];
  for (const game of records) {
    const date = typeof game?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(game.date) ? new Date(`${game.date}T12:00:00Z`) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== game.date ||
        typeof game.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(game.time) ||
        !['scheduled', 'live', 'completed', 'cancelled'].includes(game.status) ||
        !['homeTeamId', 'awayTeamId', 'fieldId'].every(key => typeof game[key] === 'string' && game[key].length > 0)) {
      invalidIds.push(game?.id ?? 'unknown'); continue;
    }
    games.push(game);
  }
  games.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return { games, invalidIds };
}
