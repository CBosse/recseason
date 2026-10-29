const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const keys = ['date', 'time', 'durationMinutes', 'homeTeamId', 'awayTeamId', 'fieldId', 'umpireId', 'scorekeeperId', 'locked', 'ruleProfileId', 'ruleProfileRevision'];
export function validateGameCreation(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== keys.length || !keys.every(key => Object.hasOwn(values, key)) ||
      typeof values.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isFinite(Date.parse(values.date)) || new Date(values.date).toISOString().slice(0, 10) !== values.date ||
      typeof values.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time) || !Number.isInteger(values.durationMinutes) || values.durationMinutes < 1 || values.durationMinutes > 1440 ||
      !['homeTeamId', 'awayTeamId', 'fieldId'].every(key => id(values[key])) || values.homeTeamId === values.awayTeamId ||
      !['umpireId', 'scorekeeperId'].every(key => values[key] === null || id(values[key])) || typeof values.locked !== 'boolean' ||
      !(values.ruleProfileId === null ? values.ruleProfileRevision === null : id(values.ruleProfileId) && Number.isSafeInteger(values.ruleProfileRevision) && values.ruleProfileRevision > 0)) {
    throw Object.assign(new Error('Invalid game creation request.'), { code: 'invalid-request' });
  }
  return { ...values };
}
