import { baseOccupancy } from './base-occupancy.mjs';

export function scoreState(game) {
  return { homeScore: game.homeScore ?? null, awayScore: game.awayScore ?? null, status: game.status,
    inning: game.inning ?? 1, half: game.half ?? 'top', balls: game.balls ?? 0, strikes: game.strikes ?? 0, outs: game.outs ?? 0, bases: baseOccupancy(game.bases), lineScore: game.lineScore ?? {}, scoreCarry: game.scoreCarry ?? null, lineScoreInning: game.lineScoreInning ?? null };
}

export function validatedScoreState(game) {
  // Bounds mirror the existing legacy Firestore scoring schema, not future league rules.
  if (!game || typeof game !== 'object' || Array.isArray(game)) throw new Error('Invalid scoring state.');
  const state = scoreState(game);
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!['scheduled', 'live', 'completed', 'cancelled'].includes(state.status) || !['top', 'bottom'].includes(state.half) ||
    !integer(state.inning, 1, 99) || !integer(state.balls, 0, 3) || !integer(state.strikes, 0, 2) || !integer(state.outs, 0, 2)) throw new Error('Invalid scoring counters.');
  for (const side of ['home', 'away']) {
    const total = state[`${side}Score`];
    if (!(total === null && ['scheduled', 'cancelled'].includes(state.status)) && !integer(total, 0, Number.MAX_SAFE_INTEGER)) throw new Error('Invalid scoring total.');
  }
  const scorePair = value => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && integer(value.home, 0, Number.MAX_SAFE_INTEGER) && integer(value.away, 0, Number.MAX_SAFE_INTEGER);
  if (!state.lineScore || typeof state.lineScore !== 'object' || Array.isArray(state.lineScore)) throw new Error('Invalid inning scores.');
  const innings = Object.entries(state.lineScore);
  if (innings.some(([key, value]) => !/^[1-9][0-9]?$/.test(key) || !scorePair(value))) throw new Error('Invalid inning scores.');
  if (state.lineScoreInning !== null && !integer(state.lineScoreInning, 1, 99)) throw new Error('Invalid inning entry.');
  if (innings.length || state.scoreCarry !== null) {
    if (!scorePair(state.scoreCarry)) throw new Error('Invalid unallocated runs.');
    for (const side of ['home', 'away']) {
      if (state.scoreCarry[side] + innings.reduce((sum, [, cell]) => sum + cell[side], 0) !== state[`${side}Score`]) throw new Error('Inning scores do not match the total.');
    }
  }
  return state;
}
