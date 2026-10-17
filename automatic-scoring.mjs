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

// Recompute the complete action stream rather than trusting stored snapshots.
export function replayAutomaticHistory(gameId, game, entries) {
  if (!validId(gameId) || !game || !Array.isArray(entries) || !Number.isSafeInteger(game.scoreRevision) ||
      game.scoreRevision < 1 || entries.length !== game.scoreRevision) throw fail('history-inconsistent');
  let state;
  try { state = createScoringGame(game.rulesSnapshot); } catch { throw fail('history-inconsistent'); }
  const ordered = [...entries].sort((left, right) => left?.revision - right?.revision);
  const frames = [state];
  let previousScore = scoreState({ status: 'scheduled' });
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index], automatic = event?.automatic;
    if (!event || event.gameId !== gameId || event.revision !== index + 1 || !validId(event.scoredBy) ||
        automatic?.engineVersion !== 1 || !sameScoringData(automatic.before, state) ||
        !sameScoringData(event.before, previousScore)) throw fail('history-inconsistent');
    const previousInning = state.inning;
    try { state = applyGameAction(state, automatic.action); } catch { throw fail('history-inconsistent'); }
    previousScore = automaticScoreProjection(state, previousInning);
    if (!sameScoringData(automatic.after, state) || !sameScoringData(event.after, previousScore)) throw fail('history-inconsistent');
    frames.push(state);
  }
  if (!sameScoringData(state, game.automaticScoring) || !sameScoringData(previousScore, scoreState(game))) throw fail('history-inconsistent');
  return frames;
}
