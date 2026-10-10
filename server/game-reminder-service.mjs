import { createHash } from 'node:crypto';
import { gameNotice } from '../reminders.mjs';
import { notificationJobs, enqueueNotifications } from './notification-jobs.mjs';

const appUrl = 'https://cbosse.github.io/recseason/';
const organizers = new Set(['siteAdmin', 'commissioner', 'leagueManager']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function eventId(game, draft, version) {
  const identity = [game.id, game.status, game.homeTeamId, game.awayTeamId, game.fieldId, draft.subject, draft.body];
  if (version) identity.push(version);
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function currentReminder(db, gameId, actorUid, kind = 'rsvp-reminder') {
  if (!['rsvp-reminder', 'cancellation'].includes(kind)) throw new Error('Unsupported game notice.');
  if (db.databaseId !== 'recseason' || !validId(gameId) || !validId(actorUid)) throw new Error('Invalid reminder source.');
  return db.runTransaction(async tx => {
    const actor = await tx.get(db.collection('users').doc(actorUid));
    if (!actor.exists || !organizers.has(actor.data().role)) throw Object.assign(new Error('Current organizer access is required.'), { code: 'permission-denied' });
    const snapshot = await tx.get(db.collection('games').doc(gameId));
    if (!snapshot.exists || snapshot.data().status !== (kind === 'cancellation' ? 'cancelled' : 'scheduled')) return null;
    const game = { ...snapshot.data(), id: snapshot.id };
    if (!validId(game.homeTeamId) || !validId(game.awayTeamId) || game.homeTeamId === game.awayTeamId || !validId(game.fieldId)) return null;
    for (const [collection, id] of [['teams', game.homeTeamId], ['teams', game.awayTeamId], ['fields', game.fieldId]]) {
      if (!(await tx.get(db.collection(collection).doc(id))).exists) return null;
    }
    const players = await tx.get(db.collection('players').where('teamId', 'in', [game.homeTeamId, game.awayTeamId]).limit(1001));
    const users = await tx.get(db.collection('users').limit(1001));
    if (players.size > 1000 || users.size > 1000) throw new Error('Reminder recipient scan exceeds the supported limit.');
    const data = rows => rows.docs.map(row => ({ ...row.data(), id: row.id }));
    const draft = gameNotice(game, data(players), data(users), appUrl, kind);
    const version = kind === 'cancellation' ? [snapshot.updateTime.seconds, snapshot.updateTime.nanoseconds] : null;
    return { draft, eventId: eventId(game, draft, version) };
  });
}

// verifiedUid must come from server-side authentication, never a request-body UID.
// This internal service is not a public HTTP handler and cannot verify a token itself.
export async function enqueueGameReminder({ db, store, verifiedUid, gameId, now = Date.now() }) {
  return enqueueGameNotice({ db, store, verifiedUid, gameId, now }, 'rsvp-reminder');
}

export async function enqueueGameCancellation({ db, store, verifiedUid, gameId, now = Date.now() }) {
  return enqueueGameNotice({ db, store, verifiedUid, gameId, now }, 'cancellation');
}

async function enqueueGameNotice({ db, store, verifiedUid, gameId, now }, kind) {
  const current = await currentReminder(db, gameId, verifiedUid, kind);
  if (!current) throw Object.assign(new Error('This game is not available for reminders.'), { code: 'game-unavailable' });
  if (!current.draft.recipients.length) return { created: 0, existing: 0, recipients: 0, playersWithoutRecipient: current.draft.playersWithoutRecipient };
  const jobs = notificationJobs({ kind, eventId: current.eventId, sourceId: gameId, requestedBy: verifiedUid,
    ...current.draft, expiresAt: now + 86400000 }, now);
  return { ...await enqueueNotifications(store, jobs), recipients: jobs.length, playersWithoutRecipient: current.draft.playersWithoutRecipient };
}

export function gameReminderEligibility(db) {
  return async job => {
    if (!['rsvp-reminder', 'cancellation'].includes(job.kind) || !validId(job.sourceId) || !validId(job.requestedBy)) return false;
    let current;
    try { current = await currentReminder(db, job.sourceId, job.requestedBy, job.kind); }
    catch (error) { if (error.code === 'permission-denied') return false; throw error; }
    return Boolean(current && current.eventId === job.eventId && current.draft.subject === job.subject && current.draft.body === job.body && current.draft.recipients.includes(job.recipient));
  };
}
