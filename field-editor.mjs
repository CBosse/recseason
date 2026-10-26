import { wireDialogSubmission } from './dialog-submit.mjs';
import { fieldUpdate } from './field-data.mjs';
export { fieldUpdate, fieldFitsGame, fieldWindow } from './field-data.mjs';

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
  wireDialogSubmission({ dialog, form, error, controls: [...Object.values(controls), ...dayInputs, cancel, submit], save,
    read: () => {
      const values = Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : input.value]));
      values.availableDays = dayInputs.flatMap((input, day) => input.checked ? [day] : []);
      return fieldUpdate(values);
    },
  });
  dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
