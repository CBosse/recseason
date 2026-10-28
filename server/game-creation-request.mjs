import { validateGameCreation } from './game-creation-service.mjs';

export function validGameCreationRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 ||
      !['gameId', 'expectedScheduleRevision', 'values'].every(key => Object.hasOwn(body, key)) ||
      typeof body.gameId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.gameId) ||
      !Number.isSafeInteger(body.expectedScheduleRevision) || body.expectedScheduleRevision < 0) return false;
  try { validateGameCreation(body.values); return true; } catch { return false; }
}
