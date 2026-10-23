import { automaticScoreEntry, automaticCorrectionEntry } from './automatic-scoring.mjs';

const productionEndpoint = null;
const path = '/api/games/plays';
export const automaticScoringEndpoint = localMode => localMode ? `http://127.0.0.1:8082${path}` : productionEndpoint;
const failure = (message, code, needsRefresh = false, retryAfterMs = 0) =>
  Object.assign(new Error(message), { code, needsRefresh, retryAfterMs });
const uncertain = () => failure('The play could not be confirmed. Refresh the game and history before submitting again.', 'unconfirmed', true);

export async function requestAutomaticPlay({ endpoint, gameId, game, entries, action, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw failure('Automatic scoring is not enabled for this league service.', 'scoring-disabled');
  let url;
  try { url = new URL(endpoint); } catch { throw failure('Invalid scoring endpoint.', 'invalid-request'); }
  if (url.username || url.password || url.hash || url.search || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      !user?.uid || typeof user.getIdToken !== 'function' || typeof isCurrent !== 'function') throw failure('Invalid scoring request.', 'invalid-request');
  const check = () => { if (!isCurrent()) throw failure('Your scoring session changed. Reopen the game.', 'session-changed', true); };
  check();
  const expectedRevision = game?.scoreRevision ?? 0;
  // Validate against the frozen rules and capture the payload before token refresh
  // yields control, so UI edits cannot change the play being submitted.
  const validate = action?.type === 'correction' ? automaticCorrectionEntry : automaticScoreEntry;
  validate({ gameId, game, entries, action, uid: user.uid, expectedRevision, engineVersion: 1 });
  const body = JSON.stringify({ gameId, expectedRevision, engineVersion: 1, action });
  if (new TextEncoder().encode(body).length > 1024) throw failure('The play exceeds the request limit.', 'invalid-request');
  let token;
  try { token = await user.getIdToken(); } catch {
    check(); throw failure('Sign in again before recording a play.', 'authentication-required', true);
  }
  check();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,8192}$/.test(token)) throw failure('Sign in again before recording a play.', 'authentication-required', true);
  let response;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  } catch { check(); throw uncertain(); }
  check();
  let result;
  try { result = await response.json(); } catch { check(); throw uncertain(); }
  check();
  if (response.status === 200) {
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 2 ||
        !['live', 'completed'].includes(result.status) || result.revision !== expectedRevision + 1) throw uncertain();
    return { status: result.status, revision: result.revision };
  }
  if (response.status === 401) throw failure('Sign in again before recording a play.', 'authentication-required', true);
  if (response.status === 403) throw failure('Your account no longer has scoring access to this game.', 'permission-denied', true);
  if (response.status === 429) {
    const seconds = Number(response.headers?.get('retry-after'));
    const retryAfterMs = Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 60 ? seconds * 1000 : 1000;
    throw failure('Please wait before recording another play.', 'rate-limited', false, retryAfterMs);
  }
  if (response.status === 409) {
    const messages = {
      'stale-revision': 'The score changed. Refresh the game before recording another play.',
      'game-unavailable': 'This game is no longer open for scoring. Refresh the game.',
      'game-incompatible': 'This game cannot start automatic scoring. Refresh and review its rules and scoring history.',
      'history-inconsistent': 'The score and history do not agree. Stop scoring and ask a league organizer to review them.',
      'correction-conflict': 'This correction conflicts with later actions. Refresh and review the play history.',
    };
    throw failure(messages[result?.error] ?? 'The game changed. Refresh before recording another play.', 'refresh-required', true);
  }
  if (response.status === 400 && ['invalid-request', 'invalid-action', 'invalid-correction'].includes(result?.error)) {
    throw failure('The play was rejected. Check the action and current game state.', result.error, true);
  }
  if (response.status === 503 && result?.error === 'scoring-disabled') throw failure('Automatic scoring is not enabled for this league service.', 'scoring-disabled');
  throw uncertain();
}
