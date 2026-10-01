export function rosterRevision(snapshot) {
  const revision = snapshot?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid roster revision.');
  return revision;
}

export function nextRosterRevision(current, expected, uid) {
  if (rosterRevision(current) !== expected) throw new Error('The roster changed in another session. Refresh and try again.');
  if (!uid || expected >= Number.MAX_SAFE_INTEGER) throw new Error('Cannot update the roster revision.');
  return { revision: expected + 1, updatedBy: uid };
}
