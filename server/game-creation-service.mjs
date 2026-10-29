import { gamesConflict, validateScheduleConfig } from '../scheduling.mjs';
import { fieldUpdate, fieldFitsGame, fieldWindow } from '../field-data.mjs';
import { nextScheduleRevision } from '../schedule-version.mjs';
import { gameRulesSnapshot } from '../league-rules.mjs';
import { validateGameCreation } from '../game-creation.mjs';
export { validateGameCreation } from '../game-creation.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Game creation could not be completed.'), { code });
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export async function createScheduledGame({ db, verifiedUid, gameId, expectedScheduleRevision, values, resolveDaylight }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) || !id(verifiedUid) || !id(gameId) ||
      !Number.isSafeInteger(expectedScheduleRevision) || expectedScheduleRevision < 0) throw fail('invalid-request');
  const input = validateGameCreation(values);
  const actor = db.doc(`users/${verifiedUid}`), fieldRef = db.doc(`fields/${input.fieldId}`), revisionRef = db.doc('config/scheduleRevision');
  const authorize = snapshot => { if (!['siteAdmin', 'commissioner', 'leagueManager'].includes(snapshot.data()?.role)) throw fail('permission-denied'); };
  const advance = snapshot => { try { return nextScheduleRevision(snapshot.data(), expectedScheduleRevision, verifiedUid); } catch { throw fail('stale-revision'); } };
  authorize(await actor.get()); advance(await revisionRef.get());
  const fieldBefore = await fieldRef.get();
  if (!fieldBefore.exists) throw fail('reference-unavailable');
  let field;
  try { field = fieldUpdate(fieldBefore.data()); } catch { throw fail('invalid-field'); }
  let sun;
  if (!field.hasLights) {
    try { sun = await resolveDaylight?.({ zipCode: field.zipCode, date: input.date }); } catch { throw fail('daylight-unavailable'); }
    if (!fieldWindow(field, sun)) throw fail('daylight-unavailable');
  }
  return db.runTransaction(async tx => {
    authorize(await tx.get(actor));
    const next = advance(await tx.get(revisionRef));
    const target = db.doc(`games/${gameId}`);
    if ((await tx.get(target)).exists) throw fail('game-exists');
    const currentField = await tx.get(fieldRef);
    if (!currentField.exists || JSON.stringify(currentField.data()) !== JSON.stringify(fieldBefore.data())) throw fail('stale-field');
    const home = await tx.get(db.doc(`teams/${input.homeTeamId}`)), away = await tx.get(db.doc(`teams/${input.awayTeamId}`));
    if (![home, away].every(snapshot => snapshot.exists && typeof snapshot.data().name === 'string' && snapshot.data().name.trim() && snapshot.data().name.length <= 100)) throw fail('reference-unavailable');
    if (input.umpireId) {
      const official = await tx.get(db.doc(`umpires/${input.umpireId}`));
      const account = await tx.get(db.doc(`users/${input.umpireId}`));
      if (!official.exists || account.data()?.role !== 'umpire') throw fail('reference-unavailable');
    }
    if (input.scorekeeperId && (await tx.get(db.doc(`users/${input.scorekeeperId}`))).data()?.role !== 'scorekeeper') throw fail('reference-unavailable');
    const config = (await tx.get(db.doc('config/schedule'))).data();
    try {
      validateScheduleConfig(config);
      if (!['gameDuration', 'bufferMinutes', 'rounds'].every(key => Number.isInteger(config[key]))) throw fail('invalid-config');
    } catch { throw fail('invalid-config'); }
    if (input.date < config.startDate || input.date > config.endDate || !fieldFitsGame(field, input, config.gameDuration)) throw fail('booking-conflict');
    const window = fieldWindow(field, sun);
    if (!window || input.time < window.open || minutes(input.time) + input.durationMinutes > minutes(window.close)) throw fail('booking-conflict');
    const { ruleProfileId, ruleProfileRevision, ...game } = input;
    Object.assign(game, { homeName: home.data().name, awayName: away.data().name, fieldName: field.name, status: 'scheduled', homeScore: null, awayScore: null });
    if (ruleProfileId) {
      const profile = (await tx.get(db.doc(`ruleProfiles/${ruleProfileId}`))).data();
      if (!profile || profile.revision !== ruleProfileRevision) throw fail('stale-rules');
      try { game.rulesSnapshot = gameRulesSnapshot(game, ruleProfileId, profile); } catch { throw fail('invalid-rules'); }
    }
    const bookings = await tx.get(db.collection('games').where('date', '==', input.date));
    for (const snapshot of bookings.docs) {
      const other = snapshot.data();
      if (other.status === 'cancelled') continue;
      const duration = other.durationMinutes ?? config.gameDuration;
      if (!['scheduled', 'live', 'completed'].includes(other.status) || !time(other.time) || !Number.isInteger(duration) || duration < 1 || duration > 1440 || minutes(other.time) + duration > 1440 ||
          !['homeTeamId', 'awayTeamId', 'fieldId'].every(key => id(other[key])) || !['umpireId', 'scorekeeperId'].every(key => other[key] == null || id(other[key]))) throw fail('invalid-booking');
      if (gamesConflict(game, other, config.gameDuration, config.bufferMinutes)) throw fail('booking-conflict');
    }
    tx.create(target, game); tx.set(revisionRef, next);
    return { status: 'created', gameId };
  });
}
