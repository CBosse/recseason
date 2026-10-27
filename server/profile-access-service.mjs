import { profileAccess, validAccessShape, validateProfileAccess, sameProfileAccess } from '../profile-access.mjs';
import { nextRosterRevision } from '../roster-version.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Account access update could not be completed.'), { code });

// Caller identity must come from a verified token at the HTTP boundary.
export async function updateProfileAccess({ db, verifiedUid, targetUid, expectedAccess, expectedRosterRevision, access }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) ||
      !validId(verifiedUid) || !validId(targetUid) || !validAccessShape(expectedAccess) ||
      !Number.isSafeInteger(expectedRosterRevision) || expectedRosterRevision < 0) throw fail('invalid-request');
  let nextAccess;
  try { nextAccess = validateProfileAccess(access); } catch { throw fail('invalid-request'); }
  const expected = profileAccess(expectedAccess);
  return db.runTransaction(async tx => {
    const actor = await tx.get(db.doc(`users/${verifiedUid}`));
    if (actor.data()?.role !== 'siteAdmin') throw fail('permission-denied');
    if (targetUid === verifiedUid && nextAccess.role !== 'siteAdmin') throw fail('self-demotion');
    const ref = db.doc(`users/${targetUid}`), target = await tx.get(ref);
    if (!target.exists) throw fail('account-unavailable');
    let current;
    try { current = profileAccess(target.data()); } catch { throw fail('stale-profile'); }
    if (!sameProfileAccess(current, expected)) throw fail('stale-profile');
    const revisionRef = db.doc('config/rosterRevision');
    let nextRevision;
    try { nextRevision = nextRosterRevision((await tx.get(revisionRef)).data(), expectedRosterRevision, verifiedUid); }
    catch { throw fail('stale-roster'); }
    const teams = new Set(nextAccess.linkedTeamId ? [nextAccess.linkedTeamId] : []);
    const players = nextAccess.role === 'parent' ? nextAccess.linkedPlayerIds : nextAccess.linkedPlayerId ? [nextAccess.linkedPlayerId] : [];
    for (const id of players) {
      const player = await tx.get(db.doc(`players/${id}`));
      const data = player.data();
      if (!data || (data.archived !== undefined && data.archived !== false) || !validId(data.teamId) ||
          (nextAccess.role !== 'parent' && data.teamId !== nextAccess.linkedTeamId)) throw fail('invalid-links');
      teams.add(data.teamId);
    }
    for (const id of teams) if (!(await tx.get(db.doc(`teams/${id}`))).exists) throw fail('invalid-links');
    tx.update(ref, nextAccess);
    tx.set(revisionRef, nextRevision);
    return { status: 'updated' };
  });
}
