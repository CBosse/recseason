import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldDaylightResolver } from '../server/field-daylight.mjs';

const request = { zipCode: '02108', date: '2026-10-26' };
const location = { 'post code': '02108', 'country abbreviation': 'US', places: [{ latitude: '42.357', longitude: '-71.0637' }] };
const sun = { date: request.date, tzid: 'America/New_York', lat: 42.357, lng: -71.0637, sun_status: 'normal', sunrise: '2026-10-26T07:10:14-04:00', sunset: '2026-10-26T17:45:30-04:00' };
const fixture = (zip = location, daylight = sun) => createFieldDaylightResolver({ fetcher: async url => Response.json(url.includes('zippopotam') ? zip : daylight) });

test('daylight uses fixed origins, location timezone and conservative minute rounding; caches only verified data', async () => {
  let time = 0; const calls = [];
  const resolve = createFieldDaylightResolver({ now: () => time, fetcher: async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.ok(options.signal);
    return Response.json(url.includes('zippopotam') ? location : sun);
  } });
  const value = await resolve(request);
  assert.deepEqual(value, { sunrise: '07:11', sunset: '17:45' }); value.sunrise = '00:00';
  assert.deepEqual(await resolve(request), { sunrise: '07:11', sunset: '17:45' });
  assert.deepEqual(calls, ['https://api.zippopotam.us/us/02108', 'https://api.sunrise-sunset.org/v2?lat=42.357&lng=-71.0637&date=2026-10-26']);
  time = 86400000;
  await resolve(request); assert.equal(calls.length, 4);
  await assert.rejects(resolve({ ...request, signal: AbortSignal.abort() }));
});

test('daylight rejects wrong dates, timezone offsets, coordinates, polar days and malformed provider responses', async () => {
  for (const patch of [{ date: '2026-10-27' }, { tzid: 'bogus' }, { tzid: 'America/Los_Angeles' }, { lat: 0 }, { lng: '-71.0637' },
    { sun_status: 'midnight_sun' }, { sunrise: null }, { sunrise: '07:00' }, { sunset: '2026-10-26T07:00:00-04:00' },
    { sunrise: '2026-10-25T07:00:00-04:00' }, { sunrise: '2026-10-26T07:00:00+00:00' }]) {
    await assert.rejects(fixture(location, { ...sun, ...patch })(request));
  }
  for (const patch of [{ 'post code': '90210' }, { 'country abbreviation': 'CA' }, { places: [] },
    { places: [{ latitude: '42oops', longitude: '-71' }] }, { places: [{ latitude: '91', longitude: '-71' }] }]) {
    await assert.rejects(fixture({ ...location, ...patch })(request));
  }
});

test('daylight rejects unsafe inputs before fetching and bounds responses; failures are not cached', async () => {
  let calls = 0;
  const resolve = createFieldDaylightResolver({ fetcher: async () => { calls++; return new Response('x'.repeat(65537)); } });
  for (const patch of [{ zipCode: '../' }, { date: '2026-02-30' }, { date: 'tomorrow' }, { zipCode: 2108 }]) await assert.rejects(resolve({ ...request, ...patch }));
  assert.equal(calls, 0);
  await assert.rejects(resolve(request)); await assert.rejects(resolve(request)); assert.equal(calls, 2);
  for (const fetcher of [async () => new Response('{}', { status: 429 }), async () => new Response('bad JSON'), async () => { throw new Error('network'); }]) {
    await assert.rejects(createFieldDaylightResolver({ fetcher })(request));
  }
});

test('daylight handles DST, fractional offsets and midnight without using the host timezone', async () => {
  for (const [tzid, date, offset] of [['America/New_York', '2026-11-02', '-05:00'], ['America/Phoenix', '2026-07-01', '-07:00'], ['Asia/Kolkata', '2026-07-01', '+05:30']]) {
    assert.deepEqual(await fixture(location, { ...sun, tzid, date, sunrise: `${date}T06:00:00${offset}`, sunset: `${date}T18:00:00${offset}` })({ ...request, date }), { sunrise: '06:00', sunset: '18:00' });
  }
  assert.deepEqual(await fixture(location, { ...sun, tzid: 'UTC', sunrise: '2026-10-26T00:00:00+00:00', sunset: '2026-10-26T23:59:59+00:00' })(request), { sunrise: '00:00', sunset: '23:59' });
});
