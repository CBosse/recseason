import { validateGameRulesSnapshot } from './league-rules.mjs';
import { baseOccupancy } from './base-occupancy.mjs';
import { resolvePlay } from './play-rules.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const emptyBases = () => ({ first: false, second: false, third: false });
const stateKeys = ['engineVersion', 'rulesSnapshot', 'status', 'inning', 'half', 'balls', 'strikes', 'outs',
  'bases', 'homeScore', 'awayScore', 'lineScore', 'elapsedMs', 'lastInning', 'endReason'];
const fail = () => new Error('Invalid automatic game state.');

export function createScoringGame(snapshot) {
  const rulesSnapshot = validateGameRulesSnapshot(snapshot), { rules } = rulesSnapshot;
  return { engineVersion: 1, rulesSnapshot, status: 'live', inning: 1, half: 'top',
    balls: rules.startingBalls, strikes: rules.startingStrikes, outs: 0, bases: emptyBases(),
    homeScore: 0, awayScore: 0, lineScore: { 1: { home: 0, away: 0 } }, elapsedMs: 0,
    lastInning: rules.innings, endReason: null };
}

function validateState(state) {
  if (!exact(state, stateKeys) || state.engineVersion !== 1) throw fail();
  const { rules } = validateGameRulesSnapshot(state.rulesSnapshot);
  if (!['live', 'completed'].includes(state.status) || !['top', 'bottom'].includes(state.half) ||
      !integer(state.inning, 99) || state.inning < 1 || !integer(state.elapsedMs) ||
      !integer(state.lastInning, rules.innings) || state.lastInning < 1 ||
      !integer(state.balls, rules.ballsForWalk - 1) || !integer(state.strikes, rules.strikesForOut - 1) ||
      !integer(state.outs, rules.outsPerHalf - 1) || !integer(state.homeScore) || !integer(state.awayScore) ||
      state.bases === undefined) throw fail();
  baseOccupancy(state.bases);
  if ((state.status === 'live' && state.endReason !== null) ||
      (state.status === 'completed' && !['regulation', 'time-limit', 'walk-off', 'mercy', 'tie'].includes(state.endReason))) throw fail();
  if (state.lastInning < rules.innings && (rules.timeLimitMinutes === null ||
      state.elapsedMs < rules.timeLimitMinutes * 60000 || state.lastInning > state.inning)) throw fail();
  const keys = Array.from({ length: state.inning }, (_, index) => String(index + 1));
  if (!exact(state.lineScore, keys)) throw fail();
  let home = 0, away = 0;
  for (const cell of Object.values(state.lineScore)) {
    if (!exact(cell, ['home', 'away']) || !integer(cell.home) || !integer(cell.away)) throw fail();
    home += cell.home; away += cell.away;
  }
  if (!integer(home) || !integer(away) || home !== state.homeScore || away !== state.awayScore ||
      (state.half === 'top' && state.lineScore[state.inning].home !== 0)) throw fail();
  return rules;
}

function resetCount(state, rules) {
  state.balls = rules.startingBalls; state.strikes = rules.startingStrikes; state.outs = 0;
  state.bases = emptyBases();
}

function finish(state, rules, reason) {
  state.status = 'completed'; state.endReason = reason;
  resetCount(state, rules);
  return state;
}

export function applyGameAction(previous, action) {
  const rules = validateState(previous);
  if (previous.status !== 'live') throw new Error('This automatic game is already final.');
  const clockOnly = action?.type === 'clock';
  if (!exact(action, clockOnly ? ['schemaVersion', 'type', 'elapsedMs'] : ['schemaVersion', 'type', 'elapsedMs', 'play', 'runAward']) ||
      action.schemaVersion !== 1 || !['clock', 'play'].includes(action.type) ||
      !integer(action.elapsedMs) || action.elapsedMs < previous.elapsedMs ||
      (!clockOnly && !['ordinary', 'home-run'].includes(action.runAward))) throw new Error('Invalid automatic game action.');
  const state = structuredClone(previous);
  state.elapsedMs = action.elapsedMs;
  if (rules.timeLimitMinutes !== null && state.elapsedMs >= rules.timeLimitMinutes * 60000) {
    state.lastInning = Math.min(state.lastInning, state.inning);
  }
  const finalInning = state.inning >= state.lastInning;
  const side = state.half === 'top' ? 'away' : 'home';
  let halfEnded = false;
  if (!clockOnly) {
    const result = resolvePlay(rules, { balls: state.balls, strikes: state.strikes, outs: state.outs, bases: state.bases }, action.play);
    if (action.runAward === 'home-run' && (action.play.type !== 'runners' || !action.play.includesBatter ||
        action.play.outcomes.some(event => event.destination !== 'home'))) throw new Error('A home run must score every runner and the batter.');
    let runs = result.runs;
    const cap = rules.unlimitedFinalInning && (state.inning >= rules.innings || state.inning > state.lastInning) ? null : rules.runsPerHalf;
    const already = state.lineScore[state.inning][side];
    if (cap !== null) runs = Math.min(runs, Math.max(0, cap - already));
    // Ordinary walk-offs end at the winning run; over-the-fence home runs award
    // the whole play, still subject to the configured strict half-inning cap.
    if (state.half === 'bottom' && finalInning && action.runAward === 'ordinary') {
      runs = Math.min(runs, Math.max(0, state.awayScore - state.homeScore + 1));
    }
    state.lineScore[state.inning][side] += runs;
    state[`${side}Score`] += runs;
    if (!integer(state[`${side}Score`])) throw fail();
    Object.assign(state, result.state);
    halfEnded = result.halfEnded || (cap !== null && already + runs >= cap);
  }
  const difference = state.homeScore - state.awayScore;
  const mercy = rules.mercy && state.inning >= rules.mercy.afterInning;
  if (state.half === 'bottom' && mercy && difference >= rules.mercy.runs) return finish(state, rules, 'mercy');
  if (state.half === 'bottom' && finalInning && difference > 0) return finish(state, rules, 'walk-off');
  if (!halfEnded) return state;
  if (state.half === 'top') {
    if (mercy && difference >= rules.mercy.runs) return finish(state, rules, 'mercy');
    if (finalInning && difference > 0) return finish(state, rules, state.lastInning < rules.innings ? 'time-limit' : 'regulation');
    state.half = 'bottom';
  } else {
    if (mercy && -difference >= rules.mercy.runs) return finish(state, rules, 'mercy');
    if (finalInning && (difference !== 0 || rules.tiePolicy === 'allow-tie')) {
      return finish(state, rules, difference === 0 ? 'tie' : state.lastInning < rules.innings ? 'time-limit' : 'regulation');
    }
    if (state.inning === 99) throw new Error('Automatic scoring cannot advance beyond inning 99. An explicit resolution is required.');
    state.inning++; state.half = 'top';
    state.lineScore[state.inning] = { home: 0, away: 0 };
  }
  resetCount(state, rules);
  if (state.inning > state.lastInning && rules.extraInningRunner === 'second') state.bases.second = true;
  return state;
}

export function replayGameActions(snapshot, actions) {
  if (!Array.isArray(actions)) throw new Error('Provide a recorded action list.');
  let state = createScoringGame(snapshot);
  const frames = [];
  for (const action of actions) {
    state = applyGameAction(state, action);
    frames.push(state);
  }
  return frames;
}
