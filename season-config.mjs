import { validateScheduleConfig, gamesConflict } from './scheduling.mjs';

export function validateSeasonChange(config, previous, games) {
  validateScheduleConfig(config);
  const active = games.filter(g => ['scheduled', 'live'].includes(g.status));
  for (const game of active) {
    if (game.date < config.startDate || game.date > config.endDate) throw new Error('Season dates would exclude an existing game. Reschedule it first.');
    if (config.gameDuration !== previous.gameDuration && game.durationMinutes == null) throw new Error('Set explicit durations on existing games before changing the default duration.');
  }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (gamesConflict(active[i], active[j], config.gameDuration, config.bufferMinutes)) throw new Error('These settings would create an existing game conflict. Reschedule the games first.');
    }
  }
}
