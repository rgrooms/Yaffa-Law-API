/**
 * Court Filing Queue
 *
 * Defines the BullMQ Queue and types for async court filing stage transitions.
 * The SimulatorProvider enqueues jobs here instead of using setTimeout.
 * The worker (courtFilingWorker.ts) processes them durably.
 *
 * Job types:
 *   - court.filing.stage  — advance a submission through a lifecycle stage
 */

import { Queue } from 'bullmq';
import { redisConnection } from './redis';

export interface CourtFilingStageJob {
  submissionId: string;
  status:       string;
  message?:     string;
  errors?:      { code: string; message: string; field?: string }[];
  willStamp:    boolean;
}

export const courtFilingQueue = new Queue<CourtFilingStageJob>('court-filing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts:     3,
    backoff:      { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 100 },
  },
});

console.log('[Queue] court-filing queue initialized');
