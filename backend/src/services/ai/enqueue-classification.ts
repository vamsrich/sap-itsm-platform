// Debounced enqueue for AI classification.
//
// jobId = `${recordId}:${ticketVersion}` already auto-dedupes IDENTICAL
// (recordId, ticketVersion) pairs at the BullMQ layer. But each ticket
// edit advances `updatedAt`, producing a fresh ticketVersion → fresh
// jobId → fresh job. Without a separate debounce, rapid-fire edits
// would each fire their own classification.
//
// This in-memory Map suppresses re-enqueues within DEBOUNCE_MS per
// recordId. Single-instance only — fine for current Railway dyno.
// If we scale horizontally, replace with a Redis SETEX.

import { aiClassificationQueue } from '../../workers/queues';
import { logger } from '../../config/logger';

const DEBOUNCE_MS = 30_000;
const lastEnqueued = new Map<string, number>();

export function enqueueAIClassification(recordId: string, ticketVersion: number): void {
  const now = Date.now();
  const last = lastEnqueued.get(recordId);
  if (last !== undefined && now - last < DEBOUNCE_MS) {
    logger.info(`[AI] enqueue suppressed by debounce: ${recordId} (last ${now - last}ms ago)`);
    return; // suppressed by debounce window
  }
  lastEnqueued.set(recordId, now);

  // jobId uses '-' not ':' — BullMQ disallows ':' in custom IDs
  // (reserved for internal Redis key namespacing) and rejects the add silently.
  const jobId = `${recordId}-${ticketVersion}`;
  logger.info(`[AI] enqueue attempt: jobId=${jobId}`);

  // Fire-and-forget. Enqueue failures must not block the API response.
  aiClassificationQueue
    .add('classify', { recordId, ticketVersion }, { jobId })
    .then((job) => {
      logger.info(`[AI] enqueue succeeded: jobId=${jobId} bullJobId=${job.id}`);
    })
    .catch((err) => {
      logger.error(`[AI] enqueue FAILED: jobId=${jobId} err=${err?.message ?? err}`);
      // Roll back the debounce timestamp so the next attempt can retry.
      lastEnqueued.delete(recordId);
    });
}
