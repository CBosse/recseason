import { openNotificationStore } from '../server/notification-store.mjs';
import { gameReminderEligibility } from '../server/game-reminder-service.mjs';
import { resendTransport } from '../server/resend-transport.mjs';
import { drainNotifications } from '../server/notification-drain.mjs';

let db;
try {
  if (process.argv.slice(2).join(' ') !== '--send' || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Explicit production send invocation required.');
  const transport = resendTransport({ apiKey: process.env.RESEND_API_KEY, sender: process.env.RECSEASON_MAIL_FROM });
  const opened = openNotificationStore('bosse-testing');
  db = opened.db;
  const summary = await drainNotifications({ store: opened.store, transport, isEligible: gameReminderEligibility(db) });
  console.log(JSON.stringify(summary));
} catch {
  console.error('Notification batch failed. Check server configuration and queue state before retrying; no raw provider or recipient data is logged.');
  process.exitCode = 1;
} finally {
  if (db) await db.terminate();
}
