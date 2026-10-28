import { validateProfileAccess } from './profile-access.mjs';
import { wireDialogSubmission } from './dialog-submit.mjs';

export function accessSelection({ role, teamId, playerId, childIds }, teams, players) {
  const active = id => players.find(p => p.id === id && (p.archived === undefined || p.archived === false) && teams.some(t => t.id === p.teamId));
  const value = { role, linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] };
  if (role === 'teamManager') {
    if (!teams.some(t => t.id === teamId)) throw new Error('Select an available team.');
    value.linkedTeamId = teamId;
  } else if (role === 'parent') {
    if (!Array.isArray(childIds) || childIds.some(id => !active(id))) throw new Error('Remove unavailable children before saving.');
    value.linkedPlayerIds = childIds;
  } else if (['player', 'captain'].includes(role) && playerId) {
    const player = active(playerId);
    if (!player) throw new Error('Select an active player on an existing team.');
    value.linkedPlayerId = player.id; value.linkedTeamId = player.teamId;
  }
  return validateProfileAccess(value);
}

export function openProfileAccessEditor({ target, teams, players, roleLabels, save }) {
  document.getElementById('profile-access-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'profile-access-dialog'; dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'profile-access-title');
  const form = document.createElement('form'), title = document.createElement('h2');
  title.id = 'profile-access-title'; title.textContent = 'Account access';
  const name = document.createElement('p'); name.textContent = target.displayName || target.email || target.id;
  const makeSelect = (caption, options, selected) => {
    const label = document.createElement('label'); label.textContent = caption;
    const select = document.createElement('select');
    for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
    if (selected && !options.some(([value]) => value === selected)) {
      const option = document.createElement('option'); option.value = selected; option.textContent = `Unavailable: ${selected}`; select.append(option);
    }
    select.value = selected || ''; label.append(select); return { label, select };
  };
  const eligible = players.filter(p => (p.archived === undefined || p.archived === false) && teams.some(t => t.id === p.teamId));
  const playerName = p => `${p.name} (${teams.find(t => t.id === p.teamId)?.name ?? 'Unavailable team'})`;
  const role = makeSelect('Role', Object.entries(roleLabels), target.role);
  const team = makeSelect('Team', [['', 'None'], ...teams.map(t => [t.id, t.name])], target.linkedTeamId);
  const player = makeSelect('Player', [['', 'None'], ...eligible.map(p => [p.id, playerName(p)])], target.linkedPlayerId);
  const grid = document.createElement('div'); grid.className = 'game-editor-grid'; grid.append(role.label, team.label, player.label);
  const children = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Children'; children.append(legend);
  const list = document.createElement('div'); list.className = 'access-children-list';
  const selected = new Set(target.linkedPlayerIds ?? []);
  const searchLabel = document.createElement('label'); searchLabel.textContent = 'Find child';
  const search = document.createElement('input'); search.type = 'search'; searchLabel.append(search);
  const childOptions = [...eligible.map(p => [p.id, playerName(p)]), ...[...selected].filter(id => !eligible.some(p => p.id === id)).map(id => [id, `Unavailable: ${id}`])]
    .sort((a, b) => Number(selected.has(b[0])) - Number(selected.has(a[0])) || a[1].localeCompare(b[1]));
  const childInputs = childOptions.map(([id, text]) => {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = id; input.checked = selected.has(id);
    label.append(input, document.createTextNode(text)); list.append(label); return input;
  });
  const count = document.createElement('p'); count.setAttribute('aria-live', 'polite');
  const recount = () => { count.textContent = `${childInputs.filter(input => input.checked).length} / 30 selected`; };
  childInputs.forEach(input => input.addEventListener('change', recount)); recount(); children.append(searchLabel, list, count);
  search.addEventListener('input', () => {
    const term = search.value.trim().toLocaleLowerCase();
    childInputs.forEach(input => { input.parentElement.hidden = !input.parentElement.textContent.toLocaleLowerCase().includes(term); });
  });
  const display = () => { team.label.hidden = role.select.value !== 'teamManager'; player.label.hidden = !['player', 'captain'].includes(role.select.value); children.hidden = role.select.value !== 'parent'; };
  role.select.addEventListener('change', display); display();
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'btn btn-primary'; submit.textContent = 'Save access'; actions.append(cancel, submit);
  form.append(title, name, grid, children, error, actions);
  wireDialogSubmission({ dialog, form, error, controls: [role.select, team.select, player.select, search, ...childInputs, cancel, submit], save,
    read: () => accessSelection({ role: role.select.value, teamId: team.select.value, playerId: player.select.value, childIds: childInputs.filter(input => input.checked).map(input => input.value) }, teams, players) });
  dialog.append(form); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
