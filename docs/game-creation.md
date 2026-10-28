# Server-validated game creation

`server/game-creation-service.mjs` creates a scheduled game only in the named
`recseason` database. It checks a fresh organizer role and schedule revision,
current teams/field/officials, season and opening hours, trusted daylight,
and all bookings on the requested date. Display names and initial score/status
are server-derived. Selected league rules must match the confirmed revision.

The transaction creates the game and advances the shared schedule revision.
Concurrent requests cannot both consume the same revision. Existing IDs cannot
be overwritten. Cancelled games release their slots; other saved games retain
their reservations. Malformed non-cancelled bookings fail closed.

Daylight is resolved outside the transaction. The transaction rechecks the actor,
field snapshot and revision before using that result. No client-supplied daylight
window is accepted. The resolver is an injected trusted server dependency.

`POST /api/games/create` verifies a revocation-checked Firebase token and accepts
exactly `gameId`, `expectedScheduleRevision`, and `values`. Its independent durable
60-second per-user throttle and 4 KiB payload limit bound requests. The runtime
uses a trusted daylight resolver with a 12-second deadline. Responses contain only
creation status and game ID; conflicts return 409, unavailable daylight 503,
invalid input 400, and insufficient permissions 403. Unknown errors stay private.

Browser integration, server-side edits/regeneration, and coordinated rules
deployment remain required. Direct browser writes are unchanged in this checkpoint;
the production integrity gap is not closed yet.
