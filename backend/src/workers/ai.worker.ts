// AI classification worker — Phase A-1.
// Consumes jobs from the 'ai-classification' queue, calls the per-tenant
// LLMClient.classify() (A-1: stub returns hardcoded JSON), and writes
// the result back to ITSMRecord.aiClassification.
//
// Reliability features (architecture v2 §3 "Job handling"):
//  - jobId = `${recordId}-${ticketVersion}` → BullMQ auto-dedupes identical
//    (recordId, ticketVersion) pairs (idempotency). '-' separator, not ':',
//    because BullMQ rejects ':' in custom IDs (reserved for Redis key namespacing).
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
  logger.info(`[AI] processJob ENTER recordId=${recordId} ticketVersion=${data.ticketVersion}`);

  const record = await prisma.iTSMRecord.findUnique({
    where: { id: recordId },
    include: { tenant: { select: { id: true, sapEdition: true } } },
  });
  if (!record) {
    logger.warn(`[AI] processJob: record ${recordId} not found, skipping`);
    return;
  }
  logger.info(`[AI] processJob loaded record ${record.recordNumber}`);

  const client = await getLLMClient(record.tenantId);
  logger.info(`[AI] processJob got LLM client for tenant ${record.tenantId}`);

  const input: ClassificationInput = {
    ticketId: record.id,
    title: record.title,
    description: record.description,
    recordType: record.recordType,
    priority: record.priority,
    systemId: record.systemId,
    moduleId: record.moduleId,
    sapEdition: record.tenant?.sapEdition ?? null,
  };
  logger.info(`[AI] processJob systemId=${record.systemId ?? 'null'} moduleId=${record.moduleId ?? 'null'}`);

  const result = await withTimeout(client.classify(input), HARD_TIMEOUT_MS, 'classify');
  logger.info(`[AI] processJob classify returned classifierVersion=${result.classifierVersion}`);

  await prisma.iTSMRecord.update({
    where: { id: recordId },
    data: {
      aiClassification: result as object,
      aiClassifiedAt: new Date(),
      aiVersion: result.classifierVersion,
    },
  });
  logger.info(`[AI] processJob EXIT — wrote aiClassification for ${record.recordNumber}`);
}

export function startAIWorker(): void {
  logger.info('[AI] startAIWorker invoked, creating BullMQ worker...');
  const worker = new Worker(
    'ai-classification',
    async (job) => {
      logger.info(`[AI] worker received job ${job.id}`);
      await processJob(job.data as AIClassificationJobData);
    },
    {
      connection: bullConnection,
      concurrency: 2,
    },
  );

  worker.on('ready', () => {
    logger.info('[AI] worker is ready and listening for jobs');
  });

  worker.on('completed', (job) => {
    logger.info(`[AI] job ${job.id} completed successfully`);
  });

  worker.on('failed', async (job, err) => {
    logger.error(`[AI] job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${err?.message}`);
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
