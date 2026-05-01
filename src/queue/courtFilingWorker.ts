/**
 * Court Filing Worker — Phase 6 (Socket.io /court namespace edition)
 *
 * Processes BullMQ jobs from the 'court-filing' queue.
 * Each job represents one async lifecycle stage transition.
 *
 * Phase 6 upgrades:
 *   - Emits to /court namespace instead of root io
 *   - Emits to per-submission room: filing:{submissionId}
 *   - Falls back to broadcast if client hasn't joined a room
 *   - Graceful no-op when Socket.io not injected (test environments)
 */

import { Worker, Job } from 'bullmq';
import { redisConnection } from './redis';
import type { CourtFilingStageJob } from './courtFilingQueue';
import { generateStampedDocumentSet } from '../court/stampedDocumentGenerator';
import { supabase } from '../lib/supabase';
import { submissionsStore } from '../court/submissionStore';

// ── Socket.io injection ───────────────────────────────────────────────────────
// Set by server.ts at startup. Worker emits to /court namespace.
let courtNamespace: import('socket.io').Namespace | null = null;

export function setSocketIO(io: import('socket.io').Server) {
  courtNamespace = io.of('/court');
}

function emitStatus(submissionId: string, payload: object) {
  if (!courtNamespace) return;
  const room = `filing:${submissionId}`;
  const roomSockets = courtNamespace.adapter.rooms?.get(room);

  if (roomSockets?.size) {
    // Targeted: only clients subscribed to this submission
    courtNamespace.to(room).emit('court:status', payload);
  } else {
    // Broadcast: catch clients that connected but haven't subscribed
    courtNamespace.emit('court:status', payload);
  }
}

// ── Worker ────────────────────────────────────────────────────────────────────
export const courtFilingWorker = new Worker<CourtFilingStageJob>(
  'court-filing',
  async (job: Job<CourtFilingStageJob>) => {
    const { submissionId, status, message, errors, willStamp } = job.data;

    console.log(`[Worker] Job ${job.id} → ${submissionId} [${status}]`);

    const record = submissionsStore.get(submissionId);
    if (!record) {
      console.warn(`[Worker] ${submissionId} not found — skipping job ${job.id}`);
      return;
    }

    // ── Update submission state ───────────────────────────────────────────────
    const updatedAt = new Date().toISOString();
    record.status    = status as any;
    record.updatedAt = updatedAt;
    record.message   = message;
    if (errors) record.errors = errors;

    // ── Generate stamped documents on acceptance ──────────────────────────────
    if ((status === 'accepted' || status === 'stamped') && willStamp && !record.stampedDocs) {
      try {
        console.log(`[Worker] Generating stamped documents for ${submissionId}…`);
        const { caseNumber, documents } = await generateStampedDocumentSet(
          record.packet, submissionId, record.fees
        );
        record.stampedDocs = documents;
        record.caseNumber  = caseNumber;
        console.log(`[Worker] ✓ ${documents.length} stamped docs — ${caseNumber}`);
      } catch (e) {
        console.error('[Worker] Stamped doc generation failed (non-fatal):', e);
      }
    }

    submissionsStore.set(submissionId, record);

    // ── Supabase audit event ──────────────────────────────────────────────────
    try {
      await supabase.from('system_events').insert({
        case_id:    record.packet.caseId ?? null,
        component:  'court_filing_worker',
        event_type: status === 'accepted' ? 'success'
                  : status === 'rejected'  ? 'failure'
                  : status === 'timeout'   ? 'warning'
                  : 'success',
        severity:   ['rejected', 'error', 'timeout'].includes(status) ? 'warning' : 'info',
        message:    `Court filing ${submissionId} → ${status}`,
        payload:    { submissionId, status, jobId: job.id, errors: errors ?? null },
      });
    } catch (dbErr) {
      console.error('[Worker] system_events write failed (non-fatal):', dbErr);
    }

    // ── Socket.io: emit to /court room ────────────────────────────────────────
    const statusPayload = {
      submissionId,
      status,
      updatedAt,
      message,
      errors,
      caseNumber:  record.caseNumber,
      stampedDocs: record.stampedDocs?.map(d => ({
        type: d.type, fileName: d.fileName, stampedAt: d.stampedAt,
      })),
    };

    emitStatus(submissionId, statusPayload);
    console.log(`[Worker] Socket.io → /court/filing:${submissionId} → ${status}`);

    // ── Make.com lifecycle notification ──────────────────────────────────────
    const MAKE_WEBHOOK = process.env.MAKE_COURT_WEBHOOK_URL;
    if (MAKE_WEBHOOK && ['accepted', 'rejected', 'timeout'].includes(status)) {
      fetch(MAKE_WEBHOOK, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          event:      'court_filing_status',
          submissionId,
          status,
          caseId:     record.packet.caseId,
          caseNumber: record.caseNumber,
          updatedAt,
          errors:     errors ?? null,
          filedBy:    record.packet.submittedBy?.name,
        }),
      }).catch(e => console.warn('[Worker] Make.com webhook failed (non-fatal):', e));
    }

    // ── HTTP callback ─────────────────────────────────────────────────────────
    if (record.callbackUrl) {
      fetch(record.callbackUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ submissionId, status, updatedAt, message, errors }),
      }).catch(() => {});
    }
  },
  { connection: redisConnection, concurrency: 5 }
);

courtFilingWorker.on('completed', j => console.log(`[Worker] ✓ Job ${j.id} completed`));
courtFilingWorker.on('failed',  (j, e) => console.error(`[Worker] ✗ Job ${j?.id} failed:`, e.message));
