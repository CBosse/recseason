import { mkdir, readdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of await readdir('.')) {
  if (/\.(html|css|js|mjs)$/.test(file)) await copyFile(file, `dist/${file}`);
}
