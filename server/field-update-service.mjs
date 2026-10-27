import { fieldUpdate, fieldFitsGame, fieldWindow } from '../field-data.mjs';
import { nextScheduleRevision } from '../schedule-version.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Field update could not be completed.'), { code });
const keys = ['name', 'availableDays', 'openTime', 'closeTime', 'hasLights', 'zipCode'];
const active = game => !['completed', 'cancelled'].includes(game.status);
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function validateBooking(field, game, duration, sun) {
  const date = typeof game.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(game.date) && new Date(`${game.date}T12:00:00Z`);
  if (!['scheduled', 'live'].includes(game.status) || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== game.date ||
      !fieldFitsGame(field, game, duration)) throw fail('booking-conflict');
  const window = fieldWindow(field, sun);
  if (!window) throw fail('daylight-unavailable');
  if (game.time < window.open || minutes(game.time) + Number(game.durationMinutes ?? duration) > minutes(window.close)) throw fail('booking-conflict');
}

// resolveDaylight is a trusted server dependency, never a client-supplied window.
// Resolve outside the transaction; the schedule CAS and fresh query protect the write.
export async function updateFieldAvailability({ db, verifiedUid, fieldId, expectedScheduleRevision, values, resolveDaylight }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) ||
      !validId(verifiedUid) || !validId(fieldId) || !Number.isSafeInteger(expectedScheduleRevision) || expectedScheduleRevision < 0 ||
      !values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== keys.length ||
      !keys.every(key => Object.hasOwn(values, key))) throw fail('invalid-request');
  let field;
  try {
    if (!['name', 'zipCode', 'openTime', 'closeTime'].every(key => typeof values[key] === 'string')) throw fail('invalid-request');
    field = fieldUpdate(values);
  } catch { throw fail('invalid-request'); }
  const userRef = db.doc(`users/${verifiedUid}`), fieldRef = db.doc(`fields/${fieldId}`);
  const revisionRef = db.doc('config/scheduleRevision');
  const gamesQuery = db.collection('games').where('fieldId', '==', fieldId);
  const authorize = user => {
    if (!['siteAdmin', 'commissioner', 'leagueManager'].includes(user.data()?.role)) throw fail('permission-denied');
  };
  const advance = revision => {
    try { return nextScheduleRevision(revision.data(), expectedScheduleRevision, verifiedUid); }
    catch { throw fail('stale-revision'); }
  };
  authorize(await userRef.get());
  if (!(await fieldRef.get()).exists) throw fail('field-unavailable');
  advance(await revisionRef.get());
  const daylight = new Map();
  if (!field.hasLights) {
    const games = await gamesQuery.get();
    for (const game of games.docs.map(doc => doc.data()).filter(active)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(game.date)) throw fail('booking-conflict');
      if (daylight.has(game.date)) continue;
      let sun;
      try { sun = await resolveDaylight?.({ zipCode: field.zipCode, date: game.date }); }
      catch { throw fail('daylight-unavailable'); }
      if (!fieldWindow(field, sun)) throw fail('daylight-unavailable');
      daylight.set(game.date, { sunrise: sun.sunrise, sunset: sun.sunset });
    }
  }
  return db.runTransaction(async tx => {
    authorize(await tx.get(userRef));
    if (!(await tx.get(fieldRef)).exists) throw fail('field-unavailable');
    const next = advance(await tx.get(revisionRef));
    const config = await tx.get(db.doc('config/schedule'));
    const games = await tx.get(gamesQuery);
    for (const snapshot of games.docs) {
      const game = snapshot.data();
      if (active(game)) validateBooking(field, game, config.data()?.gameDuration, daylight.get(game.date));
    }
    tx.set(fieldRef, field);
    tx.set(revisionRef, next);
    return { status: 'updated' };
  });
}
