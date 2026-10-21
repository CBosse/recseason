import { replayAutomaticHistory } from './automatic-scoring.mjs';
import { scoreReplay } from './score-replay.mjs';

export function scoringPlayback(game, entries) {
  const automatic = game?.automaticScoring !== undefined ||
    (Array.isArray(entries) && entries.some(entry => entry?.automatic !== undefined));
  if (!automatic) return scoreReplay(game, entries);
  try {
    const states = replayAutomaticHistory(game.id, game, entries);
    const ordered = [...entries].sort((a, b) => a.revision - b.revision);
    return { verifiedActions: true, warnings: [], frames: states.map((state, index) => ({
      revision: index, state, baseline: index === 0,
      reason: index ? ordered[index - 1].reason || '' : '',
      action: index ? describeScoringAction(ordered[index - 1].automatic.action) : 'Initial engine state',
    })) };
  } catch {
    return { verifiedActions: false, frames: [], warnings: [
      'Automatic play history could not be verified against the frozen rules and current game. Close and reopen history to refresh. If this persists, organizer review is required.',
    ] };
  }
}

function describeScoringAction(action) {
  if (action.type === 'correction') return `Correction to #${action.targetRevision}: ${action.replacement === null ? 'Voided action' : describeScoringAction(action.replacement)}`;
  const time = `${action.elapsedMs / 1000}s`;
  if (action.type === 'clock') return `Clock: ${time}`;
  if (action.play.type === 'pitch') return `${action.play.pitch[0].toUpperCase()}${action.play.pitch.slice(1)} at ${time}`;
  const outcomes = action.play.outcomes.map((outcome, index) => {
    const runner = outcome.runner === 'batter' ? 'Batter' : `Runner on ${outcome.runner}`;
    const destination = outcome.destination === 'home' ? 'scores' : outcome.destination === 'out'
      ? `out (${outcome.outType})` : `to ${outcome.destination}`;
    return `${index + 1}. ${runner} ${destination}`;
  });
  return `${action.runAward === 'home-run' ? 'Over-the-fence home run' : 'Runner play'} at ${time}: ${outcomes.join('; ')}`;
}
