export function scheduleRevision(snapshot) {
  const revision = snapshot?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid schedule revision.');
  return revision;
}

export function nextScheduleRevision(current, expected, uid) {
  if (scheduleRevision(current) !== expected) throw new Error('The schedule changed in another session. Refresh and try again.');
  if (!uid || expected >= Number.MAX_SAFE_INTEGER) throw new Error('Cannot update the schedule revision.');
  return { revision: expected + 1, updatedBy: uid };
}
