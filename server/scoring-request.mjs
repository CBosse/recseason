const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function automaticScoringEnabled(projectId, flag) {
  return projectId === 'demo-recseason' || (projectId === 'bosse-testing' && flag === 'v1');
}

export function validScoringRequest(body) {
  if (!exact(body, ['gameId', 'expectedRevision', 'engineVersion', 'action']) ||
      typeof body.gameId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.gameId) || body.engineVersion !== 1 ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER) return false;
  const action = body.action;
  if (!action || action.schemaVersion !== 1 || !Number.isSafeInteger(action.elapsedMs) || action.elapsedMs < 0) return false;
  if (action.type === 'clock') return Boolean(exact(action, ['schemaVersion', 'type', 'elapsedMs']));
  if (action.type !== 'play' || !exact(action, ['schemaVersion', 'type', 'elapsedMs', 'play', 'runAward']) ||
      !['ordinary', 'home-run'].includes(action.runAward)) return false;
  const play = action.play;
  if (!play || play.schemaVersion !== 1) return false;
  if (play.type === 'pitch') return Boolean(exact(play, ['schemaVersion', 'type', 'pitch']) && ['ball', 'strike', 'foul'].includes(play.pitch));
  if (play.type !== 'runners' || !exact(play, ['schemaVersion', 'type', 'includesBatter', 'outcomes']) ||
      typeof play.includesBatter !== 'boolean' || !Array.isArray(play.outcomes) || play.outcomes.length < 1 || play.outcomes.length > 4) return false;
  for (const event of play.outcomes) {
    if (!event || !['batter', 'first', 'second', 'third'].includes(event.runner)) return false;
    if (event.destination === 'out') {
      if (!exact(event, ['runner', 'destination', 'outType']) || !['tag', 'force', 'batter-before-first'].includes(event.outType)) return false;
    } else if (!exact(event, ['runner', 'destination']) || !['first', 'second', 'third', 'home'].includes(event.destination)) return false;
  }
  return true;
}
