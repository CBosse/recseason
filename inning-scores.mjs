import { parseScore } from './results.mjs';

export function inningScoreUpdate(game, values, expectedRevision) {
  if (!game || !['scheduled', 'live', 'completed'].includes(game.status)) throw new Error('This game is not available for scoring.');
  if ((game.scoreRevision ?? 0) !== expectedRevision) throw new Error('The score changed. Reopen the inning editor.');
  const inning = Number(values.inning);
  if (!Number.isInteger(inning) || inning < 1 || inning > 99) throw new Error('Choose an inning from 1 to 99.');
  const scoreCarry = game.scoreCarry ?? { home: parseScore(game.homeScore ?? 0), away: parseScore(game.awayScore ?? 0) };
  const lineScore = { ...game.lineScore, [inning]: { home: parseScore(values.home), away: parseScore(values.away) } };
  let homeScore = parseScore(scoreCarry.home), awayScore = parseScore(scoreCarry.away);
  for (const [key, entry] of Object.entries(lineScore)) {
    if (!/^[1-9][0-9]?$/.test(key)) throw new Error('Invalid stored inning.');
    homeScore += parseScore(entry.home); awayScore += parseScore(entry.away);
  }
  parseScore(homeScore); parseScore(awayScore);
  return { inning: Math.max(game.inning ?? 1, inning), lineScoreInning: inning, lineScore, scoreCarry, homeScore, awayScore, status: game.status === 'completed' ? 'completed' : 'live', scoreRevision: expectedRevision + 1 };
}

export function openInningEditor(game, save) {
  document.getElementById('inning-editor-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'inning-editor-dialog'; dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'inning-editor-title');
  const title = document.createElement('h2'); title.id = 'inning-editor-title'; title.textContent = `${game.homeName} vs ${game.awayName}: innings`;
  const form = document.createElement('form'); const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const controls = {};
  for (const [name, text, min, max] of [['inning', 'Inning', 1, 99], ['home', `${game.homeName} runs`, 0, 99999], ['away', `${game.awayName} runs`, 0, 99999]]) {
    const label = document.createElement('label'); label.textContent = text;
    const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = 1; input.required = true;
    controls[name] = input; label.append(input); grid.append(label);
  }
  let selected = game.inning ?? 1;
  const load = () => { controls.inning.value = selected; controls.home.value = game.lineScore?.[selected]?.home ?? 0; controls.away.value = game.lineScore?.[selected]?.away ?? 0; };
  load();
  controls.inning.onchange = () => {
    const old = game.lineScore?.[selected] ?? { home: 0, away: 0 };
    if ((Number(controls.home.value) !== old.home || Number(controls.away.value) !== old.away) && !confirm('Discard unsaved runs for this inning?')) { controls.inning.value = selected; return; }
    selected = Number(controls.inning.value); load(); render();
  };
  const summary = document.createElement('div'); summary.className = 'inning-summary';
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const reason = document.createElement('input'); reason.maxLength = 300; reason.required = game.status === 'completed';
  const reasonLabel = document.createElement('label'); reasonLabel.className = 'inning-note'; reasonLabel.textContent = game.status === 'completed' ? 'Correction reason' : 'Note (optional)'; reasonLabel.append(reason);
  function render() {
    summary.replaceChildren();
    try {
      const patch = inningScoreUpdate(game, { inning: controls.inning.value, home: controls.home.value, away: controls.away.value }, game.scoreRevision ?? 0);
      const table = document.createElement('table'); table.className = 'inning-table';
      const row = values => { const tr = document.createElement('tr'); for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; tr.append(cell); } table.append(tr); };
      row(['Inning', game.homeName, game.awayName]);
      if (patch.scoreCarry.home || patch.scoreCarry.away) row(['Unallocated', patch.scoreCarry.home, patch.scoreCarry.away]);
      Object.entries(patch.lineScore).sort(([a], [b]) => Number(a) - Number(b)).forEach(([n, scores]) => row([n, scores.home, scores.away]));
      row(['Total', patch.homeScore, patch.awayScore]); summary.append(table); error.textContent = '';
    } catch (e) { error.textContent = e.message; }
  }
  controls.home.oninput = render; controls.away.oninput = render;
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.className = 'btn btn-primary'; submit.textContent = 'Save inning'; actions.append(cancel, submit);
  form.append(title, grid, summary, reasonLabel, error, actions); render();
  form.onsubmit = async e => { e.preventDefault(); submit.disabled = true; try { await save({ inning: controls.inning.value, home: controls.home.value, away: controls.away.value, reason: reason.value }); dialog.close(); } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; } };
  dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
