export function scoreState(game) {
  return { homeScore: game.homeScore ?? null, awayScore: game.awayScore ?? null, status: game.status,
    inning: game.inning ?? 1, half: game.half ?? 'top', balls: game.balls ?? 0, strikes: game.strikes ?? 0, outs: game.outs ?? 0 };
}

export function correctionReason(status, reason = '') {
  const text = String(reason).trim();
  if (text.length > 300 || (status === 'completed' && !text)) throw new Error('Enter a correction reason (up to 300 characters).');
  return text;
}

export function scoreHistoryEntry(gameId, before, patch, uid, reason = '') {
  if (!uid || !before || !gameId) throw new Error('Score history requires a game and scorer.');
  if (!Number.isSafeInteger(patch.scoreRevision) || patch.scoreRevision !== (before.scoreRevision ?? 0) + 1) throw new Error('The score changed. Reopen the editor.');
  reason = correctionReason(before.status, reason);
  return { gameId, revision: patch.scoreRevision, before: scoreState(before), after: scoreState({ ...before, ...patch }), scoredBy: uid, reason };
}

export function openScoreHistory(game, entries) {
  document.getElementById('score-history-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'score-history-dialog'; dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'score-history-title');
  const title = document.createElement('h2'); title.id = 'score-history-title'; title.textContent = `${game.homeName} vs ${game.awayName}: score history`;
  const list = document.createElement('ol'); list.className = 'score-history-list';
  for (const entry of [...entries].sort((a, b) => b.revision - a.revision)) {
    const item = document.createElement('li');
    const time = entry.recordedAt?.toDate?.().toLocaleString() || '';
    item.textContent = `#${entry.revision} ${time}: ${entry.before.homeScore ?? 0}-${entry.before.awayScore ?? 0} to ${entry.after.homeScore ?? 0}-${entry.after.awayScore ?? 0} (${entry.after.status}, ${entry.after.half} ${entry.after.inning})${entry.reason ? '. ' + entry.reason : ''}`;
    list.append(item);
  }
  const empty = document.createElement('p'); empty.textContent = 'No recorded score history. Older results may predate score tracking.';
  const close = document.createElement('button'); close.className = 'btn btn-primary'; close.textContent = 'Close'; close.onclick = () => dialog.close();
  dialog.append(title, entries.length ? list : empty, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
}
