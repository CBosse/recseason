import { nextRosterRevision } from '../roster-version.mjs';
import { nextScheduleRevision } from '../schedule-version.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Team removal could not be completed.'), { code });

// Internal only. The HTTP boundary must supply verifiedUid from a verified token.
export async function deleteEmptyTeam({ db, verifiedUid, teamId, expectedRosterRevision, expectedScheduleRevision }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) ||
      !validId(verifiedUid) || !validId(teamId) ||
      ![expectedRosterRevision, expectedScheduleRevision].every(value => Number.isSafeInteger(value) && value >= 0)) throw fail('invalid-request');
  return db.runTransaction(async tx => {
    const user = await tx.get(db.doc(`users/${verifiedUid}`));
    if (!['siteAdmin', 'commissioner', 'leagueManager'].includes(user.data()?.role)) throw fail('permission-denied');
    const team = db.doc(`teams/${teamId}`);
    if (!(await tx.get(team)).exists) throw fail('team-unavailable');
    const rosterRef = db.doc('config/rosterRevision');
    const scheduleRef = db.doc('config/scheduleRevision');
    const roster = await tx.get(rosterRef), schedule = await tx.get(scheduleRef);
    let nextRoster, nextSchedule;
    try {
      nextRoster = nextRosterRevision(roster.data(), expectedRosterRevision, verifiedUid);
      nextSchedule = nextScheduleRevision(schedule.data(), expectedScheduleRevision, verifiedUid);
    } catch { throw fail('stale-revision'); }
    // Limit each query to one: any reference, including archived/history data,
    // blocks removal without loading or exposing the league's private records.
    for (const [collection, field] of [
      ['players', 'teamId'], ['teamRoster', 'teamId'], ['games', 'homeTeamId'], ['games', 'awayTeamId'],
      ['users', 'linkedTeamId'], ['invitations', 'linkedTeamId'], ['rsvps', 'teamId'], ['attendance', 'teamId'],
    ]) {
      const references = await tx.get(db.collection(collection).where(field, '==', teamId).limit(1));
      if (!references.empty) throw fail('team-in-use');
    }
    tx.set(rosterRef, nextRoster);
    tx.set(scheduleRef, nextSchedule);
    tx.delete(team);
    return { status: 'deleted' };
  });
}
