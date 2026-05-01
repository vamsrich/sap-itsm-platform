// AI classification worker — Phase A-1.
// Consumes jobs from the 'ai-classification' queue, calls the per-tenant
// LLMClient.classify() (A-1: stub returns hardcoded JSON), and writes
// the result back to ITSMRecord.aiClassification.
//
// Reliability features (architecture v2 §3 "Job handling"):
//  - jobId = `${recordId}:${ticketVersion}` → BullMQ auto-dedupes identical
//    (recordId, ticketVersion) pairs (idempotency)
//  - 3 attempts with exponential backoff (queue defaults in queues.ts)
//  - Hard 30s timeout per LLM call (Promise.race below)
//  - On final failure, write { error } to aiClassification so the agent
//    sees an "AI unavailable" indicator rather than a silent gap
//
// TODO (Phase A productionization): in production this should run as a
// separate Railway service. For A-1 it runs in the same process as the
// API for simplicity. See server.ts startup.

import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { getLLMClient } from '../services/ai/llm-factory';
import type { ClassificationInput } from '../services/ai/llm-client';

const HARD_TIMEOUT_MS = 30_000;

export interface AIClassificationJobData {
  recordId: string;
  ticketVersion: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        to = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}

async function processJob(data: AIClassificationJobData): Promise<void> {
  const { recordId } = data;

  const record = await prisma.iTSMRecord.findUnique({
    where: { id: recordId },
    include: { tenant: { select: { id: true, sapEdition: true } } },
  });
  if (!record) {
    logger.warn(`ai-classification: record ${recordId} not found, skipping`);
    return;
  }

  const client = await getLLMClient(record.tenantId);
  const input: ClassificationInput = {
    ticketId: record.id,
    title: record.title,
    description: record.description,
    recordType: record.recordType,
    priority: record.priority,
    sapModuleId: record.sapModuleId,
    sapEdition: record.tenant?.sapEdition ?? null,
  };

  const result = await withTimeout(client.classify(input), HARD_TIMEOUT_MS, 'classify');

  await prisma.iTSMRecord.update({
    where: { id: recordId },
    data: {
      aiClassification: result as object,
      aiClassifiedAt: new Date(),
      aiVersion: result.classifierVersion,
    },
  });
}

export function startAIWorker(): void {
  const worker = new Worker(
    'ai-classification',
    async (job) => {
      await processJob(job.data as AIClassificationJobData);
    },
    {
      connection: bullConnection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug(`ai-classification job ${job.id} completed`);
  });

  worker.on('failed', async (job, err) => {
    logger.error(`ai-classification job ${job?.id} failed:`, err);
    // After all retries exhausted, mark the record so the UI can show
    // "AI unavailable" instead of pending forever.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const data = job.data as AIClassificationJobData;
      try {
        await prisma.iTSMRecord.update({
          where: { id: data.recordId },
          data: {
            aiClassification: { error: err.message } as object,
            aiClassifiedAt: new Date(),
            aiVersion: 'error',
          },
        });
      } catch (writeErr) {
        logger.error(`ai-classification: failed to persist error state:`, writeErr);
      }
    }
  });

  logger.info('✅ AI classification worker started');
}
