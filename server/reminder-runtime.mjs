import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { openNotificationStore } from './notification-store.mjs';
import { enqueueGameReminder, enqueueGameCancellation, enqueueGameReschedule } from './game-reminder-service.mjs';
import { reminderHandler } from './reminder-http.mjs';
import { gameReminderStatus } from './reminder-status.mjs';
import { acceptParentInvitation } from './parent-invitation-service.mjs';
import { deleteEmptyTeam } from './team-deletion-service.mjs';
import { deleteUnusedField } from './field-deletion-service.mjs';
import { recordAutomaticPlay } from './game-scoring-service.mjs';
import { automaticScoringEnabled } from './scoring-request.mjs';
import { updateFieldAvailability } from './field-update-service.mjs';
import { createFieldDaylightResolver } from './field-daylight.mjs';
import { updateProfileAccess } from './profile-access-service.mjs';

export function openReminderRuntime(projectId) {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const local = projectId === 'demo-recseason';
  if (local ? emulator !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    : projectId !== 'bosse-testing' || emulator || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Unsupported reminder runtime target.');
  const { db, store } = openNotificationStore(projectId);
  const app = initializeApp({ projectId }, `reminders-${randomUUID()}`);
  const auth = getAuth(app);
  const daylight = createFieldDaylightResolver();
  const handler = reminderHandler({
    origins: local ? ['http://127.0.0.1:8080', 'http://127.0.0.1:8081'] : ['https://cbosse.github.io'],
    verifyToken: token => auth.verifyIdToken(token, true),
    acceptParent: request => acceptParentInvitation({ db, auth, ...request }),
    removeTeam: request => deleteEmptyTeam({ db, ...request }),
    removeField: request => deleteUnusedField({ db, ...request }),
    updateAccess: request => updateProfileAccess({ db, ...request }),
    updateField: request => {
      const signal = AbortSignal.timeout(12000);
      return updateFieldAvailability({ db, ...request, resolveDaylight: input => daylight({ ...input, signal }) });
    },
    recordPlay: request => {
      if (!automaticScoringEnabled(projectId, process.env.RECSEASON_AUTOMATIC_SCORING)) {
        throw Object.assign(new Error('Automatic scoring is disabled.'), { code: 'scoring-disabled' });
      }
      return recordAutomaticPlay({ db, ...request });
    },
    enqueue: request => enqueueGameReminder({ db, store, ...request }),
    status: request => gameReminderStatus({ db, ...request }),
    enqueueCancellation: request => enqueueGameCancellation({ db, store, ...request }),
    cancellationStatus: request => gameReminderStatus({ db, ...request, kind: 'cancellation' }),
    enqueueReschedule: request => enqueueGameReschedule({ db, store, ...request }),
    rescheduleStatus: request => gameReminderStatus({ db, ...request, kind: 'reschedule' }),
    admit: (uid, operation) => db.runTransaction(async tx => {
      const ref = db.collection('notificationLimits').doc(uid);
      const snapshot = await tx.get(ref);
      const now = Date.now();
      const field = operation === 'update-access' ? 'nextAccessUpdateAt' : operation === 'update-field' ? 'nextFieldUpdateAt' : operation === 'record-play' ? 'nextScoringAt' : operation === 'delete-field' ? 'nextFieldDeletionAt' : operation === 'delete-team' ? 'nextTeamDeletionAt' : operation === 'accept-parent' ? 'nextParentInvitationAt' : operation === 'status' ? 'nextStatusAt' : 'nextRequestAt';
      if (snapshot.exists && snapshot.data()[field] > now) return false;
      tx.set(ref, { [field]: now + (operation === 'record-play' ? 1000 : 60000) }, { merge: true });
      return true;
    }),
  });
  return { handler, db, auth, async close() { await db.terminate(); await deleteApp(app); } };
}
