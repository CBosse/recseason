import test from 'node:test';
import assert from 'node:assert/strict';
import { gameReminder, gameNotice, reminderEml } from '../reminders.mjs';
import { scheduleChangeUpdate } from '../schedule-history.mjs';

test('reschedule notices show both arrangements and include former teams without exposing addresses', () => {
  const before = { ...game, homeTeamId: 'former', homeName: 'Former', date: '2026-09-25', time: '17:00', durationMinutes: 60, fieldId: 'old', fieldName: 'Old field' };
  const after = { ...game, durationMinutes: 90, fieldId: 'new' };
  const moved = { ...after, ...scheduleChangeUpdate(before, after, 'organizer', 'now') };
  const users = [{ role: 'player', linkedPlayerId: 'p', email: 'current@example.test' },
    { role: 'player', linkedPlayerId: 'former', email: 'former@example.test' },
    { role: 'teamManager', linkedTeamId: 'former', email: 'manager@example.test' },
    { role: 'parent', linkedPlayerIds: ['child'], email: 'optout@example.test', emailReminders: false }];
  const draft = gameNotice(moved, [...players, { id: 'former', teamId: 'former' }], users, 'https://example.test/', 'reschedule');
  assert.deepEqual(draft.recipients, ['current@example.test', 'former@example.test', 'manager@example.test']);
  assert.equal(draft.subject, 'Game rescheduled: Home vs Away');
  assert.match(draft.body, /Previous arrangement \(scheduled\):\nFormer vs Away/);
  assert.match(draft.body, /Date: 2026-09-25\nTime: 17:00 \(field local time\)\nField: Old field\nDuration: 60 minutes/);
  assert.match(draft.body, /New arrangement:\nHome vs Away/);
  assert.match(draft.body, /Duration: 90 minutes/);
  assert.match(draft.body, /reconfirm your availability/);
  assert.doesNotMatch(draft.body, /@example/);
  for (const stale of [after, { ...moved, time: '20:00' }, { ...moved, status: 'cancelled' }, { ...moved, lastScheduleChange: { ...moved.lastScheduleChange, revision: 0 } }]) {
    assert.throws(() => gameNotice(stale, players, users, 'https://example.test/', 'reschedule'));
  }
});
const game = { status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', homeName: 'Home', awayName: 'Away', date: '2026-09-26', time: '18:00', fieldName: 'Main', umpireId: 'u' };
const players = [{ id: 'p', teamId: 'a' }, { id: 'child', teamId: 'b' }, { id: 'no-email', teamId: 'a' }, { id: 'archived', teamId: 'a', archived: true }];

test('cancellation notices retain recipient privacy and do not request an RSVP', () => {
  const users = [{ role: 'player', linkedPlayerId: 'p', email: 'player@example.test' },
    { role: 'parent', linkedPlayerIds: ['child'], email: 'parent@example.test', emailReminders: false }];
  const draft = gameNotice({ ...game, status: 'cancelled' }, players, users, 'https://example.test/', 'cancellation');
  assert.deepEqual(draft.recipients, ['player@example.test']);
  assert.equal(draft.subject, 'Game cancelled: Home vs Away');
  assert.match(draft.body, /has been cancelled/);
  assert.match(draft.body, /18:00 \(field local time\)/);
  assert.doesNotMatch(draft.body, /confirm your availability|player@example/);
  assert.throws(() => gameNotice(game, players, users, 'https://example.test/', 'cancellation'));
  assert.throws(() => gameNotice(game, players, users, 'https://example.test/', 'unknown'));
});

test('successive reschedules retain earlier teams and officials while respecting current roles and opt-outs', () => {
  const original = { ...game, homeTeamId: 'former', umpireId: 'old-umpire', scorekeeperId: 'old-scorer' };
  const first = { ...game, ...scheduleChangeUpdate(original, game, 'organizer', 'first') };
  const second = { ...first, time: '19:00', ...scheduleChangeUpdate(first, { ...first, time: '19:00' }, 'organizer', 'second') };
  const users = [{ role: 'player', linkedPlayerId: 'former-player', email: 'former@example.test' },
    { id: 'old-umpire', role: 'umpire', email: 'umpire@example.test' },
    { id: 'old-scorer', role: 'scorekeeper', email: 'scorer@example.test' }];
  const roster = [{ id: 'former-player', teamId: 'former' }];
  const history = [first.lastScheduleChange, second.lastScheduleChange];
  const draft = gameNotice(second, roster, users, 'https://example.test/', 'reschedule', history);
  assert.deepEqual(draft.recipients, ['former@example.test', 'scorer@example.test', 'umpire@example.test']);
  assert.deepEqual(gameNotice(second, roster, users.map(user => ({ ...user, emailReminders: false })), 'https://example.test/', 'reschedule', history).recipients, []);
  assert.deepEqual(gameNotice(second, roster, users.map(user => ({ ...user, role: 'visitor' })), 'https://example.test/', 'reschedule', history).recipients, []);
});
test('reminders include linked participants, parents and assigned staff, with deduplicated Bcc', () => {
  const draft = gameReminder(game, players, [
    { role: 'player', linkedPlayerId: 'p', email: 'Person@example.test' },
    { role: 'parent', linkedPlayerIds: ['child'], email: 'person@example.test' },
    { id: 'u', role: 'umpire', email: 'umpire@example.test' },
    { role: 'player', linkedPlayerId: 'archived', email: 'archived@example.test' },
    { role: 'player', linkedPlayerId: 'unrelated', email: 'unrelated@example.test' },
    { role: 'player', linkedPlayerId: 'no-email', email: 'bad\r\nBcc: x@example.test' },
  ], 'https://example.test/');
  assert.deepEqual(draft.recipients, ['person@example.test', 'umpire@example.test']);
  assert.equal(draft.playersWithoutRecipient, 1);
  const eml = reminderEml(draft); assert.match(eml, /X-Unsent: 1/); assert.match(eml, /Bcc: person@example.test, umpire@example.test/);
  assert.equal(eml.includes('\r\nTo:'), false);
});
test('drafts reject closed games, invalid recipients and header injection', () => {
  assert.throws(() => gameReminder({ ...game, status: 'cancelled' }, players, [], 'https://example.test/'));
  assert.throws(() => reminderEml({ recipients: [], body: '', subject: '' }));
  const eml = reminderEml({ recipients: ['a@example.test'], subject: 'Name\r\nCc: injected', body: 'Hello\nWorld' });
  assert.equal(eml.includes('\r\nCc:'), false);
  assert.match(eml, /Hello\r\nWorld/);
});

test('reminder opt-outs suppress shared addresses and staff without suppressing other recipients', () => {
  const users = [
    { role: 'player', linkedPlayerId: 'p', email: 'shared@example.test' },
    { role: 'parent', linkedPlayerIds: ['child'], email: ' SHARED@example.test ', emailReminders: false },
    { id: 'u', role: 'umpire', email: 'umpire@example.test', emailReminders: false },
    { role: 'parent', linkedPlayerIds: ['child'], email: 'other@example.test', emailReminders: true },
  ];
  const draft = gameReminder(game, players, users, 'https://example.test/');
  assert.deepEqual(draft.recipients, ['other@example.test']);
  assert.equal(draft.playersWithoutRecipient, 2);
});
