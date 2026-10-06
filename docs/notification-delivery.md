# Notification Delivery

## Current Status

The browser still downloads email drafts only. No background sender is configured,
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

1. Configure the Resend account, verified sender domain, and server-side sending key.
2. Deploy the tested durable store and reminder service with a least-privilege server
   identity and an authenticated enqueue endpoint. The internal service's `verifiedUid`
   must come from server-verified authentication, never from a request body.
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
The current app backup format does not yet include this collection; add and rehearse
queue recovery before enabling production sends. Accepted/uncertain states must not
be reset to pending during restoration.

The reminder service supports at most 1,000 scanned user profiles and 1,000 players
on the participating teams, failing explicitly above those bounds. Jobs allow at most
200 recipients per enqueue. Each send rechecks current data; larger leagues need a
more selective recipient index and capacity testing. One event is identified by its
game and message snapshot, so repeated requests for that same snapshot deduplicate.
Recurring reminder cadence is not implemented. The existing reminder preference is
honored, including address-level opt-outs shared across profiles. Other notice types
are rejected by this eligibility checker until their own policies are implemented.

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
