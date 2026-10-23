import { recoveryDatabase } from './backup-format.mjs';

export function localRecoveryIO(fetcher = fetch) {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Recovery is restricted to the local emulator at 127.0.0.1:8180.');
  const root = `http://127.0.0.1:8180/v1/${recoveryDatabase}/documents`;
  async function request(url, body, allowMissing = false) {
    const response = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Recovery request failed (HTTP ${response.status}). No production endpoint is used. If interrupted, use --resume with the same backup.`);
    return response.json();
  }
  return {
    get: path => request(`${root}/${path.split('/').map(encodeURIComponent).join('/')}`, undefined, true),
    commit: writes => request(`${root}:commit`, { writes }),
    async *list(collection) {
      let token;
      do {
        const url = new URL(`${root}/${collection}`); url.searchParams.set('pageSize', '300');
        if (token) url.searchParams.set('pageToken', token);
        const page = await request(url); for (const document of page.documents || []) yield document;
        token = page.nextPageToken;
      } while (token);
    },
  };
}
