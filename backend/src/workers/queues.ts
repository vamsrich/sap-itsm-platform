import { Queue } from 'bullmq';
import { bullConnection } from '../config/redis';

const connection = bullConnection;

export const emailQueue = new Queue('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const slaQueue = new Queue('sla', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 500 },
  },
});

export const escalationQueue = new Queue('escalation', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 200 },
  },
});

export const contractRenewalQueue = new Queue('contract-renewal', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
  },
});

// AI classification queue — Phase A of architecture v2.
// Each ticket create/update enqueues a job with stable jobId so identical
// (recordId + ticketVersion) pairs auto-deduplicate at the BullMQ layer.
export const aiClassificationQueue = new Queue('ai-classification', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});
