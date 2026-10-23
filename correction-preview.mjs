import { replayAutomaticHistory } from './automatic-scoring.mjs';
import { createScoringGame, applyGameAction } from './game-rules.mjs';

export function correctionTargets(game, entries) {
  replayAutomaticHistory(game.id, game, entries);
  const active = new Map();
  for (const event of [...entries].sort((a, b) => a.revision - b.revision)) {
    const action = event.automatic.action;
    if (action.type === 'correction') active.get(action.targetRevision).action = action.replacement;
    else active.set(event.revision, { revision: event.revision, action, original: action });
  }
  let state = createScoringGame(game.rulesSnapshot);
  return [...active.values()].map(target => {
    const result = structuredClone({ ...target, before: state });
    if (target.action !== null) state = applyGameAction(state, target.action);
    return result;
  });
}
