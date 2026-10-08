import { notificationStates, validateNotificationSummary } from './notification-status.mjs';
// Set only after the hosted endpoint and controlled inbox release gates pass.
const productionEndpoint = null;

export function reminderEndpoint(localMode) {
  return localMode ? 'http://127.0.0.1:8082/api/game-reminders' : productionEndpoint;
}

const errors = {
  401: 'Your sign-in is no longer valid. Sign in again before retrying.',
  403: 'Your account no longer has organizer access.',
  409: 'This game is no longer available for reminders. Refresh the schedule.',
  429: 'Please wait one minute before requesting another reminder.',
};

async function reminderRequest({ endpoint, gameId, user, isCurrent, fetcher = fetch }, statusOnly = false) {
  if (typeof endpoint !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(gameId ?? '') || !user) throw new Error('Reminder service is unavailable.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/api/game-reminders' ||
    (url.protocol !== 'https:' && url.href !== 'http://127.0.0.1:8082/api/game-reminders')) throw new Error('Invalid reminder service address.');
  if (!isCurrent()) throw new Error('Your account changed. Reopen the game before retrying.');
  const token = await user.getIdToken();
  if (!isCurrent()) throw new Error('Your account changed. Reopen the game before retrying.');
  let response;
  try {
    response = await fetcher(url.href + (statusOnly ? '/status' : ''), { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId }) });
  } catch { throw new Error('The reminder request could not be confirmed. Check your connection and retry; identical reminders are not queued twice.'); }
  if (!isCurrent()) throw new Error('Your account changed. Reopen the game before retrying.');
  if (response.status !== (statusOnly ? 200 : 202)) throw new Error(errors[response.status] ?? 'The reminder service is temporarily unavailable. Please retry later.');
  let result;
  try { result = await response.json(); } catch { throw new Error('The reminder request could not be confirmed. Please retry later.'); }
  if (statusOnly) return validateNotificationSummary(result);
  if (!result || !['created', 'existing', 'recipients', 'playersWithoutRecipient'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0)
    || result.created + result.existing !== result.recipients || result.recipients > 200 || result.playersWithoutRecipient > 1000) throw new Error('The reminder service returned an invalid result.');
  return { created: result.created, existing: result.existing, recipients: result.recipients, playersWithoutRecipient: result.playersWithoutRecipient };
}

export const requestGameReminder = options => reminderRequest(options);
export const requestReminderStatus = options => reminderRequest(options, true);

export function openReminderStatus(game, load) {
  document.getElementById('reminder-status-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'reminder-status-dialog'; dialog.className = 'game-editor-dialog'; dialog.setAttribute('aria-labelledby', 'reminder-status-title');
  const heading = document.createElement('h2'); heading.id = 'reminder-status-title'; heading.textContent = 'Reminder status';
  const details = document.createElement('p'); details.className = 'queued-reminder-details'; details.textContent = `${game.homeName} vs ${game.awayName}`;
  const output = document.createElement('div'); output.setAttribute('role', 'status'); output.className = 'queued-reminder-status';
  const note = document.createElement('p'); note.className = 'queued-reminder-details'; note.textContent = 'All reminder requests for this game. Provider acceptance does not confirm inbox delivery.';
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'Close'; close.onclick = () => dialog.close();
  const refresh = document.createElement('button'); refresh.className = 'btn btn-primary'; refresh.textContent = 'Refresh';
  const labels = ['Queued', 'Retry scheduled', 'Sending', 'Provider accepted', 'Suppressed', 'Failed', 'Needs review'];
  refresh.onclick = async () => {
    if (refresh.disabled) return;
    refresh.disabled = true; error.hidden = true; output.textContent = 'Loading status...';
    try {
      const summary = await load();
      if (!dialog.isConnected) return;
      output.textContent = summary.total ? '' : 'No reminder requests recorded.';
      if (summary.total) {
        const list = document.createElement('dl'); list.className = 'reminder-status-counts';
        notificationStates.forEach((state, index) => { const term = document.createElement('dt'); term.textContent = labels[index]; const count = document.createElement('dd'); count.textContent = summary.counts[state]; list.append(term, count); });
        output.append(list);
      }
    } catch (failure) { if (dialog.isConnected) { output.textContent = ''; error.textContent = failure.message; error.hidden = false; } }
    finally { refresh.disabled = false; }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  actions.append(close, refresh); dialog.append(heading, details, output, note, error, actions); document.body.append(dialog); dialog.showModal(); refresh.onclick();
}

export function openQueuedReminder(game, submit) {
  document.getElementById('queued-reminder-dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'queued-reminder-dialog'; dialog.className = 'game-editor-dialog'; dialog.setAttribute('aria-labelledby', 'queued-reminder-title');
  const heading = document.createElement('h2'); heading.id = 'queued-reminder-title'; heading.textContent = 'Queue game reminder?';
  const details = document.createElement('p'); details.className = 'queued-reminder-details';
  details.textContent = `${game.homeName} vs ${game.awayName} | ${game.date} ${game.time} | ${game.fieldName}`;
  const status = document.createElement('p'); status.className = 'queued-reminder-status'; status.setAttribute('role', 'status');
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const close = document.createElement('button'); close.className = 'btn btn-ghost'; close.textContent = 'Cancel'; close.onclick = () => dialog.close();
  const queue = document.createElement('button'); queue.className = 'btn btn-primary'; queue.textContent = 'Queue reminder';
  let pending = false, complete = false;
  queue.onclick = async () => {
    if (pending || complete) return;
    pending = true; queue.disabled = close.disabled = true; error.hidden = true; status.textContent = 'Queueing reminder...';
    try {
      const result = await submit();
      if (!dialog.isConnected) return;
      complete = true; heading.textContent = 'Reminder request recorded'; close.textContent = 'Close'; queue.hidden = true;
      status.textContent = `${result.created} newly queued. ${result.existing} already recorded. ${result.playersWithoutRecipient} players without an eligible email recipient. Delivery is not yet confirmed.`;
    } catch (failure) {
      if (!dialog.isConnected) return;
      status.textContent = ''; error.textContent = failure.message; error.hidden = false;
    } finally { pending = false; close.disabled = false; queue.disabled = complete; }
  };
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  actions.append(close, queue); dialog.append(heading, details, status, error, actions); document.body.append(dialog); dialog.showModal();
}
