import { readFile, stat } from 'node:fs/promises';
import { restoreBatches } from './recovery-run.mjs';
import { localRecoveryIO } from './recovery-io.mjs';
import { readBackup } from './backup-encryption.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Recovery is restricted to the local emulator at 127.0.0.1:8180.');
if (!process.argv[2]) throw new Error('Provide a backup JSON file path.');
if (process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--resume')) throw new Error('Usage: restore-recovery.mjs backup.json [--resume]');
if ((await stat(process.argv[2])).size > 48 * 1024 * 1024) throw new Error('Backup file exceeds the recovery size limit.');
const backup = await readBackup(JSON.parse(await readFile(process.argv[2], 'utf8')), process.env.RECSEASON_BACKUP_PASSPHRASE);
const count = await restoreBatches(backup, { resume: process.argv[3] === '--resume', io: localRecoveryIO() });
console.log(`PASS: restored and verified ${count} documents in the local recovery database. Production unchanged.`);
