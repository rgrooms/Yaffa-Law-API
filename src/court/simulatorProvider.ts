/**
 * Court Filing Simulator Provider — Phase 5 (BullMQ edition)
 *
 * All async stage transitions are now enqueued as durable BullMQ jobs
 * instead of raw setTimeout calls. The worker processes them with:
 *   - Supabase audit log writes
 *   - Socket.io real-time push
 *   - Make.com lifecycle notifications
 *   - HTTP callback support
 *
 * The Legal OS calls courtFilingAdapter.ts, NOT this file directly.
 */

import type {
  CourtFilingProvider, FilingPacket, CourtPolicy, FeeQuote,
  SubmissionReceipt, FilingStatus, StampedDocument,
} from './courtFilingProvider';
import { calculateFees }                from './feeCalculator';
import { getScenario, type ErrorScenario, type AsyncStage } from './errorScenarios';
import { submissionsStore, type SubmissionRecord } from './submissionStore';
import { generateStampedDocumentSet }   from './stampedDocumentGenerator';

// ── Sequential submission ID ──────────────────────────────────────────────────
let seqCounter = 1000;
function nextSubmissionId(): string {
  const year = new Date().getFullYear();
  return `SIM-FL-${year}-${String(++seqCounter).padStart(6, '0')}`;
}

// ── Court Policies ────────────────────────────────────────────────────────────
const COURT_POLICIES: Record<string, CourtPolicy> = {
  palm_beach_circuit: {
    courtCode:        'palm_beach_circuit',
    courtName:        '15th Judicial Circuit Court — Palm Beach County',
    jurisdiction:     'Palm Beach County, Florida',
    acceptedFormats:  ['application/pdf'],
    maxDocSizeBytes:  25 * 1024 * 1024,
    allowedCaseTypes: ['personal_injury', 'medical_malpractice', 'property_damage', 'wrongful_death'],
    filingSchedule:   { timezone: 'America/New_York', open: '08:00', close: '23:59' },
    isOperational:    true,
  },
  broward_circuit: {
    courtCode:        'broward_circuit',
    courtName:        '17th Judicial Circuit Court — Broward County',
    jurisdiction:     'Broward County, Florida',
    acceptedFormats:  ['application/pdf'],
    maxDocSizeBytes:  25 * 1024 * 1024,
    allowedCaseTypes: ['personal_injury', 'medical_malpractice', 'property_damage', 'wrongful_death'],
    filingSchedule:   { timezone: 'America/New_York', open: '08:00', close: '23:59' },
    isOperational:    true,
  },
};

// ── Enqueue async stage transitions via BullMQ ────────────────────────────────
async function enqueueAsyncStages(
  submissionId: string,
  stages:       AsyncStage[],
  willStamp:    boolean
): Promise<void> {
  // Lazy import — only load when not in testMode to avoid Redis connection in tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { courtFilingQueue } = require('../queue/courtFilingQueue');
  for (const stage of stages) {
    await courtFilingQueue.add(
      'court.filing.stage',
      {
        submissionId,
        status:    stage.status,
        message:   stage.message,
        errors:    stage.errors,
        willStamp,
      },
      {
        delay: stage.delayMs,
        jobId: `${submissionId}::${stage.status}::${Date.now()}`,
      }
    );
  }
  console.log(`[Simulator] Enqueued ${stages.length} BullMQ stages for ${submissionId}`);
}

// ── SimulatorProvider ─────────────────────────────────────────────────────────
export class SimulatorProvider implements CourtFilingProvider {
  private testMode: boolean;

  constructor(options: { testMode?: boolean } = {}) {
    this.testMode = options.testMode ?? false;
  }

  async getCourtPolicy(courtCode: string): Promise<CourtPolicy> {
    const policy = COURT_POLICIES[courtCode];
    if (!policy) {
      return {
        courtCode,
        courtName:        `Unknown Court (${courtCode})`,
        jurisdiction:     'Unknown',
        acceptedFormats:  [],
        maxDocSizeBytes:  0,
        allowedCaseTypes: [],
        filingSchedule:   { timezone: 'America/New_York', open: '08:00', close: '23:59' },
        isOperational:    false,
        maintenanceNote:  `Court code "${courtCode}" is not registered in the simulator.`,
      };
    }
    return policy;
  }

  async calculateFees(packet: FilingPacket): Promise<FeeQuote> {
    return calculateFees(packet);
  }

  async submitFiling(
    packet:    FilingPacket,
    options?:  { scenario?: ErrorScenario; callbackUrl?: string }
  ): Promise<SubmissionReceipt> {
    const scenario     = options?.scenario ?? 'valid';
    const callbackUrl  = options?.callbackUrl;
    const outcome      = getScenario(scenario);
    const submissionId = nextSubmissionId();
    const receivedAt   = new Date().toISOString();

    const feeQuote = calculateFees(packet);
    const fees = {
      filingFee:  feeQuote.lineItems[0]?.amount ?? 401,
      summonsFee: feeQuote.lineItems.find(i => i.description.includes('Summons'))?.amount ?? 10,
      total:      feeQuote.total,
    };

    const record: SubmissionRecord = {
      submissionId,
      packet,
      status:    outcome.initialStatus,
      scenario,
      receivedAt,
      updatedAt:  receivedAt,
      message:    outcome.asyncStages?.[0]?.message ?? outcome.description,
      errors:     outcome.errors,
      fees,
      callbackUrl,
    };

    submissionsStore.set(submissionId, record);

    // ── Schedule async stage transitions ─────────────────────────────────────
    if (outcome.asyncStages?.length) {
      if (this.testMode) {
        // testMode: raw setTimeout — no Redis needed, fast for unit tests
        const testStages = outcome.asyncStages.map((s, i) => ({ ...s, delayMs: 50 * (i + 1) }));
        this._scheduleTestStages(submissionId, testStages, outcome.willStamp ?? false);
      } else {
        // production: durable BullMQ jobs
        await enqueueAsyncStages(submissionId, outcome.asyncStages, outcome.willStamp ?? false);
      }
    }

    return {
      submissionId,
      status:        outcome.initialStatus,
      courtCode:     packet.courtCode,
      receivedAt,
      fees,
      nextStatusUrl: `/sim/filings/${submissionId}/status`,
      referenceId:   packet.referenceId,
      errors:        outcome.errors,
    };
  }

  /**
   * Test-mode only: raw setTimeout stages that don't require Redis.
   * Only called when testMode=true. Never used in production.
   */
  private _scheduleTestStages(
    submissionId: string,
    stages:       AsyncStage[],
    willStamp:    boolean
  ): void {
    for (const stage of stages) {
      setTimeout(async () => {
        const record = submissionsStore.get(submissionId);
        if (!record) return;

        record.status    = stage.status as any;
        record.updatedAt = new Date().toISOString();
        record.message   = stage.message;
        if (stage.errors) record.errors = stage.errors;

        if ((stage.status === 'accepted' || stage.status === 'stamped') && willStamp && !record.stampedDocs) {
          try {
            const { caseNumber, documents } = await generateStampedDocumentSet(
              record.packet, submissionId, record.fees
            );
            record.stampedDocs = documents;
            record.caseNumber  = caseNumber;
          } catch {}
        }

        submissionsStore.set(submissionId, record);
      }, stage.delayMs);
    }
  }

  async getFilingStatus(submissionId: string): Promise<FilingStatus> {
    const record = submissionsStore.get(submissionId);
    if (!record) {
      return {
        submissionId,
        status:    'error',
        updatedAt: new Date().toISOString(),
        message:   `Submission ID "${submissionId}" not found in simulator.`,
        errors:    [{ code: 'SUBMISSION_NOT_FOUND', message: 'Unknown submission ID.' }],
      };
    }

    return {
      submissionId,
      status:      record.status,
      updatedAt:   record.updatedAt,
      message:     record.message,
      errors:      record.errors,
      nextCheckMs: record.status === 'under_review' ? 10000 : undefined,
    };
  }

  async getStampedDocuments(submissionId: string): Promise<StampedDocument[]> {
    const record = submissionsStore.get(submissionId);
    if (!record?.stampedDocs?.length) return [];
    return record.stampedDocs;
  }

  getSubmissionRecord(submissionId: string): SubmissionRecord | undefined {
    return submissionsStore.get(submissionId);
  }

  getAllSubmissions(): SubmissionRecord[] {
    return Array.from(submissionsStore.values()).sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const simulatorProvider = new SimulatorProvider();
