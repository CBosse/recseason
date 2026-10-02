import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup } from '../scripts/backup-format.mjs';
import { encryptBackup, readBackup } from '../scripts/backup-encryption.mjs';

const secret = 'test-only-passphrase-not-for-production';
const backup = createBackup([{ path: 'players/test', fields: { email: { stringValue: 'private@example.test' } } }], '2026-10-02T00:00:00Z');

test('encrypted backups round-trip typed values without plaintext and use fresh randomness', async () => {
  const a = await encryptBackup(backup, secret), b = await encryptBackup(backup, secret);
  assert.ok(!JSON.stringify(a).includes('private@example.test'));
  assert.notEqual(a.ciphertext, b.ciphertext); assert.notEqual(a.salt, b.salt); assert.notEqual(a.iv, b.iv);
  assert.deepEqual(await readBackup(a, secret), backup);
});

test('wrong passphrase and tampered ciphertext, tag, IV or salt fail authentication', async () => {
  const encrypted = await encryptBackup(backup, secret);
  await assert.rejects(readBackup(encrypted, 'different-long-test-secret'), /authentication/);
  for (const field of ['ciphertext', 'tag', 'iv', 'salt']) {
    const buffer = Buffer.from(encrypted[field], 'base64'); buffer[0] ^= 1;
    await assert.rejects(readBackup({ ...encrypted, [field]: buffer.toString('base64') }, secret), /authentication/);
  }
});

test('missing secrets, unsupported envelopes and invalid encodings are rejected; legacy backups remain readable', async () => {
  await assert.rejects(encryptBackup(backup, ''), /PASSPHRASE/);
  const encrypted = await encryptBackup(backup, secret);
  await assert.rejects(readBackup(encrypted), /PASSPHRASE/);
  await assert.rejects(readBackup({ ...encrypted, algorithm: 'unknown' }, secret), /Unsupported/);
  await assert.rejects(readBackup({ ...encrypted, tag: '!' }, secret), /encoding/);
  assert.deepEqual(await readBackup(backup), backup);
});
