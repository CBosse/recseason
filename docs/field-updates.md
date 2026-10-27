# Field availability updates

`server/field-update-service.mjs` implements organizer-authorized transactional
updates of existing fields in the named `recseason` database. It validates the
complete six-field payload, reads all bookings for that field, and commits the
field and schedule revision together. Both scheduled and live games must still
fit their weekday, opening/closing hours, and saved duration (or season default).
Completed (`status: 'completed'`) and cancelled games retain their historical arrangements without blocking
future availability changes. Unknown statuses and malformed active bookings fail
closed rather than being silently ignored.

For unlit fields, a trusted server daylight resolver is required for each active
booking date. Missing, invalid or unavailable daylight fails closed. Lookups are
deduplicated by date and run before the transaction. The transaction rereads the
organizer role, field, schedule revision, season configuration and all field games
before committing; changed schedule revisions reject the entire edit. Request
payloads cannot supply daylight windows or the acting identity.

The verified HTTP route is `POST /api/fields/update`, with exactly `fieldId`,
`expectedScheduleRevision` and `values`. Identity comes from a revocation-checked
Firebase token. The endpoint has its own durable per-user 60-second throttle,
1 KiB body limit and shared 16-request concurrency limit. Conflicts return 409,
revoked roles 403, invalid inputs 400, and unavailable daylight 503. No provider
response or booking details are exposed in errors.

The server daylight resolver uses ZIP coordinates from [Zippopotam.us](https://www.zippopotam.us/)
and [Sunrise-Sunset.org v2](https://sunrise-sunset.org/api) for location-local times.
It verifies dates, coordinates, timezone/offset consistency and event order, rounds
sunrise up and sunset down to whole minutes, and rejects polar/overnight windows.
Responses are bounded to 64 KiB; redirects are rejected. All lookups in one edit
share a 12-second deadline. Up to 256 verified windows are cached for 24 hours.
ZIP coordinates are an approximation, not a surveyed field location; precise
field coordinates and organizer verification remain a pilot requirement.

The local editor now sends changes through this API. It reads the schedule revision
and current field from the server, rejects a changed field or session, and requires
closing/reopening after stale or uncertain results. Pending submissions remain
single-flight. Production editing is disabled until an API endpoint is configured.
Candidate rules deny direct updates of existing fields, including organizer batches
that advance the schedule revision; creation remains validated and revision-guarded.
Deploy API/client/rules together. These rules are not yet deployed to production,
so the production direct-write gap is not claimed as closed.

`tests/field-update-workflow.mjs` exercises the real Firestore emulator transaction,
including safe narrowing, conflicting narrowing, exact boundaries, stale requests,
lost access during daylight lookup, concurrent edits and historical games. It uses
synthetic daylight only and never calls an external provider or production data.
The provider adapter has separate deterministic tests; a manual read-only lookup
for ZIP 02108 on October 26, 2026 returned 07:11-17:45 successfully. This does not
prove provider uptime, season-scale cold-cache latency, or field-level accuracy.
