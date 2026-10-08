import { summarizeNotifications } from '../notification-status.mjs';

export async function gameReminderStatus({ db, verifiedUid, gameId }) {
  if (db.databaseId !== 'recseason' || ![verifiedUid, gameId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new Error('Invalid reminder status request.');
  return db.runTransaction(async tx => {
    const actor = await tx.get(db.collection('users').doc(verifiedUid));
    if (!actor.exists || !['siteAdmin', 'commissioner', 'leagueManager'].includes(actor.data().role)) throw Object.assign(new Error('Organizer access required.'), { code: 'permission-denied' });
    const jobs = await tx.get(db.collection('notificationJobs').where('sourceId', '==', gameId).limit(1001));
    if (jobs.size > 1000) throw new Error('Notification history exceeds the supported limit.');
    return summarizeNotifications(jobs.docs.map(row => row.data()).filter(job => job.kind === 'rsvp-reminder'));
  });
}
