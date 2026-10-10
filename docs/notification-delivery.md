# Notification Delivery

## Current Status

The production browser still downloads email drafts only. The local app now connects
organizer game actions to the authenticated enqueue endpoint. No background sender is configured,
and no mail is sent by the new module. `server/notification-jobs.mjs` contains a
provider-independent worker protocol. `server/notification-store.mjs` supplies a
durable transactional Firestore store fixed to the named `recseason` database.
Its emulator test uses independent clients to verify concurrent claims and persisted
results. A Resend HTTP adapter is implemented and tested with synthetic HTTP responses;
it is not configured for live sending. Server modules are not copied into the public
Pages build.

`server/game-reminder-service.mjs` now derives game-reminder messages and recipients
from a consistent database snapshot, checks the requesting organizer's current role,
and persists immutable game/requester provenance. Its send-time eligibility check
re-reads current roles, links, opt-outs, roster status, game state, and references.
The integration test runs the service through durable storage and the Resend adapter
with synthetic HTTP responses. It does not send to any inbox.

## Implemented Contract

- Each job contains exactly one recipient. An event kind, stable event ID, and
  normalized address determine its ID. Re-enqueueing the same event must not replace
  its message or resend an accepted job. A changed schedule requires a new event ID.
- Enqueue accepts at most 200 input recipients and a lifetime of at most 24 hours.
  Larger recipient sets require explicit upstream partitioning and capacity review.
- Storage must implement durable atomic `create(job)`, `get(id)`, and
  `compareAndSet(id, expectedVersion, nextJob)`. The Firestore adapter implements these
  operations and prevents event/recipient mutation. Browser reads, queries, creates,
  and deletes are denied by the existing catch-all rules, including for site admins.
  The worker therefore needs a trusted server identity, not a browser account.
- A two-minute lease and version comparison admit one worker. Expired leases become
  `needs-review`; they do not automatically resend. Late workers cannot overwrite a
  newer decision.
- `isEligible(job)` must fetch current preferences, recipient ownership, invitation
  state, and game revision/status as applicable, immediately before sending. Returning
  anything other than `true` suppresses delivery. Read failures retry without sending.
- A transport receives one `to` address, subject, text, and an idempotency key. It must
  have a bounded request timeout shorter than the lease and use server-held credentials.
- Only an explicit provider response confirming non-acceptance may be retryable.
  Five attempts maximum use exponential delays beginning at one minute. Expired jobs
  and permanent rejections fail without retry.
- A timeout, exception, malformed response, or expired send lease means delivery is
  uncertain. It requires operator reconciliation rather than an automatic retry.
  The Resend adapter also sends a stable idempotency key. Unknown outcomes still
  require review rather than relying solely on the provider's retention window.
- `accepted` means the provider accepted the request, not that an inbox received it.
  Delivery/bounce webhooks, receipt reconciliation, operator review, and audit UI remain
  to be implemented. The module records only bounded outcome codes, not raw exceptions.

## Remaining Integration

An authenticated Node endpoint is implemented at `POST /api/game-reminders`.
It accepts only JSON `{ "gameId": "..." }` and a Firebase ID token in the Bearer
authorization header. Firebase Admin verifies the token with revocation checking;
the service then reads the current organizer role. The response is aggregate counts
with HTTP 202 (queued, not sent). Recipient lists and caller-provided identities are
rejected. Invalid tokens return 401, non-organizers 403, unavailable games 409,
and temporary service failures 503 without raw error details.

The runtime admits one request per authenticated UID per minute using a Firestore
transaction in private `notificationLimits`, plus at most 16 active requests per
process. JSON bodies are limited to 1 KiB. CORS permits only the production app
origin, or fixed loopback origins in explicitly selected emulator mode. CORS is not
the authorization boundary. Production hosting must provide HTTPS, request limits,
least-privilege credentials and monitoring; it is not deployed by the Pages workflow.

Run `node scripts/serve-reminders.mjs --local` with both exact emulator variables
set to `127.0.0.1:9099` (Auth) and `127.0.0.1:8180` (Firestore), respectively.
The default listener is loopback port 8082. Without `--local`, the runtime targets
only `bosse-testing` and rejects emulator variables; use a managed HTTPS ingress.
The endpoint never starts the sending worker. The organizer schedule now includes a
separate confirmation dialog and queue action when an endpoint is configured.
`reminder-client.mjs` fixes the local address to loopback port 8082 and leaves the
production address unset until hosting and inbox gates pass. No URL parameter or
browser storage value can redirect an ID token. The client sends only a game ID,
checks account continuity before and after the request, and reports queued versus
existing counts without claiming delivery. Network failures are not automatically
retried. Existing draft downloads remain available to site administrators.
The same enabled game actions also expose aggregate reminder status, including
cancelled/completed games. `POST /api/game-reminders/status` accepts the same game-ID
body and verified token, rechecks the current organizer role transactionally, and
returns counts only. It reads at most 1,001 game-linked jobs and fails above 1,000,
rather than presenting a partial history as complete. All reminder event versions
for the game are included; other notice kinds are excluded. Reads and enqueue
requests have separate one-minute per-user limits. The status dialog refreshes only
on request and distinguishes provider acceptance from confirmed inbox delivery.
There is no recipient/receipt exposure, webhook delivery state, or operator retry
control in this view. Missing game history returns zero counts, not a delivery claim.
CI verifies actual emulator-issued tokens, enqueue/deduplication, persistent rate
limits, changed roles and disabled accounts. It does not prove production token
verification or hosted endpoint operation. The SDK behavior follows
[Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
and [revocation checking](https://firebase.google.com/docs/auth/admin/manage-sessions).

The one-shot runner `node scripts/send-notifications.mjs --send` now drains up to
25 due jobs with a 60-second admission budget. It requires server-side
`RESEND_API_KEY`, `RECSEASON_MAIL_FROM`, and application-default credentials.
Do not enable it until the remaining production gates below are complete.
It refuses emulator targets and missing explicit send intent. Output contains only
aggregate status counts, never recipients, message bodies, keys, or raw errors.
No runner has been invoked against production. It is not a deployed scheduler.

`store.due` reads at most three times the requested limit (maximum 100 per status),
selecting pending, due retries, and expired sending leases in oldest-due order.
Terminal states and active leases cannot consume the batch. The drain settles an
in-flight send before stopping admission at its deadline; this is not a hard runtime
timeout. Storage failures stop the batch, and concurrent drains use the same atomic
claim protocol. Deploy the two indexes in `firestore.indexes.json` to the named
database and wait for readiness before enabling a runner. Emulator query tests do
not prove production index readiness. Provider rate limits are handled by the
existing per-job backoff; deployment still needs an appropriate scheduler cadence.

1. Configure the Resend account, verified sender domain, and server-side sending key.
2. Deploy the tested durable store and reminder service with a least-privilege server
   identity and the tested authenticated enqueue endpoint. The internal service's
   `verifiedUid` is derived from server-verified authentication, never a request body.
3. Connect reminder requests to the app and derive invitation, reschedule, and
   cancellation events from committed changes. Add their eligibility checks and
   notice-specific preference policy.
4. Connect the tested provider adapter to a bounded scheduled worker, delivery webhooks,
   and operator reconciliation for uncertain outcomes. Never report acceptance as delivery.
5. Verify controlled inbox delivery, recipient privacy, duplicate suppression, worker
   restarts, preference changes, expired invitations, cancellations, and timezones.

No provider account, recurring job, or production queue has been created by this work.

## Storage Verification

Run `npm run test:notifications` with Java 21 available. The test refuses non-local
emulator targets and production project IDs, and never calls an email provider.
CI runs it before deployment. Runtime construction accepts only `bosse-testing` when
no emulator is configured, or `demo-recseason` on `127.0.0.1:8180` for tests. All queue
documents are in `notificationJobs` within `recseason`; no default database is used.
Production authentication uses the Google server client's application-default
credentials, which must be configured by the eventual server runtime, not embedded
in the app. See the [server client setup](https://firebase.google.com/docs/firestore/quickstart-server).
New encrypted app backups include `notificationJobs` and `notificationLimits`.
The recovery rehearsal preserves all seven states, event IDs, recipients, messages,
provenance, receipts, revision counters, leases, attempts, and next-attempt times.
Accepted/uncertain states are never reset to pending. Older eleven/twelve-collection
backups remain readable, but contain no queue coverage. Current snapshots still have
a 500-document limit across all collections; exports fail explicitly above that size.

### Notification Recovery Gate

1. Stop the enqueue endpoint and all sending workers before a production recovery.
2. Restore the authenticated encrypted snapshot into the local `recovery` database
   and verify every document. The notification store rejects this database, so no
   restored job can be sent from the recovery rehearsal.
3. Reconcile jobs with provider receipts and activity since the snapshot's read time.
   Even a backed-up pending/retry job may have been accepted after that snapshot.
   The snapshot alone cannot prove that resending is safe. Preserve accepted and
   needs-review states; treat unmatched or uncertain outcomes as review-required.
4. Verify current recipient preferences, roles, game state, and expired invitations
   before resuming any eligible work. Do not restore old authorization state and
   immediately resume delivery without a separate account/access review.
5. Obtain operator approval for a production restore and controlled inbox test before
   restarting the sender. No production queue restore or reconciliation tool exists
   yet; the local rehearsal is not proof of a complete production recovery procedure.

The reminder service supports at most 1,000 scanned user profiles and 1,000 players
on the participating teams, failing explicitly above those bounds. Jobs allow at most
200 recipients per enqueue. Each send rechecks current data; larger leagues need a
more selective recipient index and capacity testing. One event is identified by its
game and message snapshot, so repeated requests for that same snapshot deduplicate.
Recurring reminder cadence is not implemented. The existing reminder preference is
honored, including address-level opt-outs shared across profiles. Invitation and
reschedule jobs are still rejected by this eligibility checker.

## Cancellation Notices

`POST /api/game-cancellations` and `POST /api/game-cancellations/status` accept only
`{ "gameId": "..." }`, with the same verified bearer-token, organizer-role, origin,
body-size and shared per-user rate limits as reminder requests. Enqueue returns only
aggregate counts; status filters cancellation jobs and never returns addresses.

The server requires a currently cancelled game and derives its recipients and message
from current league data. It honors the existing `emailReminders` opt-out. Cancellation
event identity includes the game's Firestore update timestamp, so a duplicate request
for the same version deduplicates while cancellation after restoration is a new event.
Any intervening game write invalidates an older queued cancellation. The worker also
rechecks organizer access, roster links and opt-outs immediately before sending.

Durable storage and authenticated HTTP tests cover these paths using synthetic messages
and provider responses. Cancellation UI controls, automatic triggers, production endpoint
deployment and controlled-inbox verification remain outstanding. No real mail is enabled.

## Resend Adapter

`resendTransport({ apiKey, sender })` accepts a server-held sending key and one bare
sender email address on a verified domain. It makes no network request until `send`
is called. Nothing reads a key from browser state, and no key has been configured.
Requests use the fixed HTTPS `/emails` endpoint, reject redirects, contain one `to`
recipient, and time out after 15 seconds. Header injection and oversized messages
are rejected before the request. Provider error text is not logged or persisted.

The adapter follows the [send API](https://resend.com/docs/api-reference/emails/send-email),
[error responses](https://resend.com/docs/api-reference/errors), and
[idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys).
Rate-limit rejection honors `Retry-After` without extending job expiry. Authentication
and validation failures are permanent for the current job. Timeouts, idempotency
conflicts, server failures, and malformed successes are treated as uncertain. Provider
acceptance stores a receipt, not a claim of inbox delivery. Operator reconciliation
and actual controlled-inbox verification remain required before enabling live mail.
