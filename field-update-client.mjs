import { fieldUpdate } from './field-data.mjs';

const path = '/api/fields/update';
export const fieldUpdateEndpoint = localMode => localMode ? `http://127.0.0.1:8082${path}` : null;
const uncertain = () => Object.assign(new Error('Save could not be confirmed. Close and reopen the field editor before trying again.'), { requiresRefresh: true });

export async function requestFieldUpdate({ endpoint, fieldId, expectedScheduleRevision, values, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw new Error('Field editing is unavailable until the league service is enabled.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      typeof fieldId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(fieldId) ||
      !Number.isSafeInteger(expectedScheduleRevision) || expectedScheduleRevision < 0 ||
      !user?.uid || typeof user.getIdToken !== 'function' || typeof isCurrent !== 'function') throw new Error('Invalid field update request.');
  const check = () => { if (!isCurrent()) throw new Error('Your access changed. Reopen the field editor.'); };
  check();
  const body = JSON.stringify({ fieldId, expectedScheduleRevision, values: fieldUpdate(values) });
  const token = await user.getIdToken(); check();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,8192}$/.test(token)) throw new Error('Sign in again before editing a field.');
  let response, result;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  } catch { check(); throw uncertain(); }
  check();
  try { result = await response.json(); } catch { check(); throw uncertain(); }
  check();
  if (response.status === 200 && result && Object.keys(result).length === 1 && result.status === 'updated') return { status: 'updated' };
  if (response.status === 409 && ['stale-revision', 'field-unavailable'].includes(result?.error)) {
    throw Object.assign(new Error('The field or schedule changed. Close and reopen the editor.'), { requiresRefresh: true });
  }
  if (response.status === 409 && result?.error === 'booking-conflict') throw new Error('An existing game does not fit these field hours, weekdays, or daylight. Adjust the field or reschedule the game first.');
  if (response.status === 503 && result?.error === 'daylight-unavailable') throw new Error('Daylight could not be verified. No changes were saved. Try again later.');
  if (response.status === 401) throw new Error('Sign in again before editing a field.');
  if (response.status === 403) throw new Error('Your account no longer has organizer access.');
  if (response.status === 429) throw new Error('Please wait one minute before saving another field update.');
  throw uncertain();
}
