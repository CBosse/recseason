const path = '/api/fields/delete';
export const fieldDeletionEndpoint = localMode => localMode ? `http://127.0.0.1:8082${path}` : null;

export async function requestFieldDeletion({ endpoint, fieldId, expectedScheduleRevision, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw new Error('Field removal is unavailable until the league service is enabled.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      typeof fieldId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(fieldId) ||
      !Number.isSafeInteger(expectedScheduleRevision) || expectedScheduleRevision < 0 ||
      !user?.uid || typeof user.getIdToken !== 'function' || typeof isCurrent !== 'function') throw new Error('Invalid field removal request.');
  const check = () => { if (!isCurrent()) throw new Error('Your access changed. Refresh before removing a field.'); };
  check();
  const body = JSON.stringify({ fieldId, expectedScheduleRevision });
  const token = await user.getIdToken(); check();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,8192}$/.test(token)) throw new Error('Sign in again before removing a field.');
  let response, result;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  } catch { check(); throw new Error('Removal could not be confirmed. Refresh the field list before trying again.'); }
  check();
  try { result = await response.json(); } catch { check(); throw new Error('Removal could not be confirmed. Refresh the field list.'); }
  check();
  if (response.status === 200 && result && Object.keys(result).length === 1 && result.status === 'deleted') return { status: 'deleted' };
  const errors = {
    'field-in-use': 'This field has linked games, attendance, RSVPs, or schedule history and cannot be removed.',
    'field-unavailable': 'This field was already removed. Refresh the field list.',
    'stale-revision': 'The schedule changed. Refresh and confirm removal again.',
  };
  throw new Error(response.status === 409 ? errors[result?.error] ?? 'The field changed. Refresh before retrying.' :
    response.status === 401 ? 'Sign in again before removing a field.' : response.status === 403 ? 'Your account no longer has organizer access.' :
    response.status === 429 ? 'Please wait one minute before removing another field.' : 'Removal could not be confirmed. Refresh the field list.');
}
