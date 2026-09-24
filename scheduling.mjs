export function validateScheduleConfig(config) {
  const duration = Number(config.gameDuration);
  const buffer = Number(config.bufferMinutes);
  const rounds = Number(config.rounds);
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('Game duration must be between 1 and 1440 minutes.');
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 1440) throw new Error('Buffer must be between 0 and 1440 minutes.');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('Rounds must be between 1 and 20.');
  for (const date of [config.startDate, config.endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Choose valid season dates.');
  }
  const days = (Date.parse(config.endDate) - Date.parse(config.startDate)) / 86400000;
  if (days < 0 || days > 366) throw new Error('Season must end after it starts and span at most 366 days.');
}

const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function gamesConflict(a, b, duration, buffer = 0) {
  if (a.date !== b.date || a.status === 'cancelled' || b.status === 'cancelled') return false;
  const shared = a.fieldId === b.fieldId ||
    [a.homeTeamId, a.awayTeamId].some(id => id === b.homeTeamId || id === b.awayTeamId) ||
    (a.umpireId && a.umpireId === b.umpireId);
  if (!shared) return false;
  const startA = minutes(a.time), startB = minutes(b.time);
  return startA < startB + (b.durationMinutes ?? duration) + buffer &&
    startB < startA + (a.durationMinutes ?? duration) + buffer;
}

export function allocateMatchups(matchups, slots, duration, buffer, preserved = []) {
  const games = [], unscheduled = [];
  for (const matchup of matchups) {
    const slot = slots.find(candidate => {
      const game = { ...candidate, homeTeamId: matchup.home.id, awayTeamId: matchup.away.id };
      return ![...preserved, ...games].some(existing => gamesConflict(game, existing, duration, buffer));
    });
    if (!slot) { unscheduled.push(matchup); continue; }
    games.push({ ...slot, durationMinutes: duration,
      homeTeamId: matchup.home.id, homeName: matchup.home.name,
      awayTeamId: matchup.away.id, awayName: matchup.away.name });
  }
  return { games, skipped: unscheduled.length, unscheduled };
}
