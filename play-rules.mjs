import { validateLeagueRules } from './league-rules.mjs';
import { baseOccupancy } from './base-occupancy.mjs';
import { resolvePitch } from './pitch-rules.mjs';
import { advanceWalk, resolveRunnerPlay } from './runner-rules.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// A completed half is returned to the game reducer; it must start the next half
// before accepting another play. This layer does not decide game-ending rules.
export function resolvePlay(rulesValue, state, action) {
  const rules = validateLeagueRules(rulesValue);
  if (!exact(state, ['balls', 'strikes', 'outs', 'bases']) || state.bases === undefined ||
      !Number.isSafeInteger(state.balls) || state.balls < 0 || state.balls >= rules.ballsForWalk ||
      !Number.isSafeInteger(state.strikes) || state.strikes < 0 || state.strikes >= rules.strikesForOut ||
      !Number.isSafeInteger(state.outs) || state.outs < 0 || state.outs >= rules.outsPerHalf) throw new Error('Invalid play state.');
  const bases = baseOccupancy(state.bases);
  if (!action || action.schemaVersion !== 1) throw new Error('Unsupported play version.');
  let balls = state.balls, strikes = state.strikes, result, outcome;
  if (action.type === 'pitch' && exact(action, ['schemaVersion', 'type', 'pitch'])) {
    const pitch = resolvePitch(rules, { balls, strikes }, action.pitch);
    ({ balls, strikes, outcome } = pitch);
    result = { bases, outs: state.outs, runs: 0, halfEnded: false };
    if (outcome === 'walk') Object.assign(result, advanceWalk(bases));
    if (outcome === 'strikeout') {
      const outcomes = [{ runner: 'batter', destination: 'out', outType: 'batter-before-first' },
        ...Object.keys(bases).filter(base => bases[base]).map(base => ({ runner: base, destination: base }))];
      result = resolveRunnerPlay(rules, { bases, outs: state.outs }, { schemaVersion: 1, includesBatter: true, outcomes });
    }
  } else if (action.type === 'runners' && exact(action, ['schemaVersion', 'type', 'includesBatter', 'outcomes'])) {
    result = resolveRunnerPlay(rules, { bases, outs: state.outs }, {
      schemaVersion: 1, includesBatter: action.includesBatter, outcomes: action.outcomes,
    });
    outcome = 'runner-play';
    if (action.includesBatter || result.halfEnded) {
      balls = rules.startingBalls;
      strikes = rules.startingStrikes;
    }
  } else throw new Error('Unsupported play action.');
  return { state: { balls, strikes, outs: result.outs, bases: result.bases },
    runs: result.runs, halfEnded: result.halfEnded, outcome };
}
