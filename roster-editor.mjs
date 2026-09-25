export function rosterUpdate(kind, values) {
  const limits = kind === 'team' ? { name: 100, color: 40, homefield: 100 } : { name: 100, number: 10, phone: 40 };
  const result = {};
  for (const [key, max] of Object.entries(limits)) {
    result[key] = String(values[key] ?? '').trim();
    if (result[key].length > max) throw new Error(`${key} must be at most ${max} characters.`);
  }
  if (!result.name) throw new Error('Enter a name.');
  return result;
}

export function openRosterEditor(kind, record, save) {
  document.getElementById('roster-editor-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'roster-editor-dialog'; dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'roster-editor-title');
  const form = document.createElement('form');
  const heading = document.createElement('h2'); heading.id = 'roster-editor-title'; heading.textContent = `Edit ${kind}`;
  const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const fields = kind === 'team' ? [['name', 'Team name'], ['color', 'Team color'], ['homefield', 'Home field']] : [['name', 'Player name'], ['number', 'Jersey number'], ['phone', 'Phone']];
  const controls = {};
  for (const [name, title] of fields) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement('input'); input.name = name; input.type = name === 'phone' ? 'tel' : 'text'; input.value = record[name] ?? ''; input.required = name === 'name';
    controls[name] = input; label.append(input); grid.append(label);
  }
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.className = 'btn btn-primary'; submit.textContent = 'Save changes';
  actions.append(cancel, submit); form.append(heading, grid, error, actions);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = ''; submit.disabled = true;
    try {
      await save(rosterUpdate(kind, Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value]))));
      dialog.close();
    } catch (reason) { error.textContent = reason.message; }
    finally { submit.disabled = false; }
  };
  dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
