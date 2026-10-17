import { nextScheduleRevision } from '../schedule-version.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Field removal could not be completed.'), { code });

// The HTTP boundary supplies verifiedUid; callers cannot choose the acting user.
export async function deleteUnusedField({ db, verifiedUid, fieldId, expectedScheduleRevision }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) ||
      !validId(verifiedUid) || !validId(fieldId) || !Number.isSafeInteger(expectedScheduleRevision) || expectedScheduleRevision < 0) throw fail('invalid-request');
  return db.runTransaction(async tx => {
    const user = await tx.get(db.doc(`users/${verifiedUid}`));
    if (!['siteAdmin', 'commissioner', 'leagueManager'].includes(user.data()?.role)) throw fail('permission-denied');
    const target = db.doc(`fields/${fieldId}`);
    if (!(await tx.get(target)).exists) throw fail('field-unavailable');
    const revisionRef = db.doc('config/scheduleRevision');
    const revision = await tx.get(revisionRef);
    let next;
    try { next = nextScheduleRevision(revision.data(), expectedScheduleRevision, verifiedUid); }
    catch { throw fail('stale-revision'); }
    for (const [collection, key] of [['games', 'fieldId'], ['rsvps', 'gameFieldId'], ['attendance', 'gameFieldId'],
      ['scheduleEvents', 'change.before.fieldId'], ['scheduleEvents', 'change.after.fieldId']]) {
      if (!(await tx.get(db.collection(collection).where(key, '==', fieldId).limit(1))).empty) throw fail('field-in-use');
    }
    tx.set(revisionRef, next);
    tx.delete(target);
    return { status: 'deleted' };
  });
}
