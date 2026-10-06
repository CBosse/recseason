# Notification Delivery

## Current Status

The browser still downloads email drafts only. No background sender is configured,
and no mail is sent by the new module. `server/notification-jobs.mjs` contains a
provider-independent worker protocol with synthetic transport/storage tests. It is
not copied into the public Pages build.

## Implemented Contract

- Each job contains exactly one recipient. An event kind, stable event ID, and
  normalized address determine its ID. Re-enqueueing the same event must not replace
  its message or resend an accepted job. A changed schedule requires a new event ID.
- Enqueue accepts at most 200 input recipients and a lifetime of at most 24 hours.
  Larger recipient sets require explicit upstream partitioning and capacity review.
- Storage must implement durable atomic `create(job)`, `get(id)`, and
  `compareAndSet(id, expectedVersion, nextJob)`. The test adapter is in memory and is
  not suitable for deployment. Private job bodies and addresses must not be readable
  or writable by ordinary app clients.
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
2. Implement and emulator-test a private, transactional durable store and trusted enqueue
   entry point. Authenticate organizers and derive recipients on the server.
3. Derive invitation, RSVP reminder, reschedule, and cancellation events from committed
   app changes. Implement eligibility checks and notice-specific preference policy.
4. Add an authenticated provider adapter, bounded scheduled worker, delivery webhooks,
   and operator reconciliation for uncertain outcomes. Never report acceptance as delivery.
5. Verify controlled inbox delivery, recipient privacy, duplicate suppression, worker
   restarts, preference changes, expired invitations, cancellations, and timezones.

No provider account, recurring job, or production queue has been created by this work.
