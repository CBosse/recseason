const keys = ['date', 'time', 'durationMinutes', 'fieldId', 'fieldName', 'homeTeamId', 'awayTeamId', 'homeName', 'awayName', 'status', 'umpireId', 'scorekeeperId'];
const reservationKeys = ['date', 'time', 'durationMinutes', 'fieldId', 'homeTeamId', 'awayTeamId', 'umpireId', 'scorekeeperId'];

// Only public schedule fields belong in a notice's before/after record.
export function scheduleState(game) {
  return Object.fromEntries(keys.map(key => [key, game[key] ?? null]));
}

export function scheduleChanged(before, after) {
  return reservationKeys.some(key => (before[key] ?? null) !== (after[key] ?? null)) ||
    (before.status === 'cancelled' && after.status === 'scheduled');
}

export function scheduleChangeUpdate(before, after, changedBy, changedAt) {
  if (!before || !after) throw new Error('A schedule change requires an existing game.');
  if (!scheduleChanged(before, after)) return {};
  if (typeof changedBy !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(changedBy) || changedAt == null) throw new Error('A schedule change requires an authenticated actor and timestamp.');
  const revision = Object.hasOwn(before, 'lastScheduleChange') ? before.lastScheduleChange?.revision : 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) throw new Error('Invalid schedule change revision.');
  return { lastScheduleChange: { revision: revision + 1, before: scheduleState(before), after: scheduleState(after), changedBy, changedAt } };
}

export function currentScheduleChange(game) {
  const record = game?.lastScheduleChange;
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).length !== 5 || !['revision', 'before', 'after', 'changedBy', 'changedAt'].every(key => Object.hasOwn(record, key)) ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || record.changedAt == null ||
      typeof record.changedBy !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(record.changedBy)) return null;
  for (const state of [record.before, record.after]) {
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).length !== keys.length || !keys.every(key => Object.hasOwn(state, key))) return null;
  }
  const current = scheduleState(game);
  return keys.every(key => record.after[key] === current[key]) && scheduleChanged(record.before, record.after) ? record : null;
}

export function scheduleEvent(gameId, record) {
  if (typeof gameId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(gameId) ||
      !record || !currentScheduleChange({ ...record.after, lastScheduleChange: record })) throw new Error('Invalid schedule event.');
  return { id: `${gameId}_${record.revision}`, data: { gameId, change: record } };
}

export function scheduleEventHistory(gameId, game, events) {
  const current = currentScheduleChange(game);
  if (!current || !Array.isArray(events) || !events.length || events.length > 1000 || events.length !== current.revision) throw new Error('Incomplete schedule event history.');
  const ordered = events.map(event => ({ gameId: event.gameId, ...event.change })).sort((a, b) => a.revision - b.revision);
  for (const [index, event] of ordered.entries()) {
    const { gameId: source, ...record } = event;
    if (source !== gameId || record.revision !== index + 1) throw new Error('Invalid schedule event sequence.');
    scheduleEvent(gameId, record);
  }
  const latest = ordered.at(-1);
  if (latest.changedBy !== current.changedBy ||
      !(typeof latest.changedAt?.isEqual === 'function' ? latest.changedAt.isEqual(current.changedAt) : latest.changedAt === current.changedAt) ||
      !keys.every(key => latest.before[key] === current.before[key] && latest.after[key] === current.after[key])) throw new Error('Schedule event history does not match the game.');
  return ordered;
}
