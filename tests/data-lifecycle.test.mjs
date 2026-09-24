import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptions, writeResult } from '../data-lifecycle.mjs';

test('account changes dispose all listeners and ignore queued old callbacks', () => {
  const callbacks = [], values = [];
  let disposed = 0;
  const subscriptions = createSubscriptions((ref, next, error) => {
    callbacks.push({ next, error });
    return () => disposed++;
  });
  subscriptions.listen('admin', value => values.push(value), value => values.push(value));
  callbacks[0].next('admin data');
  subscriptions.clear();
  subscriptions.listen('visitor', value => values.push(value));
  callbacks[0].next('stale data');
  callbacks[0].error('stale error');
  callbacks[1].next('public data');
  assert.deepEqual(values, ['admin data', 'public data']);
  assert.equal(disposed, 1);
  subscriptions.clear();
  subscriptions.clear();
  assert.equal(disposed, 2);
});
test('failed writes report failure instead of enabling success UI', async () => {
  const errors = [];
  assert.equal(await writeResult(Promise.reject(new Error('denied')), error => errors.push(error.message)), false);
  assert.deepEqual(errors, ['denied']);
  assert.equal(await writeResult(Promise.resolve(), error => errors.push(error)), true);
});
