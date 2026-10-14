import test from 'node:test';
import assert from 'node:assert/strict';
import { wireDialogSubmission } from '../dialog-submit.mjs';

function fixture(save, read = () => ({ name: 'Edited' })) {
  const handlers = {};
  const dialog = { isConnected: true, closes: 0, addEventListener: (name, handler) => { handlers[name] = handler; },
    close() { this.closes++; this.isConnected = false; } };
  const controls = [{ disabled: false }, { disabled: false }, { disabled: true }];
  const form = {}, error = { textContent: 'previous error' };
  wireDialogSubmission({ dialog, form, controls, error, read, save });
  const submit = () => form.onsubmit({ preventDefault() {} });
  const cancelBlocked = () => { let blocked = false; handlers.cancel({ preventDefault() { blocked = true; } }); return blocked; };
  return { dialog, controls, error, submit, cancelBlocked };
}

test('pending editor submissions lock every control, block Escape and admit one save', async () => {
  let finish, calls = 0;
  const f = fixture(values => { calls++; assert.deepEqual(values, { name: 'Edited' }); return new Promise(resolve => { finish = resolve; }); });
  const first = f.submit();
  assert.ok(f.controls.every(control => control.disabled));
  assert.equal(f.cancelBlocked(), true);
  await f.submit(); assert.equal(calls, 1);
  finish(); await first;
  assert.equal(f.dialog.closes, 1);
  assert.equal(f.cancelBlocked(), false);
  assert.deepEqual(f.controls.map(control => control.disabled), [false, false, true]);
});

test('failed saves keep editor open and restore controls for a deliberate retry', async () => {
  let calls = 0;
  const f = fixture(async () => { if (++calls === 1) throw new Error('Save failed'); });
  await f.submit();
  assert.equal(f.error.textContent, 'Save failed'); assert.equal(f.dialog.closes, 0);
  assert.equal(f.cancelBlocked(), false);
  assert.deepEqual(f.controls.map(control => control.disabled), [false, false, true]);
  await f.submit(); assert.equal(calls, 2); assert.equal(f.dialog.closes, 1);
});

test('validation failures do not save or leave the editor locked', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; }, () => { throw new Error('Invalid field'); });
  await f.submit(); assert.equal(calls, 0); assert.equal(f.error.textContent, 'Invalid field');
  assert.equal(f.cancelBlocked(), false); assert.equal(f.dialog.closes, 0);
  assert.deepEqual(f.controls.map(control => control.disabled), [false, false, true]);
});

test('removed editors ignore late success and failure and reject further submissions', async () => {
  for (const fail of [false, true]) {
    let complete, reject, calls = 0;
    const f = fixture(() => { calls++; return new Promise((resolve, failure) => { complete = resolve; reject = failure; }); });
    const request = f.submit(); f.dialog.isConnected = false;
    if (fail) reject(new Error('Late failure')); else complete();
    await request; await f.submit();
    assert.equal(calls, 1); assert.equal(f.dialog.closes, 0); assert.equal(f.error.textContent, '');
  }
});
