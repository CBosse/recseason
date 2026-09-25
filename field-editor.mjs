const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function fieldUpdate(values) {
  const name = String(values.name ?? '').trim(), zipCode = String(values.zipCode ?? '').trim();
  if (!name || name.length > 100) throw new Error('Enter a field name of 1 to 100 characters.');
  if (!validTime(values.openTime) || !validTime(values.closeTime) || values.openTime >= values.closeTime) throw new Error('Closing time must be later than opening time on the same day.');
  if (!Array.isArray(values.availableDays) || !values.availableDays.length || values.availableDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Select at least one valid weekday.');
  if (typeof values.hasLights !== 'boolean') throw new Error('Choose whether the field has lights.');
  if ((zipCode || !values.hasLights) && !/^\d{5}$/.test(zipCode)) throw new Error('Enter a five-digit ZIP code; unlit fields require it for daylight checks.');
  return { name, zipCode, openTime: values.openTime, closeTime: values.closeTime, hasLights: values.hasLights, availableDays: [...new Set(values.availableDays)].sort() };
}

export function fieldFitsGame(field, game, defaultDuration) {
  const duration = Number(game.durationMinutes ?? defaultDuration);
  const day = new Date(`${game.date}T12:00:00`).getDay();
  return validTime(game.time) && Number.isInteger(duration) && duration > 0 && field.availableDays.includes(day) &&
    game.time >= field.openTime && minutes(game.time) + duration <= minutes(field.closeTime);
}

export function fieldWindow(field, sun) {
  if (!validTime(field.openTime) || !validTime(field.closeTime)) return null;
  let open = field.openTime, close = field.closeTime;
  if (!field.hasLights) {
    if (!sun || !validTime(sun.sunrise) || !validTime(sun.sunset)) return null;
    open = open > sun.sunrise ? open : sun.sunrise;
    close = close < sun.sunset ? close : sun.sunset;
  }
  return open < close ? { open, close } : null;
}

export function openFieldEditor(field, save) {
  document.getElementById('field-editor-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'field-editor-dialog'; dialog.className = 'game-editor-dialog'; dialog.setAttribute('aria-labelledby', 'field-editor-title');
  const form = document.createElement('form');
  const heading = document.createElement('h2'); heading.id = 'field-editor-title'; heading.textContent = 'Edit field';
  const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const controls = {};
  for (const [name, title, type] of [['name', 'Field name', 'text'], ['openTime', 'Opens', 'time'], ['closeTime', 'Closes', 'time'], ['zipCode', 'ZIP code', 'text'], ['hasLights', 'Field has lights', 'checkbox']]) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement('input'); input.name = name; input.type = type;
    if (type === 'checkbox') input.checked = Boolean(field[name]); else input.value = field[name] ?? '';
    input.required = ['name', 'openTime', 'closeTime'].includes(name);
    controls[name] = input; label.append(input); grid.append(label);
  }
  const days = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = 'Available days'; days.append(legend);
  const dayInputs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((title, day) => {
    const label = document.createElement('label'); label.style.display = 'block';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = field.availableDays?.includes(day) ?? false;
    label.append(input, ` ${title}`); days.append(label); return input;
  });
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.className = 'btn btn-primary'; submit.textContent = 'Save field';
  actions.append(cancel, submit); form.append(heading, grid, days, error, actions);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = ''; submit.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : input.value]));
      values.availableDays = dayInputs.flatMap((input, day) => input.checked ? [day] : []);
      await save(fieldUpdate(values)); dialog.close();
    } catch (reason) { error.textContent = reason.message; }
    finally { submit.disabled = false; }
  };
  dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
