import { fieldUpdate } from '../field-data.mjs';

export function validFieldUpdateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 ||
      !['fieldId', 'expectedScheduleRevision', 'values'].every(key => Object.hasOwn(body, key)) ||
      typeof body.fieldId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.fieldId) ||
      !Number.isSafeInteger(body.expectedScheduleRevision) || body.expectedScheduleRevision < 0) return false;
  const values = body.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== 6 ||
      !['name', 'zipCode', 'openTime', 'closeTime', 'availableDays', 'hasLights'].every(key => Object.hasOwn(values, key)) ||
      !['name', 'zipCode', 'openTime', 'closeTime'].every(key => typeof values[key] === 'string')) return false;
  try { fieldUpdate(values); return true; } catch { return false; }
}
