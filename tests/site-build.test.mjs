import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../scripts/build-site.mjs';

test('release paths change together when a dependency changes and remain deterministic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recseason-build-'));
  await writeFile(join(root, 'index.html'), '<link href="style.css?v=old"><script type="module" src="app.js"></script>');
  await writeFile(join(root, 'style.css'), 'body {}');
  await writeFile(join(root, 'app.js'), 'import { value } from "./dependency.mjs";');
  await writeFile(join(root, 'dependency.mjs'), 'export const value = 1;');
  const first = await buildSite(root);
  assert.deepEqual(await buildSite(root), first);
  const html = await readFile(join(root, 'dist', 'index.html'), 'utf8');
  assert.ok(html.includes(`${first.assetPath}/app.js`));
  assert.ok(html.includes(`${first.assetPath}/style.css`));
  assert.equal(await readFile(join(root, 'dist', first.assetPath, 'dependency.mjs'), 'utf8'), 'export const value = 1;');
  await writeFile(join(root, 'dependency.mjs'), 'export const value = 2;');
  const next = await buildSite(root);
  assert.notEqual(next.version, first.version);
  assert.equal(await readFile(join(root, 'dist', next.assetPath, 'app.js'), 'utf8'), 'import { value } from "./dependency.mjs";');
});
