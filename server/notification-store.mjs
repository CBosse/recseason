import { Firestore } from '@google-cloud/firestore';

const immutable = ['id', 'kind', 'eventId', 'sourceId', 'requestedBy', 'recipient', 'subject', 'body', 'createdAt', 'expiresAt'];

export function openNotificationStore(projectId) {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator ? (emulator !== '127.0.0.1:8180' || projectId !== 'demo-recseason') : projectId !== 'bosse-testing') throw new Error('Unsupported notification database target.');
  const db = new Firestore({ projectId, databaseId: 'recseason' });
  return { db, store: notificationStore(db) };
}

export function notificationStore(db) {
  if (db.databaseId !== 'recseason') throw new Error('Notifications require the named recseason database.');
  const ref = id => {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid notification job ID.');
    return db.collection('notificationJobs').doc(id);
  };
  return {
    async create(job) {
      if (job.version !== 0 || job.status !== 'pending' || job.attempts !== 0) throw new Error('Only new pending jobs may be created.');
      const target = ref(job.id);
      return db.runTransaction(async tx => {
        if ((await tx.get(target)).exists) return false;
        tx.create(target, job);
        return true;
      });
    },
    async get(id) { return (await ref(id).get()).data(); },
    async compareAndSet(id, version, next) {
      if (!Number.isSafeInteger(version) || version < 0 || next.id !== id || next.version !== version + 1) throw new Error('Invalid notification revision.');
      const target = ref(id);
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(target);
        if (!snapshot.exists || snapshot.data().version !== version) return false;
        const current = snapshot.data();
        if (immutable.some(key => current[key] !== next[key])) throw new Error('Notification event data is immutable.');
        tx.set(target, next);
        return true;
      });
    },
  };
}
