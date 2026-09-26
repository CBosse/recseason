import { rsvpSchedule, isCurrentRsvp } from './rsvps.mjs';

export function checkInTeams(user, players, game) {
  if (!['scheduled', 'live'].includes(game.status)) return [];
  const teams = [game.homeTeamId, game.awayTeamId];
  if (['siteAdmin', 'commissioner', 'leagueManager'].includes(user?.role)) return teams;
  const team = user?.role === 'teamManager' ? user.linkedTeamId : user?.role === 'captain'
    ? players.find(p => p.id === user.linkedPlayerId && !p.archived)?.teamId : null;
  return teams.filter(id => id === team);
}

export function attendanceUpdate(game, player, status, previous, uid) {
  if (!['scheduled', 'live'].includes(game.status)) throw new Error('This game is closed for check-in.');
  if (player.archived || ![game.homeTeamId, game.awayTeamId].includes(player.teamId)) throw new Error('Player is not on an active game roster.');
  if (!['present', 'absent', 'unmarked'].includes(status)) throw new Error('Choose a valid attendance status.');
  return { gameId: game.id, playerId: player.id, teamId: player.teamId, status,
    ...rsvpSchedule(game), revision: (previous?.revision ?? 0) + 1, checkedBy: uid };
}

export function openCheckIn(game, teamName, players, records, save) {
  document.getElementById('attendance-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'attendance-dialog'; dialog.className = 'game-editor';
  const form = document.createElement('form');
  const heading = document.createElement('h2'); heading.textContent = `${teamName} check-in`;
  const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const controls = [];
  for (const player of players.filter(p => !p.archived)) {
    const previous = records.find(r => r.playerId === player.id);
    const status = previous && isCurrentRsvp(previous, game) ? previous.status : 'unmarked';
    const label = document.createElement('label'); label.textContent = `${player.number ? `#${player.number} ` : ''}${player.name}`;
    const select = document.createElement('select');
    for (const [value, text] of [['unmarked', 'Not checked in'], ['present', 'Present'], ['absent', 'Absent']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = status; label.append(select); grid.append(label); controls.push({ player, previous, status, select });
  }
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  if (!controls.length) error.textContent = 'No active players on this roster.';
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.className = 'btn btn-primary'; submit.textContent = 'Save check-in'; submit.disabled = !controls.length;
  actions.append(cancel, submit); form.append(heading, grid, error, actions); dialog.append(form);
  form.onsubmit = async event => {
    event.preventDefault(); error.textContent = ''; submit.disabled = true;
    try { await save(controls.filter(c => c.select.value !== c.status).map(c => ({ player: c.player, previous: c.previous, status: c.select.value }))); dialog.close(); }
    catch (reason) { error.textContent = reason.message; }
    finally { submit.disabled = false; }
  };
  document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
