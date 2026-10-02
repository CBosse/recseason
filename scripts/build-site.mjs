import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildSite(root) {
  const files = (await readdir(root)).filter(file => /\.(html|css|js|mjs)$/.test(file)).sort();
  const contents = new Map();
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    contents.set(file, bytes);
    hash.update(file).update('\0').update(bytes).update('\0');
  }
  const version = hash.digest('hex').slice(0, 20);
  const assetPath = `assets/${version}`;
  await mkdir(join(root, 'dist', assetPath), { recursive: true });
  for (const [file, bytes] of contents) {
    if (file.endsWith('.html')) {
      let html = bytes.toString('utf8');
      if (file === 'index.html') {
        if (!html.includes('src="app.js"') || !/href="style\.css(?:\?[^"]*)?"/.test(html)) throw new Error('Application entry assets were not found.');
        html = html.replace('src="app.js"', `src="${assetPath}/app.js"`)
          .replace(/href="style\.css(?:\?[^"]*)?"/, `href="${assetPath}/style.css"`);
      }
      await writeFile(join(root, 'dist', file), html);
    } else {
      // Relative module imports stay together under one immutable release path.
      await writeFile(join(root, 'dist', assetPath, file), bytes);
    }
  }
  return { version, assetPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildSite(process.cwd());
