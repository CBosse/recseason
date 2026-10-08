export const notificationStates = ['pending', 'retry', 'sending', 'accepted', 'suppressed', 'failed', 'needs-review'];

export function summarizeNotifications(jobs) {
  if (!Array.isArray(jobs) || jobs.length > 1000) throw new Error('Notification history exceeds the supported limit.');
  const counts = Object.fromEntries(notificationStates.map(status => [status, 0]));
  for (const job of jobs) {
    if (!notificationStates.includes(job.status)) throw new Error('Unknown notification state.');
    counts[job.status]++;
  }
  return { total: jobs.length, counts };
}

export function validateNotificationSummary(value) {
  if (!value || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 1000 || !value.counts ||
    !notificationStates.every(status => Number.isSafeInteger(value.counts[status]) && value.counts[status] >= 0) ||
    notificationStates.reduce((sum, status) => sum + value.counts[status], 0) !== value.total) throw new Error('Invalid notification summary.');
  return { total: value.total, counts: Object.fromEntries(notificationStates.map(status => [status, value.counts[status]])) };
}
