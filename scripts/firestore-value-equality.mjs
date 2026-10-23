import { isDeepStrictEqual } from 'node:util';

function normalizedFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, normalizedValue(value)]));
}

function normalizedValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) return value;
  if (value.mapValue && typeof value.mapValue === 'object' && !Array.isArray(value.mapValue)) {
    const map = value.mapValue;
    const fields = Object.hasOwn(map, 'fields') ? map.fields : {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return value;
    return { mapValue: { ...map, fields: normalizedFields(fields) } };
  }
  if (value.arrayValue && typeof value.arrayValue === 'object' && !Array.isArray(value.arrayValue)) {
    const array = value.arrayValue;
    const values = Object.hasOwn(array, 'values') ? array.values : [];
    if (!Array.isArray(values)) return value;
    return { arrayValue: { ...array, values: values.map(normalizedValue) } };
  }
  return value;
}

// Firestore omits empty map fields and array values on REST reads.
export function sameStoredFields(left, right) {
  return isDeepStrictEqual(normalizedFields(left), normalizedFields(right));
}
