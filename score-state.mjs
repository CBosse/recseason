import { baseOccupancy } from './base-occupancy.mjs';

export function scoreState(game) {
  return { homeScore: game.homeScore ?? null, awayScore: game.awayScore ?? null, status: game.status,
    inning: game.inning ?? 1, half: game.half ?? 'top', balls: game.balls ?? 0, strikes: game.strikes ?? 0, outs: game.outs ?? 0, bases: baseOccupancy(game.bases), lineScore: game.lineScore ?? {}, scoreCarry: game.scoreCarry ?? null, lineScoreInning: game.lineScoreInning ?? null };
}
