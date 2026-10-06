import { createHash, randomUUID } from 'node:crypto';

const kinds = new Set(['invitation', 'rsvp-reminder', 'reschedule', 'cancellation']);
const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 120000;
const DAY_MS = 86400000;

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid notification timestamp.');
  return value;
}

export function notificationJobs({ kind, eventId, recipients, subject, body, expiresAt }, now) {
  timestamp(now); timestamp(expiresAt);
  if (!kinds.has(kind) || typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200) throw new Error('Invalid notification event.');
  if (!Array.isArray(recipients) || !recipients.length || recipients.length > 200) throw new Error('Notifications require 1-200 recipients.');
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) throw new Error('Invalid notification subject.');
  if (typeof body !== 'string' || !body.trim() || body.length > 20000) throw new Error('Invalid notification body.');
  if (expiresAt <= now || expiresAt - now > DAY_MS) throw new Error('Notification lifetime must be between zero and 24 hours.');
  const addresses = recipients.map(value => {
    if (typeof value !== 'string') throw new Error('Invalid notification recipient.');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !emailPattern.test(email)) throw new Error('Invalid notification recipient.');
    return email;
  });
  return [...new Set(addresses)].sort().map(recipient => ({
    id: createHash('sha256').update(JSON.stringify([kind, eventId, recipient])).digest('hex'),
    kind, eventId, recipient, subject, body, createdAt: now, expiresAt,
    status: 'pending', version: 0, attempts: 0, nextAttemptAt: now,
    leaseToken: null, leaseUntil: null, outcome: null, providerReceipt: null,
  }));
}

// The store must implement durable atomic create and compare-and-set operations.
// Existing IDs are immutable events: enqueueing the same event never replaces it.
export async function enqueueNotifications(store, jobs) {
  let created = 0;
  for (const job of jobs) if (await store.create(job)) created++;
  return { created, existing: jobs.length - created };
}

function transition(job, patch) {
  return { ...job, ...patch, version: job.version + 1 };
}

export async function executeNotification({ store, transport, isEligible, clock = Date.now }, id) {
  const job = await store.get(id);
  if (!job) return { status: 'missing' };
  const now = timestamp(clock());
  if (job.status === 'sending') {
    if (job.leaseUntil > now) return { status: 'busy' };
    const review = transition(job, { status: 'needs-review', outcome: 'lease-expired', leaseToken: null, leaseUntil: null });
    return { status: await store.compareAndSet(id, job.version, review) ? 'needs-review' : 'busy' };
  }
  if (!['pending', 'retry'].includes(job.status)) return { status: job.status };
  if (job.expiresAt <= now || job.attempts >= MAX_ATTEMPTS) {
    const failed = transition(job, { status: 'failed', outcome: job.expiresAt <= now ? 'expired' : 'attempt-limit' });
    return { status: await store.compareAndSet(id, job.version, failed) ? 'failed' : 'busy' };
  }
  if (job.nextAttemptAt > now) return { status: 'deferred' };
  const claimed = transition(job, { status: 'sending', attempts: job.attempts + 1, leaseToken: randomUUID(), leaseUntil: now + LEASE_MS });
  if (!await store.compareAndSet(id, job.version, claimed)) return { status: 'busy' };
  const settle = async patch => {
    const next = transition(claimed, { leaseToken: null, leaseUntil: null, ...patch });
    return { status: await store.compareAndSet(id, claimed.version, next) ? next.status : 'superseded' };
  };
  const retry = async outcome => {
    const nextAttemptAt = timestamp(clock()) + Math.min(3600000, 60000 * 2 ** (claimed.attempts - 1));
    return settle(claimed.attempts >= MAX_ATTEMPTS || nextAttemptAt >= job.expiresAt
      ? { status: 'failed', outcome }
      : { status: 'retry', outcome, nextAttemptAt });
  };
  let eligible;
  try { eligible = await isEligible(job); }
  catch { return retry('eligibility-unavailable'); }
  if (eligible !== true) return settle({ status: 'suppressed', outcome: 'ineligible' });
  // Eligibility may require network reads. Never send after the claim or notice expires.
  const sendAt = timestamp(clock());
  if (sendAt >= claimed.leaseUntil || sendAt >= job.expiresAt) return settle({ status: 'failed', outcome: 'expired-before-send' });
  let result;
  try {
    result = await transport.send({ to: job.recipient, subject: job.subject, text: job.body, idempotencyKey: job.id });
  } catch {
    return settle({ status: 'needs-review', outcome: 'delivery-unknown' });
  }
  if (result?.accepted === true && typeof result.receipt === 'string' && result.receipt.length > 0 && result.receipt.length <= 500) {
    return settle({ status: 'accepted', outcome: 'provider-accepted', providerReceipt: result.receipt });
  }
  if (result?.accepted === false && result.retryable === true) return retry('provider-retryable-rejection');
  if (result?.accepted === false && result.retryable === false) return settle({ status: 'failed', outcome: 'provider-permanent-rejection' });
  return settle({ status: 'needs-review', outcome: 'delivery-unknown' });
}
