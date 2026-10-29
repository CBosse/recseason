import { validateGameCreation } from './game-creation.mjs';
const path = '/api/games/create';
export const gameCreationEndpoint = local => local ? `http://127.0.0.1:8082${path}` : null;
const refresh = message => Object.assign(new Error(message), { requiresRefresh: true });
const uncertain = () => refresh('Creation could not be confirmed. Close this form and check the schedule before adding another game.');
export async function requestGameCreation({ endpoint, gameId, expectedScheduleRevision, values, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw new Error('Game creation service is unavailable.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      typeof gameId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(gameId) ||
      !Number.isSafeInteger(expectedScheduleRevision) || expectedScheduleRevision < 0 || !user?.uid ||
      typeof user.getIdToken !== 'function' || typeof isCurrent !== 'function') throw new Error('Invalid game creation request.');
  const check = () => { if (!isCurrent()) throw refresh('Your organizer session changed. Reopen the game form.'); };
  check();
  const body = JSON.stringify({ gameId, expectedScheduleRevision, values: validateGameCreation(values) });
  const token = await user.getIdToken(); check();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,8192}$/.test(token)) throw new Error('Sign in again before creating a game.');
  let response, result;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  } catch { check(); throw uncertain(); }
  check();
  try { result = await response.json(); } catch { check(); throw uncertain(); }
  check();
  if (response.status === 201 && result && Object.keys(result).length === 2 && result.status === 'created' && result.gameId === gameId) return { status: 'created', gameId };
  if (response.status === 409) throw refresh('The schedule, references, or rules changed, or this game conflicts with a booking. Close this form and check the schedule.');
  if (response.status === 401 || response.status === 403) throw refresh('Organizer access could not be verified. Sign in again.');
  if (response.status === 429) throw new Error('Please wait one minute before creating another game.');
  if (response.status === 503 && result?.error === 'daylight-unavailable') throw new Error('Daylight could not be verified. Try again later.');
  throw uncertain();
}
