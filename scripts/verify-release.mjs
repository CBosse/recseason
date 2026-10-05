import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyRelease(manifest, baseUrl, fetcher = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw new Error('Use an HTTPS site URL ending in / without credentials, query or fragment.');
  if (manifest?.format !== 'recseason-release-v1' || !/^[a-f0-9]{20}$/.test(manifest.version) || !manifest.files || typeof manifest.files !== 'object') throw new Error('Invalid expected release manifest.');
  const entries = Object.entries(manifest.files);
  if (!entries.length || entries.length > 200 || !manifest.files['index.html'] || !manifest.files[`assets/${manifest.version}/app.js`] || !manifest.files[`assets/${manifest.version}/style.css`]) throw new Error('Expected release is missing entry assets.');
  for (const [path, digest] of entries) {
    if (!(new RegExp(`^(?:[a-zA-Z0-9_-]+\\.html|assets/${manifest.version}/[a-zA-Z0-9_-]+\\.(?:js|mjs|css))$`)).test(path) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid release path or checksum.');
  }
  for (const [path, digest] of entries) {
    const url = new URL(path, base); url.searchParams.set('release', manifest.version);
    const response = await fetcher(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Release file unavailable: ${path} (HTTP ${response.status}).`);
    const actual = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    if (actual !== digest) throw new Error(`Release checksum mismatch: ${path}.`);
  }
  return { version: manifest.version, verifiedFiles: entries.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile('dist/release.json', 'utf8'));
  const base = process.argv[2] || 'https://cbosse.github.io/recseason/';
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await verifyRelease(manifest, base);
      console.log(`PASS: release ${result.version}; ${result.verifiedFiles} live files match the local build.`);
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      console.error(`Verification attempt ${attempt}: ${error.message} Retrying in 5 seconds.`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
