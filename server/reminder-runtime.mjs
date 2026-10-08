import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { openNotificationStore } from './notification-store.mjs';
import { enqueueGameReminder } from './game-reminder-service.mjs';
import { reminderHandler } from './reminder-http.mjs';
import { gameReminderStatus } from './reminder-status.mjs';

export function openReminderRuntime(projectId) {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const local = projectId === 'demo-recseason';
  if (local ? emulator !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    : projectId !== 'bosse-testing' || emulator || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Unsupported reminder runtime target.');
  const { db, store } = openNotificationStore(projectId);
  const app = initializeApp({ projectId }, `reminders-${randomUUID()}`);
  const auth = getAuth(app);
  const handler = reminderHandler({
    origins: local ? ['http://127.0.0.1:8080', 'http://127.0.0.1:8081'] : ['https://cbosse.github.io'],
    verifyToken: token => auth.verifyIdToken(token, true),
    enqueue: request => enqueueGameReminder({ db, store, ...request }),
    status: request => gameReminderStatus({ db, ...request }),
    admit: (uid, operation) => db.runTransaction(async tx => {
      const ref = db.collection('notificationLimits').doc(uid);
      const snapshot = await tx.get(ref);
      const now = Date.now();
      const field = operation === 'status' ? 'nextStatusAt' : 'nextRequestAt';
      if (snapshot.exists && snapshot.data()[field] > now) return false;
      tx.set(ref, { [field]: now + 60000 }, { merge: true });
      return true;
    }),
  });
  return { handler, db, auth, async close() { await db.terminate(); await deleteApp(app); } };
}
