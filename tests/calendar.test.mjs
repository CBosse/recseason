import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { localDateKey } from '../calendar.mjs';

test('calendar keys use padded local date fields and reject invalid dates', () => {
  assert.equal(localDateKey(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
  assert.throws(() => localDateKey(new Date('invalid')), /Invalid calendar date/);
});

for (const [zone, instant, expected] of [
  ['America/New_York', '2026-09-26T02:00:00Z', '2026-09-25'],
  ['America/Los_Angeles', '2026-01-01T03:00:00Z', '2025-12-31'],
  ['Pacific/Auckland', '2026-09-25T13:00:00Z', '2026-09-26'],
  ['America/New_York', '2026-03-08T06:59:00Z', '2026-03-08'],
  ['America/New_York', '2026-03-08T07:01:00Z', '2026-03-08'],
]) {
  test(`upcoming game boundary uses ${zone} at ${instant}`, () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { localDateKey } from './calendar.mjs';
       import { upcomingGames } from './dashboard.mjs';
       const today = localDateKey(new Date('${instant}'));
       const games = upcomingGames([{ id: 'today', status: 'scheduled', date: '${expected}', time: '23:00' }], today);
       console.log(JSON.stringify({ today, ids: games.map(g => g.id) }));`],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), { today: expected, ids: ['today'] });
  });
}
