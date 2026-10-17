import { baseOccupancy } from './base-occupancy.mjs';
import { validateLeagueRules } from './league-rules.mjs';

const positions = ['batter', 'first', 'second', 'third', 'home'];
const emptyBases = () => ({ first: false, second: false, third: false });
const invalid = () => new Error('Invalid runner play.');

export function advanceWalk(value) {
  if (value === undefined) throw invalid();
  const bases = baseOccupancy(value);
  return {
    bases: { first: true, second: bases.second || bases.first,
      third: bases.third || (bases.first && bases.second) },
    runs: Number(bases.first && bases.second && bases.third),
  };
}

// Outcomes are in observed chronological order. Out classifications are explicit
// scorer judgments, not guesses based on a hit label or the final occupied bases.
export function resolveRunnerPlay(rulesValue, state, play) {
  const rules = validateLeagueRules(rulesValue);
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      Object.keys(state).length !== 2 || !Object.hasOwn(state, 'bases') ||
      state.bases === undefined || !Number.isSafeInteger(state.outs) || state.outs < 0 || state.outs >= rules.outsPerHalf) throw invalid();
  const before = baseOccupancy(state.bases);
  if (!play || typeof play !== 'object' || Array.isArray(play) ||
      Object.keys(play).length !== 3 || play.schemaVersion !== 1 ||
      typeof play.includesBatter !== 'boolean' || !Array.isArray(play.outcomes)) throw invalid();
  const expected = positions.slice(1, 4).filter(base => before[base]);
  if (play.includesBatter) expected.unshift('batter');
  if (!expected.length || play.outcomes.length !== expected.length) throw invalid();
  const remaining = new Set(expected);
  const bases = emptyBases();
  const destinations = new Map();
  let outs = state.outs, runs = 0, ended = false, suppressRuns = false;
  for (const event of play.outcomes) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || !remaining.delete(event.runner)) throw invalid();
    const isOut = event.destination === 'out';
    const keys = isOut ? ['runner', 'destination', 'outType'] : ['runner', 'destination'];
    if (Object.keys(event).length !== keys.length || !keys.every(key => Object.hasOwn(event, key))) throw invalid();
    if (isOut) {
      if (ended || !['tag', 'force', 'batter-before-first'].includes(event.outType) ||
          (event.outType === 'batter-before-first' && event.runner !== 'batter') ||
          (event.outType === 'force' && (event.runner === 'batter' || !play.includesBatter))) throw invalid();
      outs++;
      if (outs === rules.outsPerHalf) {
        ended = true;
        suppressRuns = event.outType !== 'tag';
      }
    } else {
      const destination = positions.indexOf(event.destination);
      if (destination < 1 || destination < positions.indexOf(event.runner)) throw invalid();
      destinations.set(event.runner, destination);
      if (event.destination === 'home') {
        if (!ended) runs++;
      } else {
        if (bases[event.destination]) throw invalid();
        bases[event.destination] = true;
      }
    }
  }
  if (!ended) {
    let trailing = 0;
    for (const runner of expected) {
      const destination = destinations.get(runner);
      if (destination === undefined) continue;
      if (destination < trailing) throw invalid();
      trailing = destination;
    }
  }
  return { bases: ended ? emptyBases() : bases, outs, runs: suppressRuns ? 0 : runs, halfEnded: ended };
}
