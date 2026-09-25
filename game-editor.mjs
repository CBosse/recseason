import { gamesConflict } from './scheduling.mjs';

export function validateGame(game, { teams, fields, games, config }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(game.date) || !Number.isFinite(Date.parse(game.date)) || new Date(game.date).toISOString().slice(0, 10) !== game.date) throw new Error('Choose a valid game date.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(game.time)) throw new Error('Choose a valid game time.');
  if (game.homeTeamId === game.awayTeamId) throw new Error('Choose two different teams.');
  const home = teams.find(t => t.id === game.homeTeamId), away = teams.find(t => t.id === game.awayTeamId);
  const field = fields.find(f => f.id === game.fieldId);
  if (!home || !away || !field) throw new Error('The selected team or field no longer exists.');
  const duration = Number(game.durationMinutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('Duration must be between 1 and 1440 minutes.');
  if ((config.startDate && game.date < config.startDate) || (config.endDate && game.date > config.endDate)) throw new Error('Game date is outside the season.');
  const day = new Date(`${game.date}T12:00:00`).getDay();
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!Array.isArray(field.availableDays) || !field.availableDays.includes(day) || !validTime(field.openTime) || !validTime(field.closeTime) || game.time < field.openTime || minutes(game.time) + duration > minutes(field.closeTime)) throw new Error('Game must fit the field availability and opening hours.');
  const conflict = games.find(existing => existing.id !== game.id && gamesConflict(game, existing, config.gameDuration, config.bufferMinutes));
  if (conflict) throw new Error(`Conflict with ${conflict.homeName || 'another team'} at ${conflict.time}.`);
  return { ...game, durationMinutes: duration, homeName: home.name, awayName: away.name, fieldName: field.name };
}

export function openGameEditor({ game = {}, teams, fields, umpires, scorekeepers = [], config, save }) {
  document.getElementById('game-editor-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'game-editor-dialog';
  dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'game-editor-title');
  const form = document.createElement('form');
  const title = document.createElement('h2');
  title.id = 'game-editor-title';
  title.textContent = game.id ? 'Edit game' : 'Add game';
  form.append(title);
  const controls = {};
  const grid = document.createElement('div');
  grid.className = 'game-editor-grid';
  const field = (name, labelText, type, value, options) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement(options ? 'select' : 'input');
    input.name = name;
    if (options) options.forEach(option => input.add(new Option(option.name, option.id)));
    else input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
    input.required = !['umpireId', 'locked'].includes(name);
    if (type === 'number') { input.min = '1'; input.max = '1440'; input.step = '1'; }
    label.append(input);
    grid.append(label);
    controls[name] = input;
  };
  field('date', 'Date', 'date', game.date || config.startDate);
  field('time', 'Time', 'time', game.time);
  field('durationMinutes', 'Duration (minutes)', 'number', game.durationMinutes ?? config.gameDuration);
  field('fieldId', 'Field', '', game.fieldId || fields[0]?.id, fields);
  field('homeTeamId', 'Home team', '', game.homeTeamId || teams[0]?.id, teams);
  field('awayTeamId', 'Away team', '', game.awayTeamId || teams[1]?.id, teams);
  const umpireOptions = [{ id: '', name: 'Unassigned' }, ...umpires];
  if (game.umpireId && !umpires.some(u => u.id === game.umpireId)) umpireOptions.push({ id: game.umpireId, name: 'Current assignment (unavailable)' });
  field('umpireId', 'Umpire', '', game.umpireId || '', umpireOptions);
  const scorerOptions = [{ id: '', name: 'Unassigned' }, ...scorekeepers];
  if (game.scorekeeperId && !scorekeepers.some(u => u.id === game.scorekeeperId)) scorerOptions.push({ id: game.scorekeeperId, name: 'Current assignment (unavailable)' });
  field('scorekeeperId', 'Scorekeeper', '', game.scorekeeperId || '', scorerOptions);
  controls.scorekeeperId.required = false;
  field('locked', 'Keep during regeneration', 'checkbox', game.locked ?? true);
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const actions = document.createElement('div');
  actions.className = 'game-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel';
  cancel.onclick = () => dialog.close();
  const submit = document.createElement('button');
  submit.className = 'btn btn-primary'; submit.textContent = 'Save game';
  actions.append(cancel, submit);
  form.append(grid, error, actions);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      const values = Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.type === 'checkbox' ? input.checked : input.value]));
      await save({ ...values, id: game.id, durationMinutes: Number(values.durationMinutes), umpireId: values.umpireId || null, scorekeeperId: values.scorekeeperId || null });
      dialog.close();
    } catch (reason) { error.textContent = reason.message; }
    finally { submit.disabled = false; }
  };
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
