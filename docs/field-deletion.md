# Transactional field removal

The server exposes `POST /api/fields/delete` with exactly `fieldId` and
`expectedScheduleRevision`. A verified Firebase identity and a current organizer
role are required. The runtime applies a separate per-user deletion throttle.

In one named-database transaction, removal checks the field, expected schedule
revision, and references from games, RSVP records, attendance, and both sides of
immutable schedule events. A referenced field cannot be deleted. Successful
removal advances the shared schedule revision so concurrent game publication
must retry against the missing field. Historical references intentionally keep
their field records; use archival rather than deletion for those records.

`tests/field-deletion-http.test.mjs` covers the HTTP contract, authentication,
origin checks, error privacy, and throttling. `tests/field-deletion-workflow.mjs`
uses local Auth and Firestore emulators to exercise references, stale revisions,
concurrent deletions, a real authenticated game-publication race, revoked roles,
and disabled accounts. The workflow is included in `npm run test:workflows`.

## Release Status

This is a backend checkpoint, not a completed production integrity fix. The
browser still uses its existing field-removal path. Next, connect the browser to
this endpoint with session and stale-state fencing, deny direct client field
deletion in candidate rules, and verify the combined workflow. Deploy the API,
client configuration, and named-database rules together after the hosting gate
in `api-deployment.md` is satisfied. No production service or rules were changed
by this checkpoint.
