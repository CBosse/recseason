import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const image = 'recseason-api:test';
const name = `recseason-smoke-${randomUUID()}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
let started = false;
try {
  docker(['run', '--rm', '--detach', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--publish', '127.0.0.1::8080', image]);
  started = true;
  const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]));
  const endpoint = `http://127.0.0.1:${ports['8080/tcp'][0].HostPort}`;
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${endpoint}/healthz`, { signal: AbortSignal.timeout(1000) });
      healthy = response.status === 200 && (await response.json()).status === 'ok';
    } catch { /* The process may still be loading dependencies. */ }
    if (healthy) break;
    await setTimeout(500);
  }
  assert.ok(healthy, 'Container must become live without credentials or emulator access.');
  assert.equal(docker(['exec', name, 'id', '-u']), '1000', 'Runtime must be non-root.');
  assert.equal((await fetch(`${endpoint}/healthz`, { headers: { Origin: 'https://foreign.test' } })).status, 403);
  for (const route of ['parent-invitations/accept', 'game-reminders', 'game-cancellations', 'teams/delete']) {
    const response = await fetch(`${endpoint}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'authentication-required' });
  }
  assert.equal((await fetch(`${endpoint}/.env`)).status, 404);
  console.log('PASS: container runs non-root with read-only filesystem, responds to liveness probes, and rejects unauthenticated API requests. No cloud credentials or data used.');
} finally {
  if (started) docker(['stop', '--time', '10', name]);
}
