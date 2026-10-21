import { createScoringGame, applyGameAction } from './game-rules.mjs';
import { scoreHistoryEntry } from './score-history.mjs';
import { scoreState } from './score-state.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Automatic scoring could not be completed.'), { code });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const sameScoringData = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

export function automaticScoreProjection(state, lineScoreInning) {
  const { homeScore, awayScore, status, inning, half, balls, strikes, outs, bases, lineScore } = state;
  return structuredClone({ homeScore, awayScore, status, inning, half, balls, strikes, outs, bases, lineScore,
    scoreCarry: { home: 0, away: 0 }, lineScoreInning });
}

export function automaticScoreEntry({ gameId, game, action, uid, expectedRevision, engineVersion }) {
  if (!validId(gameId) || !validId(uid) || engineVersion !== 1 || !game ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw fail('invalid-request');
  if ((game.scoreRevision ?? 0) !== expectedRevision) throw fail('stale-revision');
  let before;
  if (game.automaticScoring === undefined) {
    if (game.status !== 'scheduled' || expectedRevision !== 0 || game.homeScore != null || game.awayScore != null ||
        ['inning', 'half', 'balls', 'strikes', 'outs', 'bases', 'lineScore', 'scoreCarry', 'lineScoreInning'].some(key => Object.hasOwn(game, key))) throw fail('game-incompatible');
    try { before = createScoringGame(game.rulesSnapshot); } catch { throw fail('game-incompatible'); }
  } else {
    before = game.automaticScoring;
    if (!before || expectedRevision < 1 || game.status !== 'live' ||
        !sameScoringData(before.rulesSnapshot, game.rulesSnapshot) ||
        !Number.isSafeInteger(game.lineScoreInning) || game.lineScoreInning < 1 || game.lineScoreInning > before.inning ||
        !sameScoringData(scoreState(game), automaticScoreProjection(before, game.lineScoreInning))) throw fail('history-inconsistent');
  }
  let after;
  try { after = applyGameAction(before, action); } catch { throw fail('invalid-action'); }
  const patch = { ...automaticScoreProjection(after, before.inning), automaticScoring: after,
    scoreRevision: expectedRevision + 1, scoredBy: uid };
  const entry = { ...scoreHistoryEntry(gameId, game, patch, uid),
    automatic: { engineVersion: 1, action: structuredClone(action), before: structuredClone(before), after: structuredClone(after) } };
  return { patch, entry };
}

function validCorrection(action) {
  return action && typeof action === 'object' && !Array.isArray(action) &&
    Object.keys(action).length === 5 && ['schemaVersion', 'type', 'targetRevision', 'replacement', 'reason'].every(key => Object.hasOwn(action, key)) &&
    action.schemaVersion === 1 && action.type === 'correction' && Number.isSafeInteger(action.targetRevision) && action.targetRevision > 0 &&
    typeof action.reason === 'string' && action.reason.trim() === action.reason && action.reason.length > 0 && action.reason.length <= 300 &&
    (action.replacement === null || ['play', 'clock'].includes(action.replacement?.type));
}

function correctedState(snapshot, active, action) {
  if (!validCorrection(action) || !active.has(action.targetRevision) ||
      sameScoringData(active.get(action.targetRevision), action.replacement)) throw fail('invalid-correction');
  active.set(action.targetRevision, structuredClone(action.replacement));
  let state = createScoringGame(snapshot), lineScoreInning = 1;
  try {
    for (const play of active.values()) {
      if (play === null) continue;
      lineScoreInning = state.inning;
      state = applyGameAction(state, play);
    }
  } catch { throw fail('correction-conflict'); }
  return { state, projection: automaticScoreProjection(state, lineScoreInning) };
}

// Corrections append a new revision; original actions and prior results stay intact.
export function automaticCorrectionEntry({ gameId, game, entries, action, uid, expectedRevision, engineVersion }) {
  if (!validId(gameId) || !validId(uid) || engineVersion !== 1 || !game || !validCorrection(action) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw fail('invalid-request');
  if (game.scoreRevision !== expectedRevision) throw fail('stale-revision');
  if (!['live', 'completed'].includes(game.status)) throw fail('game-unavailable');
  replayAutomaticHistory(gameId, game, entries);
  const active = new Map();
  for (const event of [...entries].sort((a, b) => a.revision - b.revision)) {
    const recorded = event.automatic.action;
    if (recorded.type === 'correction') active.set(recorded.targetRevision, recorded.replacement);
    else active.set(event.revision, recorded);
  }
  const { state, projection } = correctedState(game.rulesSnapshot, active, action);
  const patch = { ...projection, automaticScoring: state, scoreRevision: expectedRevision + 1, scoredBy: uid };
  const entry = { ...scoreHistoryEntry(gameId, game, patch, uid, action.reason), automatic: {
    engineVersion: 1, action: structuredClone(action), before: structuredClone(game.automaticScoring), after: structuredClone(state),
  } };
  return { patch, entry };
}

// Recompute the complete action stream rather than trusting stored snapshots.
export function replayAutomaticHistory(gameId, game, entries) {
  if (!validId(gameId) || !game || !Array.isArray(entries) || !Number.isSafeInteger(game.scoreRevision) ||
      game.scoreRevision < 1 || entries.length !== game.scoreRevision) throw fail('history-inconsistent');
  let state;
  try { state = createScoringGame(game.rulesSnapshot); } catch { throw fail('history-inconsistent'); }
  const ordered = [...entries].sort((left, right) => left?.revision - right?.revision);
  const frames = [state];
  const active = new Map();
  let previousScore = scoreState({ status: 'scheduled' });
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index], automatic = event?.automatic;
    if (!event || event.gameId !== gameId || event.revision !== index + 1 || !validId(event.scoredBy) ||
        automatic?.engineVersion !== 1 || !sameScoringData(automatic.before, state) ||
        !sameScoringData(event.before, previousScore)) throw fail('history-inconsistent');
    try {
      if (automatic.action?.type === 'correction') {
        if (event.reason !== automatic.action.reason) throw fail('history-inconsistent');
        const corrected = correctedState(game.rulesSnapshot, active, automatic.action);
        state = corrected.state; previousScore = corrected.projection;
      } else {
        const previousInning = state.inning;
        state = applyGameAction(state, automatic.action);
        active.set(event.revision, structuredClone(automatic.action));
        previousScore = automaticScoreProjection(state, previousInning);
      }
    } catch { throw fail('history-inconsistent'); }
    if (!sameScoringData(automatic.after, state) || !sameScoringData(event.after, previousScore)) throw fail('history-inconsistent');
    frames.push(state);
  }
  if (!sameScoringData(state, game.automaticScoring) || !sameScoringData(previousScore, scoreState(game))) throw fail('history-inconsistent');
  return frames;
}
