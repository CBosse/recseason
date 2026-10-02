import { baseLabel } from './base-occupancy.mjs';
import { scoreReplay } from './score-replay.mjs';
import { scoreState } from './score-state.mjs';
export { scoreState } from './score-state.mjs';

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
  const replay = scoreReplay(game, entries);
  const playback = document.createElement('section'); playback.className = 'score-replay';
  if (replay.frames.length) {
    const label = document.createElement('label'); label.textContent = 'Recorded state';
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = String(replay.frames.length - 1); slider.step = '1'; slider.value = slider.max;
    label.append(slider);
    const state = document.createElement('p'); state.setAttribute('role', 'status'); state.className = 'score-replay-state';
    const reason = document.createElement('p');
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = 'Previous'; previous.className = 'btn btn-ghost';
    const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next'; next.className = 'btn btn-ghost';
    const controls = document.createElement('div'); controls.className = 'game-editor-actions'; controls.append(previous, next);
    const render = () => {
      const frame = replay.frames[Number(slider.value)]; const s = frame.state;
      state.textContent = `${frame.baseline ? 'Starting snapshot' : '#' + frame.revision}: ${s.homeScore ?? 0}-${s.awayScore ?? 0}, ${s.status}, ${s.half} ${s.inning}. Balls ${s.balls}, strikes ${s.strikes}, outs ${s.outs}. Runners: ${baseLabel(s.bases)}.`;
      reason.textContent = frame.reason;
      previous.disabled = slider.value === '0'; next.disabled = slider.value === slider.max;
    };
    previous.onclick = () => { slider.value = String(Number(slider.value) - 1); render(); };
    next.onclick = () => { slider.value = String(Number(slider.value) + 1); render(); };
    slider.oninput = render; render(); playback.append(label, state, reason, controls);
  }
  for (const warning of replay.warnings) { const note = document.createElement('p'); note.setAttribute('role', 'alert'); note.textContent = warning; playback.append(note); }
  const list = document.createElement('ol'); list.className = 'score-history-list';
  for (const entry of [...entries].sort((a, b) => b.revision - a.revision)) {
    const item = document.createElement('li');
    const time = entry.recordedAt?.toDate?.().toLocaleString() || '';
    item.textContent = `#${entry.revision} ${time}: ${entry.before.homeScore ?? 0}-${entry.before.awayScore ?? 0} to ${entry.after.homeScore ?? 0}-${entry.after.awayScore ?? 0} (${entry.after.status}, ${entry.after.half} ${entry.after.inning})${entry.reason ? '. ' + entry.reason : ''}`;
    if (entry.after.bases) item.append(document.createTextNode(`. Runners: ${baseLabel(entry.after.bases)}`));
    if (entry.after.lineScoreInning) item.append(document.createTextNode(`. Inning entry: ${entry.after.lineScoreInning}`));
    list.append(item);
  }
  const empty = document.createElement('p'); empty.textContent = 'No recorded score history. Older results may predate score tracking.';
  const close = document.createElement('button'); close.className = 'btn btn-primary'; close.textContent = 'Close'; close.onclick = () => dialog.close();
  dialog.append(title, playback, entries.length ? list : empty, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
}
