import { validAccessShape, validateProfileAccess } from '../profile-access.mjs';

export function validProfileAccessRequest(body) {
  const keys = ['targetUid', 'expectedAccess', 'expectedRosterRevision', 'access'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length ||
      !keys.every(key => Object.hasOwn(body, key)) || typeof body.targetUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.targetUid) ||
      !Number.isSafeInteger(body.expectedRosterRevision) || body.expectedRosterRevision < 0 || !validAccessShape(body.expectedAccess)) return false;
  try { validateProfileAccess(body.access); return true; } catch { return false; }
}
