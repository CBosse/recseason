# Field availability updates

`server/field-update-service.mjs` implements organizer-authorized transactional
updates of existing fields in the named `recseason` database. It validates the
complete six-field payload, reads all bookings for that field, and commits the
field and schedule revision together. Both scheduled and live games must still
fit their weekday, opening/closing hours, and saved duration (or season default).
Final and cancelled games retain their historical arrangements without blocking
future availability changes. Unknown statuses and malformed active bookings fail
closed rather than being silently ignored.

For unlit fields, a trusted server daylight resolver is required for each active
booking date. Missing, invalid or unavailable daylight fails closed. Lookups are
deduplicated by date and run before the transaction. The transaction rereads the
organizer role, field, schedule revision, season configuration and all field games
before committing; changed schedule revisions reject the entire edit. Request
payloads cannot supply daylight windows or the acting identity.

This is a service checkpoint, not a deployed security boundary. The current editor
still uses its client-side checks and existing publication transaction. Remaining
work: provide the trusted location/timezone/daylight resolver, expose the service
through the verified HTTP boundary, connect the editor, then deny direct field
updates in candidate rules and deploy API/client/rules together. Do not claim the
direct-write availability gap is closed until those steps are verified.

`tests/field-update-workflow.mjs` exercises the real Firestore emulator transaction,
including safe narrowing, conflicting narrowing, exact boundaries, stale requests,
lost access during daylight lookup, concurrent edits and historical games. It uses
synthetic daylight only and never calls an external provider or production data.
