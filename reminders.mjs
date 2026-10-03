const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
const line = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

export function gameReminder(game, players, users, appUrl) {
  if (game.status !== 'scheduled') throw new Error('Reminders are available for scheduled games only.');
  const active = players.filter(p => !p.archived && [game.homeTeamId, game.awayTeamId].includes(p.teamId));
  const ids = new Set(active.map(p => p.id));
  const covered = new Set();
  const emails = new Set();
  const optedOut = new Set(users.filter(user => user.emailReminders === false).map(user => String(user.email || '').trim().toLowerCase()));
  for (const user of users) {
    const linked = user.role === 'parent' ? (user.linkedPlayerIds || []).filter(id => ids.has(id)) :
      ['player', 'captain'].includes(user.role) && ids.has(user.linkedPlayerId) ? [user.linkedPlayerId] : [];
    const staff = (user.role === 'teamManager' && [game.homeTeamId, game.awayTeamId].includes(user.linkedTeamId)) ||
      (user.role === 'umpire' && user.id === game.umpireId) || (user.role === 'scorekeeper' && user.id === game.scorekeeperId);
    const email = String(user.email || '').trim().toLowerCase();
    if ((!linked.length && !staff) || !emailPattern.test(email) || optedOut.has(email)) continue;
    linked.forEach(id => covered.add(id)); emails.add(email);
  }
  const url = new URL(appUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid app URL.');
  const subject = `Game reminder: ${line(game.homeName)} vs ${line(game.awayName)}`;
  const body = `${line(game.homeName)} vs ${line(game.awayName)}\nDate: ${line(game.date)}\nTime: ${line(game.time)} (field local time)\nField: ${line(game.fieldName)}\n\nPlease confirm your availability in RecSeason and check the schedule for updates.\n${url.href}\n`;
  return { subject, body, recipients: [...emails].sort(), playersWithoutRecipient: active.filter(p => !covered.has(p.id)).length };
}

export function reminderEml(draft) {
  if (!draft.recipients.length || draft.recipients.some(email => !emailPattern.test(email))) throw new Error('No valid reminder recipients.');
  return `X-Unsent: 1\r\nBcc: ${draft.recipients.join(', ')}\r\nSubject: ${line(draft.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${draft.body.replace(/\r?\n/g, '\r\n')}`;
}

export function openReminderDraft(draft) {
  document.getElementById('reminder-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'reminder-dialog'; dialog.className = 'game-editor-dialog'; dialog.setAttribute('aria-labelledby', 'reminder-title');
  const heading = document.createElement('h2'); heading.id = 'reminder-title'; heading.textContent = 'Game reminder draft';
  const status = document.createElement('p'); status.style.marginBottom = '16px'; status.textContent = `${draft.recipients.length} Bcc ${draft.recipients.length === 1 ? 'recipient' : 'recipients'}. Not sent. Players without an eligible email recipient: ${draft.playersWithoutRecipient}.`;
  const subject = document.createElement('input'); subject.value = draft.subject; subject.setAttribute('aria-label', 'Subject');
  const recipients = document.createElement('textarea'); recipients.readOnly = true; recipients.value = draft.recipients.join('\n'); recipients.setAttribute('aria-label', 'Bcc recipients'); recipients.rows = 3;
  const body = document.createElement('textarea'); body.value = draft.body; body.setAttribute('aria-label', 'Message'); body.rows = 10;
  const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  for (const [title, control] of [['Subject', subject], ['Bcc recipients', recipients], ['Message', body]]) {
    const label = document.createElement('label'); label.textContent = title; label.style.gridColumn = '1 / -1'; control.style.width = '100%'; control.style.boxSizing = 'border-box'; label.append(control); grid.append(label);
  }
  const actions = document.createElement('div'); actions.className = 'game-editor-actions'; actions.style.marginTop = '16px';
  const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'Close'; close.onclick = () => dialog.close();
  const download = document.createElement('button'); download.className = 'btn btn-primary'; download.textContent = 'Download email draft'; download.disabled = !draft.recipients.length;
  download.onclick = () => {
    const blob = new Blob([reminderEml({ ...draft, subject: subject.value, body: body.value })], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'recseason-reminder.eml'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  actions.append(close, download); dialog.append(heading, status, grid, actions);
  document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
