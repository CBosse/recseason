import { profileAccess, validAccessShape, validateProfileAccess } from './profile-access.mjs';
const path = '/api/accounts/access';
export const profileAccessEndpoint = local => local ? `http://127.0.0.1:8082${path}` : null;
const refresh = message => Object.assign(new Error(message), { requiresRefresh: true });
const uncertain = () => refresh('Save could not be confirmed. Close and reopen account access before trying again.');

export async function requestProfileAccess({ endpoint, targetUid, expectedAccess, expectedRosterRevision, access, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw new Error('Account access editing awaits league service deployment.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      typeof targetUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(targetUid) || !validAccessShape(expectedAccess) ||
      !Number.isSafeInteger(expectedRosterRevision) || expectedRosterRevision < 0 || !user?.uid ||
      typeof user.getIdToken !== 'function' || typeof isCurrent !== 'function') throw new Error('Invalid account access request.');
  const check = () => { if (!isCurrent()) throw refresh('Your administrator session changed. Reopen account access.'); };
  check();
  const body = JSON.stringify({ targetUid, expectedAccess: profileAccess(expectedAccess), expectedRosterRevision, access: validateProfileAccess(access) });
  const token = await user.getIdToken(); check();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,8192}$/.test(token)) throw new Error('Sign in again before editing account access.');
  let response, result;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  } catch { check(); throw uncertain(); }
  check();
  try { result = await response.json(); } catch { check(); throw uncertain(); }
  check();
  if (response.status === 200 && result && Object.keys(result).length === 1 && result.status === 'updated') return { status: 'updated' };
  if (response.status === 409) {
    if (result?.error === 'self-demotion') throw new Error('Another administrator must change your administrator role.');
    throw refresh('The account or roster changed, or a linked record is unavailable. Close and reopen account access.');
  }
  if (response.status === 401 || response.status === 403) throw refresh('Administrator access could not be verified. Sign in again.');
  if (response.status === 429) throw new Error('Please wait one minute before saving another account access change.');
  throw uncertain();
}
