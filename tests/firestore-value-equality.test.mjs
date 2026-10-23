import test from 'node:test';
import assert from 'node:assert/strict';
import { sameStoredFields } from '../scripts/firestore-value-equality.mjs';

test('REST omitted empty containers equal explicit empty containers at any depth', () => {
  const left = { event: { mapValue: { fields: { innings: { mapValue: { fields: {} } }, actions: { arrayValue: { values: [{ mapValue: { fields: {} } }, { arrayValue: { values: [] } }] } } } } } };
  const right = { event: { mapValue: { fields: { actions: { arrayValue: { values: [{ mapValue: {} }, { arrayValue: {} }] } }, innings: { mapValue: {} } } } } };
  const copy = structuredClone(left);
  assert.equal(sameStoredFields(left, right), true);
  assert.deepEqual(left, copy);
});

test('recovery verification retains types, values, array order, field names and unknown data', () => {
  const value = { score: { integerValue: '2' }, plays: { arrayValue: { values: [{ stringValue: 'ball' }, { stringValue: 'strike' }] } }, empty: { mapValue: {} } };
  for (const patch of [{ score: { integerValue: '3' } }, { score: { stringValue: '2' } },
    { empty: { arrayValue: {} } }, { empty: { mapValue: { fields: null } } },
    { empty: { mapValue: { extra: true } } }, { empty: { mapValue: { fields: { added: { booleanValue: false } } } } },
    { plays: { arrayValue: { values: [...value.plays.arrayValue.values].reverse() } } }]) {
    assert.equal(sameStoredFields(value, { ...value, ...patch }), false);
  }
  assert.equal(sameStoredFields(value, { ...value, added: { nullValue: null } }), false);
});
