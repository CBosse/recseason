import test from 'node:test';
import assert from 'node:assert/strict';
import { gameReminder, reminderEml } from '../reminders.mjs';
const game = { status: 'scheduled', homeTeamId: 'a', awayTeamId: 'b', homeName: 'Home', awayName: 'Away', date: '2026-09-26', time: '18:00', fieldName: 'Main', umpireId: 'u' };
const players = [{ id: 'p', teamId: 'a' }, { id: 'child', teamId: 'b' }, { id: 'no-email', teamId: 'a' }, { id: 'archived', teamId: 'a', archived: true }];
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
