const productionEndpoint = 'https://recseason-api-327987648702.us-central1.run.app/api/parent-invitations/accept';
const path = '/api/parent-invitations/accept';

export function parentInvitationEndpoint(localMode) {
  return localMode ? `http://127.0.0.1:8082${path}` : productionEndpoint;
}

export async function requestParentAcceptance({ endpoint, invitationId, user, isCurrent, fetcher = fetch }) {
  if (!endpoint) throw new Error('Parent invitation acceptance is temporarily unavailable. Contact your league administrator.');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== path ||
      (url.protocol !== 'https:' && url.href !== `http://127.0.0.1:8082${path}`) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(invitationId ?? '') || !user) throw new Error('Invalid invitation request.');
  const checkSession = () => { if (!isCurrent()) throw new Error('Your account changed. Reopen the invitation before retrying.'); };
  checkSession();
  const token = await user.getIdToken();
  checkSession();
  let response;
  try {
    response = await fetcher(url.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitationId }) });
  } catch { throw new Error('Acceptance could not be confirmed. Check your account before retrying this invitation.'); }
  checkSession();
  const errors = {
    401: 'Your sign-in is no longer valid. Sign in again.',
    403: 'Verify your invited email address before accepting.',
    409: 'This invitation is no longer available. Ask your league administrator to refresh it.',
    429: 'Please wait one minute before accepting another invitation.',
  };
  if (response.status !== 200) throw new Error(errors[response.status] ?? 'Invitation acceptance is temporarily unavailable. Please retry later.');
  let result;
  try { result = await response.json(); } catch { throw new Error('Acceptance could not be confirmed. Refresh your account.'); }
  checkSession();
  if (!result || !['accepted', 'already-accepted'].includes(result.status)) throw new Error('Acceptance could not be confirmed. Refresh your account.');
  return { status: result.status };
}
