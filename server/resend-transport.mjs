import { notificationEmail } from './notification-jobs.mjs';

function retryDelay(value, now) {
  if (!value) return 0;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.min(86400000, Math.max(0, Math.ceil(delay))) : 0;
}

export function resendTransport({ apiKey, sender, fetcher = fetch, clock = Date.now, timeoutMs = 15000 }) {
  if (typeof apiKey !== 'string' || !/^re_[A-Za-z0-9_-]+$/.test(apiKey) || apiKey.length > 512) throw new Error('Configure a server-side Resend API key.');
  const from = notificationEmail(sender);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid provider timeout.');
  return {
    async send({ to, subject, text, idempotencyKey }) {
      const recipient = notificationEmail(to);
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject) ||
          typeof text !== 'string' || !text.trim() || text.length > 20000 || !/^[a-f0-9]{64}$/.test(idempotencyKey)) throw new Error('Invalid provider message.');
      let response;
      try {
        response = await fetcher('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ from: `RecSeason <${from}>`, to: [recipient], subject, text }),
        });
      } catch { throw new Error('Email provider outcome is unknown.'); }
      if (response.status === 429) return { accepted: false, retryable: true, retryAfterMs: retryDelay(response.headers.get('retry-after'), clock()) };
      if ([400, 401, 403, 404, 405, 422].includes(response.status)) return { accepted: false, retryable: false };
      if (response.status !== 200 && response.status !== 201) throw new Error('Email provider outcome is unknown.');
      let data;
      try { data = await response.json(); }
      catch { throw new Error('Email provider outcome is unknown.'); }
      if (typeof data?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) throw new Error('Email provider outcome is unknown.');
      return { accepted: true, receipt: data.id };
    },
  };
}
