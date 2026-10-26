const unavailable = () => new Error('Daylight lookup unavailable.');

async function readJson(fetcher, url, signal) {
  const response = await fetcher(url, { signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!response.ok || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw unavailable();
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function daylightWindow(data, date, lat, lng) {
  if (data?.date !== date || data.sun_status !== 'normal' || typeof data.tzid !== 'string' ||
      typeof data.lat !== 'number' || typeof data.lng !== 'number' || Math.abs(data.lat - lat) > 0.001 || Math.abs(data.lng - lng) > 0.001) throw unavailable();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: data.tzid, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const time = (value, roundUp) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value)) throw unavailable();
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw unavailable();
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` !== date || value.slice(0, 19) !== `${date}T${parts.hour}:${parts.minute}:${parts.second}`) throw unavailable();
    const minutes = Number(parts.hour) * 60 + Number(parts.minute) + (roundUp && Number(parts.second) > 0 ? 1 : 0);
    if (minutes >= 1440) throw unavailable();
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const sunrise = time(data.sunrise, true), sunset = time(data.sunset, false);
  if (sunrise >= sunset || Date.parse(data.sunrise) >= Date.parse(data.sunset)) throw unavailable();
  return { sunrise, sunset };
}

export function createFieldDaylightResolver({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  return async ({ zipCode, date, signal = AbortSignal.timeout(12000) }) => {
    signal.throwIfAborted();
    if (typeof zipCode !== 'string' || !/^\d{5}$/.test(zipCode) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw unavailable();
    const key = `${zipCode}/${date}`, saved = cache.get(key);
    if (saved && saved.expires > now()) return { ...saved.window };
    const location = await readJson(fetcher, `https://api.zippopotam.us/us/${zipCode}`, signal);
    if (location?.['post code'] !== zipCode || location['country abbreviation'] !== 'US' || !Array.isArray(location.places) || !location.places.length) throw unavailable();
    const place = location.places[0];
    const coordinate = (value, max) => {
      if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > max) throw unavailable();
      return Number(value);
    };
    const lat = coordinate(place.latitude, 90), lng = coordinate(place.longitude, 180);
    const data = await readJson(fetcher, `https://api.sunrise-sunset.org/v2?lat=${lat}&lng=${lng}&date=${date}`, signal);
    const window = daylightWindow(data, date, lat, lng);
    signal.throwIfAborted();
    cache.delete(key);
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, { window, expires: now() + 86400000 });
    return { ...window };
  };
}
