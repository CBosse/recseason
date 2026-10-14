const productionEndpoint = null;
const path = '/api/teams/delete';
export const teamDeletionEndpoint = localMode => localMode ? `http://127.0.0.1:8082${path}` : productionEndpoint;

export async function requestTeamDeletion({ endpoint, teamId, expectedRosterRevision, expectedScheduleRevision, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw new Error('Team removal is temporarily unavailable. Please try again after the league service is enabled.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.hash || url.search || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(teamId ?? '') || !user ||
      ![expectedRosterRevision, expectedScheduleRevision].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid team removal request.');
  const check = () => { if (!isCurrent()) throw new Error('Your access changed. Reopen the team before retrying.'); };
  check();
  const token = await user.getIdToken();
  check();
  let response;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, expectedRosterRevision, expectedScheduleRevision }) });
  } catch { throw new Error('Removal could not be confirmed. Refresh the team list before trying again.'); }
  check();
  let result;
  try { result = await response.json(); } catch { throw new Error('Removal could not be confirmed. Refresh the team list.'); }
  check();
  if (response.status !== 200) {
    const errors = {
      'team-in-use': 'This team has linked accounts or league records and cannot be removed.',
      'team-unavailable': 'This team was already removed. Refresh the team list.',
      'stale-revision': 'The roster or schedule changed. Close this confirmation and try again.',
    };
    throw new Error(response.status === 409 ? errors[result?.error] ?? 'The team changed. Refresh before retrying.' :
      response.status === 401 ? 'Sign in again before removing a team.' : response.status === 403 ? 'Your account no longer has organizer access.' :
      response.status === 429 ? 'Please wait one minute before removing another team.' : 'Team removal is temporarily unavailable.');
  }
  if (result?.status !== 'deleted') throw new Error('Removal could not be confirmed. Refresh the team list.');
  return { status: 'deleted' };
}

export function openTeamRemoval(team, remove) {
  document.getElementById('team-removal-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'team-removal-dialog'; dialog.className = 'game-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'team-removal-title');
  const heading = document.createElement('h2'); heading.id = 'team-removal-title'; heading.textContent = 'Remove team?';
  const name = document.createElement('p'); name.textContent = team.name; name.style.overflowWrap = 'anywhere';
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.className = 'btn btn-danger'; submit.textContent = 'Remove team';
  let pending = false;
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  submit.onclick = async () => {
    if (pending) return;
    pending = true; submit.disabled = true; cancel.disabled = true; error.hidden = true;
    try { await remove(); if (dialog.isConnected) dialog.close(); }
    catch (failure) { if (dialog.isConnected) { error.textContent = failure.message; error.hidden = false; } }
    finally { pending = false; submit.disabled = false; cancel.disabled = false; }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  actions.append(cancel, submit); dialog.append(heading, name, error, actions); document.body.append(dialog); dialog.showModal(); cancel.focus();
}
