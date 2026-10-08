import { scoreState, validatedScoreState } from './score-state.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function sameState(a, b) {
  return JSON.stringify(canonical(scoreState(a))) === JSON.stringify(canonical(scoreState(b)));
}

export function scoreReplay(game, entries) {
  if (!Array.isArray(entries) || entries.some(event => !event || typeof event !== 'object' || Array.isArray(event))) return { frames: [], warnings: ['Scoring history contains an invalid event.'] };
  const events = [...entries].sort((a, b) => a.revision - b.revision);
  const warnings = [];
  if (!events.length) return { frames: [], warnings: ['No recorded scoring events.'] };
  if (events.some(event => !Number.isSafeInteger(event.revision) || event.revision < 1 || !event.before || !event.after || (game.id && event.gameId !== game.id))) {
    return { frames: [], warnings: ['Scoring history contains an invalid event.'] };
  }
  try {
    for (const event of events) { validatedScoreState(event.before); validatedScoreState(event.after); }
  } catch {
    return { frames: [], warnings: ['Scoring history contains an invalid state.'] };
  }
  const frames = [{ revision: events[0].revision - 1, state: scoreState(events[0].before), reason: '', baseline: true }];
  if (events[0].revision !== 1) warnings.push('Earlier scoring events are missing. Replay starts at the earliest available snapshot.');
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const previous = events[index - 1];
    if (previous && event.revision !== previous.revision + 1) warnings.push(`Missing or duplicate revision before #${event.revision}.`);
    if (previous && !sameState(previous.after, event.before)) warnings.push(`State discontinuity before #${event.revision}.`);
    frames.push({ revision: event.revision, state: scoreState(event.after), reason: event.reason || '', scoredBy: event.scoredBy || '', recordedAt: event.recordedAt, baseline: false });
  }
  const last = events.at(-1);
  try {
    validatedScoreState(game);
    if (game.scoreRevision !== undefined && (last.revision !== game.scoreRevision || !sameState(last.after, game))) warnings.push('History does not match the displayed game. Close and reopen history to refresh.');
  } catch { warnings.push('The displayed game contains an invalid scoring state.'); }
  return { frames, warnings };
}
