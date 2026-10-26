import { validScoringRequest } from './scoring-request.mjs';
import { validFieldUpdateRequest } from './field-update-request.mjs';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function reminderHandler({ verifyToken, enqueue, status, enqueueCancellation, cancellationStatus, enqueueReschedule, rescheduleStatus, acceptParent, removeTeam, removeField, updateField, recordPlay, admit, origins }) {
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
    if (req.url === '/healthz' && req.method === 'GET') return reply(200, { status: 'ok' });
    const cancellation = req.url === '/api/game-cancellations' || req.url === '/api/game-cancellations/status';
    const reschedule = req.url === '/api/game-reschedules' || req.url === '/api/game-reschedules/status';
    const statusRequest = req.url === '/api/game-reminders/status' || req.url === '/api/game-cancellations/status' || req.url === '/api/game-reschedules/status';
    const parentRequest = req.url === '/api/parent-invitations/accept';
    const teamRequest = req.url === '/api/teams/delete';
    const fieldRequest = req.url === '/api/fields/delete';
    const fieldUpdateRequest = req.url === '/api/fields/update';
    const scoringRequest = req.url === '/api/games/plays';
    if (!fieldUpdateRequest && !scoringRequest && !fieldRequest && !teamRequest && !parentRequest && !statusRequest && !cancellation && !reschedule && req.url !== '/api/game-reminders') return reply(404, { error: 'not-found' });
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
      const idField = fieldRequest ? 'fieldId' : teamRequest ? 'teamId' : parentRequest ? 'invitationId' : 'gameId';
      const keys = fieldRequest ? ['fieldId', 'expectedScheduleRevision'] : teamRequest ? ['teamId', 'expectedRosterRevision', 'expectedScheduleRevision'] : [idField];
      if (fieldUpdateRequest ? !validFieldUpdateRequest(body) : scoringRequest ? !validScoringRequest(body) : (!body || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key)) ||
          !validId(body[idField]) || ((teamRequest || fieldRequest) && ![body.expectedScheduleRevision, ...(teamRequest ? [body.expectedRosterRevision] : [])].every(value => Number.isSafeInteger(value) && value >= 0)))) return reply(400, { error: 'invalid-request' });
      let identity;
      try { identity = await verifyToken(bearer[1]); }
      catch { return reply(401, { error: 'authentication-required' }); }
      if (!validId(identity?.uid)) return reply(401, { error: 'authentication-required' });
      if (!await admit(identity.uid, fieldUpdateRequest ? 'update-field' : scoringRequest ? 'record-play' : fieldRequest ? 'delete-field' : teamRequest ? 'delete-team' : parentRequest ? 'accept-parent' : statusRequest ? 'status' : 'enqueue')) { res.setHeader('Retry-After', scoringRequest ? '1' : '60'); return reply(429, { error: 'rate-limited' }); }
      if (fieldUpdateRequest) {
        const result = await updateField({ verifiedUid: identity.uid, fieldId: body.fieldId, expectedScheduleRevision: body.expectedScheduleRevision, values: body.values });
        return reply(200, { status: result.status });
      }
      if (scoringRequest) {
        const result = await recordPlay({ verifiedUid: identity.uid, gameId: body.gameId,
          expectedRevision: body.expectedRevision, engineVersion: body.engineVersion, action: body.action });
        return reply(200, { status: result.status, revision: result.revision });
      }
      if (fieldRequest) {
        const result = await removeField({ verifiedUid: identity.uid, fieldId: body.fieldId, expectedScheduleRevision: body.expectedScheduleRevision });
        return reply(200, { status: result.status });
      }
      if (teamRequest) {
        const result = await removeTeam({ verifiedUid: identity.uid, teamId: body.teamId,
          expectedRosterRevision: body.expectedRosterRevision, expectedScheduleRevision: body.expectedScheduleRevision });
        return reply(200, { status: result.status });
      }
      if (parentRequest) {
        const result = await acceptParent({ verifiedUid: identity.uid, invitationId: body.invitationId });
        return reply(200, { status: result.status });
      }
      if (statusRequest) return reply(200, await (reschedule ? rescheduleStatus : cancellation ? cancellationStatus : status)({ verifiedUid: identity.uid, gameId: body.gameId }));
      const result = await (reschedule ? enqueueReschedule : cancellation ? enqueueCancellation : enqueue)({ verifiedUid: identity.uid, gameId: body.gameId });
      return reply(202, { created: result.created, existing: result.existing, recipients: result.recipients, playersWithoutRecipient: result.playersWithoutRecipient });
    } catch (error) {
      if (fieldUpdateRequest) {
        const code = ['permission-denied', 'field-unavailable', 'booking-conflict', 'daylight-unavailable', 'stale-revision', 'invalid-request'].includes(error.code) ? error.code : 'temporarily-unavailable';
        return reply(code === 'permission-denied' ? 403 : code === 'invalid-request' ? 400 : ['daylight-unavailable', 'temporarily-unavailable'].includes(code) ? 503 : 409, { error: code });
      }
      if (scoringRequest) {
        const code = ['permission-denied', 'game-unavailable', 'game-incompatible', 'history-inconsistent', 'stale-revision', 'invalid-action', 'invalid-request', 'invalid-correction', 'correction-conflict', 'scoring-disabled'].includes(error.code) ? error.code : 'temporarily-unavailable';
        return reply(code === 'permission-denied' ? 403 : ['temporarily-unavailable', 'scoring-disabled'].includes(code) ? 503 : ['invalid-action', 'invalid-request', 'invalid-correction'].includes(code) ? 400 : 409, { error: code });
      }
      if (fieldRequest) {
        const code = ['permission-denied', 'field-unavailable', 'field-in-use', 'stale-revision'].includes(error.code) ? error.code : 'temporarily-unavailable';
        return reply(code === 'permission-denied' ? 403 : code === 'temporarily-unavailable' ? 503 : 409, { error: code });
      }
      if (teamRequest) {
        const code = ['permission-denied', 'team-unavailable', 'team-in-use', 'stale-revision'].includes(error.code) ? error.code : 'temporarily-unavailable';
        return reply(code === 'permission-denied' ? 403 : code === 'temporarily-unavailable' ? 503 : 409, { error: code });
      }
      if (parentRequest) {
        const code = ['permission-denied', 'invitation-unavailable', 'stale-links'].includes(error.code) ? error.code : 'temporarily-unavailable';
        return reply(code === 'permission-denied' ? 403 : code === 'temporarily-unavailable' ? 503 : 409, { error: code });
      }
      return reply(error.code === 'permission-denied' ? 403 : error.code === 'game-unavailable' ? 409 : 503,
        { error: error.code === 'permission-denied' ? 'organizer-required' : error.code === 'game-unavailable' ? 'game-unavailable' : 'temporarily-unavailable' });
    } finally { active--; }
  };
}
