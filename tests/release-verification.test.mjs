import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyRelease } from '../scripts/verify-release.mjs';

const version = '0123456789abcdefabcd';
const files = { 'index.html': '<html>Release</html>', [`assets/${version}/app.js`]: 'export {}', [`assets/${version}/style.css`]: 'body {}' };
const manifest = { format: 'recseason-release-v1', version, files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')])) };
const fetcher = async url => new Response(files[url.pathname.slice('/recseason/'.length)]);

test('release verification checks every file against the trusted local build', async () => {
  const visited = [];
  const result = await verifyRelease(manifest, 'https://example.test/recseason/', async (url, options) => {
    visited.push(url.pathname); assert.equal(options.redirect, 'error');
    return fetcher(url);
  });
  assert.equal(result.verifiedFiles, 3); assert.equal(visited.length, 3);
});

test('release verification rejects missing and stale files', async () => {
  await assert.rejects(verifyRelease(manifest, 'https://example.test/', async () => new Response('', { status: 404 })), /unavailable/);
  await assert.rejects(verifyRelease(manifest, 'https://example.test/', async () => new Response('old release')), /checksum mismatch/);
});

test('release paths and expected checksums are validated before network requests', async () => {
  let calls = 0; const forbidden = async () => { calls++; throw new Error('Unexpected request'); };
  for (const url of ['http://example.test/', 'https://user:pass@example.test/', 'https://example.test/path', 'https://example.test/?secret=1']) await assert.rejects(verifyRelease(manifest, url, forbidden), /HTTPS/);
  for (const path of ['../secret', 'https://other.test/x', 'assets/other/app.js']) await assert.rejects(verifyRelease({ ...manifest, files: { ...manifest.files, [path]: 'a'.repeat(64) } }, 'https://example.test/', forbidden), /path/);
  assert.equal(calls, 0);
});
