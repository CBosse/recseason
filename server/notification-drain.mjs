import { executeNotification } from './notification-jobs.mjs';

// Admit bounded work; an already claimed send must settle rather than be abandoned
// at the batch deadline. The transport supplies its own request timeout.
export async function drainNotifications(worker, { limit = 25, budgetMs = 60000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 300000) throw new Error('Invalid notification batch bounds.');
  const clock = worker.clock ?? Date.now;
  const started = clock();
  const ids = await worker.store.due(started, limit);
  if (!Array.isArray(ids) || ids.length > limit || new Set(ids).size !== ids.length) throw new Error('Invalid notification batch selection.');
  const outcomes = {};
  let processed = 0;
  for (const id of ids) {
    if (clock() - started >= budgetMs) break;
    // Storage errors stop the batch. A later run reconciles any expired lease;
    // never interpret an unknown persistence outcome as permission to resend.
    const { status } = await executeNotification(worker, id);
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    processed++;
  }
  return { selected: ids.length, processed, remaining: ids.length - processed, outcomes };
}
