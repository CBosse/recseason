import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { validateBackup } from './backup-format.mjs';

const derive = promisify(scrypt);
const format = 'recseason-encrypted-v1';
const algorithm = 'aes-256-gcm';
const aad = Buffer.from(`${format}:${algorithm}:scrypt-32768-8-1`);
const maxBytes = 32 * 1024 * 1024;

export function requireBackupPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16 || Buffer.byteLength(passphrase) > 1024) throw new Error('Set RECSEASON_BACKUP_PASSPHRASE to a strong passphrase of 16 to 1024 bytes before exporting or decrypting.');
  return passphrase;
}

async function keyFor(passphrase, salt) {
  return derive(requireBackupPassphrase(passphrase), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function bytes(value, size) {
  if (typeof value !== 'string' || value.length > maxBytes * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid encrypted backup encoding.');
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== value || (size && buffer.length !== size) || buffer.length > maxBytes) throw new Error('Invalid encrypted backup length.');
  return buffer;
}

export async function encryptBackup(backup, passphrase) {
  validateBackup(backup);
  const plaintext = Buffer.from(JSON.stringify(backup));
  if (plaintext.length > maxBytes) throw new Error('Backup exceeds the encrypted file size limit.');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await keyFor(passphrase, salt);
  try {
    const cipher = createCipheriv(algorithm, key, iv); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { format, algorithm, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } finally { key.fill(0); plaintext.fill(0); }
}

export async function readBackup(payload, passphrase) {
  if (payload?.format === 'recseason-firestore-v1') return validateBackup(payload);
  if (payload?.format !== format || payload.algorithm !== algorithm) throw new Error('Unsupported encrypted backup format.');
  const salt = bytes(payload.salt, 16), iv = bytes(payload.iv, 12), tag = bytes(payload.tag, 16), ciphertext = bytes(payload.ciphertext);
  const key = await keyFor(passphrase, salt);
  let plaintext;
  try {
    const decipher = createDecipheriv(algorithm, key, iv); decipher.setAAD(aad); decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return validateBackup(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new Error('Backup authentication failed or decrypted content is invalid. Check the passphrase and backup file.');
  } finally { key.fill(0); plaintext?.fill(0); }
}
