const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function fieldUpdate(values) {
  const name = String(values.name ?? '').trim(), zipCode = String(values.zipCode ?? '').trim();
  if (!name || name.length > 100) throw new Error('Enter a field name of 1 to 100 characters.');
  if (!validTime(values.openTime) || !validTime(values.closeTime) || values.openTime >= values.closeTime) throw new Error('Closing time must be later than opening time on the same day.');
  if (!Array.isArray(values.availableDays) || !values.availableDays.length || values.availableDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Select at least one valid weekday.');
  if (typeof values.hasLights !== 'boolean') throw new Error('Choose whether the field has lights.');
  if ((zipCode || !values.hasLights) && !/^\d{5}$/.test(zipCode)) throw new Error('Enter a five-digit ZIP code; unlit fields require it for daylight checks.');
  return { name, zipCode, openTime: values.openTime, closeTime: values.closeTime, hasLights: values.hasLights, availableDays: [...new Set(values.availableDays)].sort() };
}

export function fieldFitsGame(field, game, defaultDuration) {
  const duration = Number(game.durationMinutes ?? defaultDuration);
  const day = new Date(`${game.date}T12:00:00`).getDay();
  return validTime(game.time) && Number.isInteger(duration) && duration > 0 && field.availableDays.includes(day) &&
    game.time >= field.openTime && minutes(game.time) + duration <= minutes(field.closeTime);
}

export function fieldWindow(field, sun) {
  if (!validTime(field.openTime) || !validTime(field.closeTime)) return null;
  let open = field.openTime, close = field.closeTime;
  if (!field.hasLights) {
    if (!sun || !validTime(sun.sunrise) || !validTime(sun.sunset)) return null;
    open = open > sun.sunrise ? open : sun.sunrise;
    close = close < sun.sunset ? close : sun.sunset;
  }
  return open < close ? { open, close } : null;
}
