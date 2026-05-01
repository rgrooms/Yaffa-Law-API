/**
 * Submission Store
 *
 * Shared in-memory store for court filing submissions.
 * Used by both SimulatorProvider and the BullMQ worker.
 *
 * Phase 5 note: Replace with Supabase `jobs` table queries once
 * the BullMQ → Supabase persistence layer is wired.
 * For now, this ensures the Map is a true singleton shared across
 * all imports (not duplicated per-module in CommonJS).
 */

import type { FilingPacket, FilingStatus, StampedDocument } from './courtFilingProvider';
import type { ErrorScenario } from './errorScenarios';

export interface SubmissionRecord {
  submissionId: string;
  packet:       FilingPacket;
  status:       FilingStatus['status'];
  scenario:     ErrorScenario;
  receivedAt:   string;
  updatedAt:    string;
  message?:     string;
  errors?:      { code: string; message: string; field?: string }[];
  fees:         { filingFee: number; summonsFee: number; total: number };
  stampedDocs?: StampedDocument[];
  caseNumber?:  string;
  callbackUrl?: string;
}

export const submissionsStore = new Map<string, SubmissionRecord>();
