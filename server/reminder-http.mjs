const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function reminderHandler({ verifyToken, enqueue, status, enqueueCancellation, cancellationStatus, admit, origins }) {
  const allowed = new Set(origins);
  let active = 0;
  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) return reply(403, { error: 'origin-denied' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    const cancellation = req.url === '/api/game-cancellations' || req.url === '/api/game-cancellations/status';
    const statusRequest = req.url === '/api/game-reminders/status' || req.url === '/api/game-cancellations/status';
    if (!statusRequest && !cancellation && req.url !== '/api/game-reminders') return reply(404, { error: 'not-found' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return reply(204, null);
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return reply(405, { error: 'method-not-allowed' }); }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) return reply(415, { error: 'json-required' });
    const bearer = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(req.headers.authorization ?? '');
    if (!bearer) return reply(401, { error: 'authentication-required' });
    if (active >= 16) return reply(503, { error: 'busy' });
    active++;
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024) return reply(413, { error: 'body-too-large' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'invalid-request' }); }
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !validId(body.gameId)) return reply(400, { error: 'invalid-request' });
      let identity;
      try { identity = await verifyToken(bearer[1]); }
      catch { return reply(401, { error: 'authentication-required' }); }
      if (!validId(identity?.uid)) return reply(401, { error: 'authentication-required' });
      if (!await admit(identity.uid, statusRequest ? 'status' : 'enqueue')) { res.setHeader('Retry-After', '60'); return reply(429, { error: 'rate-limited' }); }
      if (statusRequest) return reply(200, await (cancellation ? cancellationStatus : status)({ verifiedUid: identity.uid, gameId: body.gameId }));
      const result = await (cancellation ? enqueueCancellation : enqueue)({ verifiedUid: identity.uid, gameId: body.gameId });
      return reply(202, { created: result.created, existing: result.existing, recipients: result.recipients, playersWithoutRecipient: result.playersWithoutRecipient });
    } catch (error) {
      return reply(error.code === 'permission-denied' ? 403 : error.code === 'game-unavailable' ? 409 : 503,
        { error: error.code === 'permission-denied' ? 'organizer-required' : error.code === 'game-unavailable' ? 'game-unavailable' : 'temporarily-unavailable' });
    } finally { active--; }
  };
}
