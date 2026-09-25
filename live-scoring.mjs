import { parseScore } from './results.mjs';

export function canScore(user, game) {
  return Boolean(user?.uid && game && (['siteAdmin', 'commissioner', 'leagueManager'].includes(user.role) ||
    (user.role === 'scorekeeper' && game.scorekeeperId === user.uid)));
}

export function liveScoreUpdate(game, values, user, expectedRevision) {
  if (!canScore(user, game)) throw new Error('You are not assigned to score this game.');
  if (!['scheduled', 'live'].includes(game.status)) throw new Error('This game is no longer open for live scoring.');
  if ((game.scoreRevision ?? 0) !== expectedRevision) throw new Error('The score changed in another session. Close and reopen the editor.');
  if (!['live', 'completed'].includes(values.status)) throw new Error('Choose a valid game status.');
  const updates = { homeScore: parseScore(values.homeScore), awayScore: parseScore(values.awayScore), status: values.status };
  for (const [name, min, max] of [['inning', 1, 99], ['balls', 0, 3], ['strikes', 0, 2], ['outs', 0, 2]]) {
    const number = Number(values[name]);
    if (values[name] === '' || values[name] == null || !Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid ${name}.`);
    updates[name] = number;
  }
  if (!['top', 'bottom'].includes(values.half)) throw new Error('Choose top or bottom of the inning.');
  return { ...updates, half: values.half, scoreRevision: expectedRevision + 1, scoredBy: user.uid };
}

export function openScoreEditor(game, save) {
  document.getElementById('score-editor-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'score-editor-dialog'; dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'score-editor-title');
  const form = document.createElement('form');
  const heading = document.createElement('h2');
  heading.id = 'score-editor-title'; heading.textContent = `${game.homeName} vs ${game.awayName}`;
  const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const controls = {};
  for (const [name, labelText, value, max] of [
    ['homeScore', 'Home score', game.homeScore ?? 0, 99999], ['awayScore', 'Away score', game.awayScore ?? 0, 99999],
    ['inning', 'Inning', game.inning ?? 1, 99], ['balls', 'Balls', game.balls ?? 0, 3],
    ['strikes', 'Strikes', game.strikes ?? 0, 2], ['outs', 'Outs', game.outs ?? 0, 2],
  ]) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input');
    input.name = name; input.type = 'number'; input.min = name === 'inning' ? '1' : '0'; input.max = String(max); input.step = '1'; input.required = true; input.value = value;
    label.append(input); grid.append(label); controls[name] = input;
  }
  for (const [name, labelText, options, value] of [
    ['half', 'Half inning', [['top', 'Top'], ['bottom', 'Bottom']], game.half ?? 'top'],
    ['status', 'Status', [['live', 'Live'], ['completed', 'Final']], 'live'],
  ]) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('select'); input.name = name;
    options.forEach(([id, title]) => input.add(new Option(title, id)));
    input.value = value; label.append(input); grid.append(label); controls[name] = input;
  }
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.className = 'btn btn-primary'; submit.textContent = 'Save score';
  actions.append(cancel, submit); form.append(heading, grid, error, actions);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = '';
    const values = Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.value]));
    if (values.status === 'completed' && !confirm('Finalize this result? It will count in the standings.')) return;
    submit.disabled = true;
    try { await save(values); dialog.close(); }
    catch (reason) { error.textContent = reason.message; }
    finally { submit.disabled = false; }
  };
  dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
