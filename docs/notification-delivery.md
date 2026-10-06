# Notification Delivery

## Current Status

The browser still downloads email drafts only. No background sender is configured,
and no mail is sent by the new module. `server/notification-jobs.mjs` contains a
provider-independent worker protocol. `server/notification-store.mjs` supplies a
durable transactional Firestore store fixed to the named `recseason` database.
Its emulator test uses independent clients to verify concurrent claims and persisted
results. Neither server module is copied into the public Pages build.

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
  Provider idempotency support would strengthen recovery, but is not assumed.
- `accepted` means the provider accepted the request, not that an inbox received it.
  Delivery/bounce webhooks, receipt reconciliation, operator review, and audit UI remain
  to be implemented. The module records only bounded outcome codes, not raw exceptions.

## Remaining Integration

1. Select the sending provider and verified domain; configure server-side credentials.
2. Deploy the tested durable store with a least-privilege server identity and a trusted
   enqueue entry point. Authenticate organizers and derive recipients on the server.
3. Derive invitation, RSVP reminder, reschedule, and cancellation events from committed
   app changes. Implement eligibility checks and notice-specific preference policy.
4. Add an authenticated provider adapter, bounded scheduled worker, delivery webhooks,
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
