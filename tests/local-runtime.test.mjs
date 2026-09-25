import test from 'node:test';
import assert from 'node:assert/strict';
import { useLocalEmulators } from '../local-runtime.mjs';
test('emulators require an explicit local URL', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(useLocalEmulators({ hostname, search: '?emulator=1' }), true);
    assert.equal(useLocalEmulators({ hostname, search: '' }), false);
  }
  assert.equal(useLocalEmulators({ hostname: 'cbosse.github.io', search: '' }), false);
  assert.throws(() => useLocalEmulators({ hostname: 'cbosse.github.io', search: '?emulator=1' }));
});
