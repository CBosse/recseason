import { INVITABLE_ROLES, invitationDetails } from './invitations.mjs';

function invitationDialog(title) {
  document.getElementById('invitation-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'invitation-dialog'; dialog.className = 'game-editor-dialog'; dialog.setAttribute('aria-labelledby', 'invitation-title');
  const heading = document.createElement('h2'); heading.id = 'invitation-title'; heading.textContent = title;
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const close = document.createElement('button'); close.type = 'button'; close.className = 'btn btn-ghost'; close.textContent = 'Close'; close.onclick = () => dialog.close();
  dialog.append(heading); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return { dialog, error, close };
}

export function openInvitationCreator({ teams, players, roleLabels, create }) {
  const { dialog, error, close } = invitationDialog('Invite to league');
  const form = document.createElement('form'); const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const controls = {}, labels = {};
  for (const [name, title, options] of [
    ['email', 'Email address', null],
    ['role', 'Role', INVITABLE_ROLES.map(id => ({ id, name: roleLabels[id] || id }))],
    ['linkedTeamId', 'Team', teams],
    ['linkedPlayerId', 'Roster player', players.filter(p => !p.archived)],
  ]) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement(options ? 'select' : 'input'); input.name = name;
    if (options) { input.add(new Option('Select', '')); options.forEach(item => input.add(new Option(item.name, item.id))); }
    else { input.type = 'email'; input.required = true; }
    controls[name] = input; labels[name] = label; label.append(input); grid.append(label);
  }
  controls.role.required = true; controls.role.value = 'player';
  const children = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Children'; children.append(legend);
  const childInputs = players.filter(p => !p.archived).map(player => {
    const label = document.createElement('label'); label.style.display = 'block';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = player.id; label.append(input, ` ${player.name}`); children.append(label); return input;
  });
  const sync = () => {
    labels.linkedTeamId.hidden = controls.role.value !== 'teamManager';
    labels.linkedPlayerId.hidden = !['player', 'captain'].includes(controls.role.value);
    children.hidden = controls.role.value !== 'parent';
  };
  controls.role.onchange = sync; sync();
  const submit = document.createElement('button'); submit.className = 'btn btn-primary'; submit.textContent = 'Create invitation';
  const actions = document.createElement('div'); actions.className = 'game-editor-actions'; actions.append(close, submit);
  const result = document.createElement('div'); result.setAttribute('aria-live', 'polite');
  form.append(grid, children, error, result, actions); dialog.append(form);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = ''; submit.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value]));
      values.linkedPlayerIds = childInputs.filter(input => input.checked).map(input => input.value);
      const url = await create(invitationDetails(values, { teams, players }));
      grid.hidden = true; children.hidden = true; submit.hidden = true;
      const label = document.createElement('label'); label.textContent = 'Invitation link';
      const link = document.createElement('input'); link.readOnly = true; link.value = url; link.style.width = '100%'; label.append(link);
      const note = document.createElement('p'); note.textContent = 'Created. Email not sent.';
      result.replaceChildren(label, note); link.focus(); link.select();
    } catch (reason) { error.textContent = reason.message; submit.disabled = false; }
  };
  dialog.showModal();
}

export function openInvitationRecipient({ invitation, roleLabel, verify, accept }) {
  const { dialog, error, close } = invitationDialog('League invitation');
  const details = document.createElement('p'); details.textContent = `${invitation.email} - ${roleLabel}`;
  const verifyButton = document.createElement('button'); verifyButton.className = 'btn btn-ghost'; verifyButton.textContent = 'Send verification email';
  const acceptButton = document.createElement('button'); acceptButton.className = 'btn btn-primary'; acceptButton.textContent = 'Verify and accept';
  const actions = document.createElement('div'); actions.className = 'game-editor-actions'; actions.style.flexWrap = 'wrap'; actions.append(close, verifyButton, acceptButton);
  verifyButton.onclick = async () => {
    verifyButton.disabled = true; error.textContent = '';
    try { await verify(); error.textContent = 'Verification email sent. Verify your email, then return to accept.'; }
    catch (reason) { error.textContent = reason.message; verifyButton.disabled = false; }
  };
  acceptButton.onclick = async () => {
    acceptButton.disabled = true; error.textContent = '';
    try { await accept(); dialog.close(); }
    catch (reason) { error.textContent = reason.message; acceptButton.disabled = false; }
  };
  dialog.append(details, error, actions); dialog.showModal();
}
