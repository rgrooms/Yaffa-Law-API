/**
 * Error Scenario Library — Phase 3.5
 *
 * Mirrors the 15 scenarios Florida TPV certification tests:
 * functionality, standards adherence, resiliency (portal errors,
 * scheduled/unscheduled outages, preventable/non-preventable failures).
 */

import type { FilingError, FilingStatus } from './courtFilingProvider';

export type ErrorScenario =
  | 'valid'                    // 1  — happy path, accepted
  | 'missing_signature'        // 2  — lead doc missing signature
  | 'invalid_fee'              // 3  — fee mismatch
  | 'wrong_jurisdiction'       // 4  — court code not found
  | 'invalid_ucn'              // 5  — Unified Case Number malformed
  | 'missing_required_document'// 6  — no lead document
  | 'duplicate_filing'         // 7  — referenceId already submitted
  | 'document_too_large'       // 8  — PDF exceeds 25MB
  | 'scheduled_downtime'       // 9  — portal maintenance window
  | 'unscheduled_outage'       // 10 — portal 503
  | 'timeout'                  // 11 — submission accepted but status never arrives
  | 'clerk_rejection'          // 12 — accepted then rejected after clerk review
  | 'accepted_stamped'         // 13 — accepted and stamped copy returned
  | 'payment_failed'           // 14 — ACH/card declined
  | 'service_list_unavailable'; // 15 — e-service list unavailable

export interface ScenarioOutcome {
  scenario:       ErrorScenario;
  label:          string;
  description:    string;
  initialStatus:  FilingStatus['status'];
  errors?:        FilingError[];
  isOperational:  boolean;
  asyncStages?:   AsyncStage[];
  willStamp?:     boolean;
}

export interface AsyncStage {
  delayMs: number;
  status:  FilingStatus['status'];
  message: string;
  errors?: FilingError[];
}

export const SCENARIOS: Record<ErrorScenario, ScenarioOutcome> = {

  valid: {
    scenario: 'valid', label: 'Valid Filing — Accepted',
    description: 'Standard accepted filing. Proceeds through full async lifecycle and returns stamped copy.',
    initialStatus: 'received', isOperational: true, willStamp: true,
    asyncStages: [
      { delayMs: 8000,  status: 'under_review', message: 'Filing received by clerk. Under review.' },
      { delayMs: 20000, status: 'accepted',     message: 'Filing accepted. Case assigned. Stamped documents available.' },
    ],
  },

  missing_signature: {
    scenario: 'missing_signature', label: 'Missing Signature — Rejected',
    description: 'Lead document is missing the required /s/ attorney signature block.',
    initialStatus: 'received', isOperational: true,
    errors: [
      { code: 'MISSING_SIGNATURE', message: 'Lead document is missing required attorney signature block (/s/ format).', field: 'documents[0].signature' },
    ],
    asyncStages: [
      { delayMs: 8000,  status: 'under_review', message: 'Reviewing filing documents.' },
      { delayMs: 18000, status: 'rejected', message: 'Rejected: Missing signature.',
        errors: [{ code: 'MISSING_SIGNATURE', message: 'Lead document is missing required attorney signature block.' }] },
    ],
  },

  invalid_fee: {
    scenario: 'invalid_fee', label: 'Invalid Fee Calculation — Rejected',
    description: 'Submitted fee total does not match the court\'s required filing fee schedule.',
    initialStatus: 'rejected', isOperational: true,
    errors: [
      { code: 'INVALID_FEE', message: 'Calculated fee $350 does not match required filing fee $401.00.', field: 'fees.total' },
      { code: 'FEE_SCHEDULE_MISMATCH', message: 'Personal injury new case fee is $401.00 per Florida court fee schedule.' },
    ],
  },

  wrong_jurisdiction: {
    scenario: 'wrong_jurisdiction', label: 'Wrong Court / Jurisdiction — Rejected',
    description: 'Court code is not recognized or incident occurred outside this court\'s jurisdiction.',
    initialStatus: 'rejected', isOperational: true,
    errors: [
      { code: 'INVALID_COURT_CODE', message: 'Court code "miami_dade_circuit" is not registered for e-filing.', field: 'courtCode' },
      { code: 'JURISDICTION_MISMATCH', message: 'Incident location does not fall within the 15th Judicial Circuit.' },
    ],
  },

  invalid_ucn: {
    scenario: 'invalid_ucn', label: 'Invalid UCN — Rejected',
    description: 'Unified Case Number format does not conform to Florida standard: YYYY-CA-XXXXXXX-XXXX-XX.',
    initialStatus: 'rejected', isOperational: true,
    errors: [
      { code: 'INVALID_UCN_FORMAT', message: 'UCN "2026-001" does not match required Florida UCN format (e.g., 2026-CA-001234-XXXX-MB).', field: 'caseNumber' },
    ],
  },

  missing_required_document: {
    scenario: 'missing_required_document', label: 'Missing Required Document — Rejected',
    description: 'New case filing requires a lead document (complaint) and civil cover sheet.',
    initialStatus: 'rejected', isOperational: true,
    errors: [
      { code: 'MISSING_LEAD_DOCUMENT', message: 'New case filing requires a lead document of type "complaint".', field: 'documents' },
      { code: 'MISSING_CIVIL_COVER_SHEET', message: 'Civil cover sheet (form 1.997) is required for all new civil cases.', field: 'documents' },
    ],
  },

  duplicate_filing: {
    scenario: 'duplicate_filing', label: 'Duplicate Filing — Warning',
    description: 'A filing with this referenceId was already submitted within 24 hours.',
    initialStatus: 'duplicate', isOperational: true,
    errors: [
      { code: 'DUPLICATE_SUBMISSION', message: 'A filing with referenceId "YAFFA-2026-001" was already submitted at 2026-04-30T10:15:00Z.', field: 'referenceId' },
    ],
  },

  document_too_large: {
    scenario: 'document_too_large', label: 'Document Too Large — Rejected',
    description: 'Document exceeds the 25MB portal limit per document.',
    initialStatus: 'rejected', isOperational: true,
    errors: [
      { code: 'DOCUMENT_TOO_LARGE', message: 'complaint.pdf (31.2 MB) exceeds the 25 MB per-document limit.', field: 'documents[0].sizeBytes' },
    ],
  },

  scheduled_downtime: {
    scenario: 'scheduled_downtime', label: 'Scheduled Maintenance Window',
    description: 'Portal is in a scheduled maintenance window (Saturday 10PM – Sunday 4AM EST).',
    initialStatus: 'error', isOperational: false,
    errors: [
      { code: 'PORTAL_MAINTENANCE', message: 'Florida Courts E-Filing Portal is in scheduled maintenance. Window: Saturday 10:00 PM – Sunday 4:00 AM EST.' },
    ],
  },

  unscheduled_outage: {
    scenario: 'unscheduled_outage', label: 'Unscheduled Portal Outage',
    description: 'Portal returned 503 Service Unavailable. This is a non-preventable failure.',
    initialStatus: 'error', isOperational: false,
    errors: [
      { code: 'PORTAL_UNAVAILABLE', message: 'Florida Courts E-Filing Portal returned HTTP 503. Incident logged. Retry recommended.' },
    ],
  },

  timeout: {
    scenario: 'timeout', label: 'Submission Timeout',
    description: 'Submission was received but status callback never arrived. System timed out at 5 minutes.',
    initialStatus: 'received', isOperational: true,
    asyncStages: [
      { delayMs: 8000,  status: 'under_review', message: 'Filing under review...' },
      { delayMs: 30000, status: 'timeout',       message: 'Status callback not received after 5 minutes. Manual follow-up required.' },
    ],
  },

  clerk_rejection: {
    scenario: 'clerk_rejection', label: 'Clerk Review Rejection',
    description: 'Accepted by system, then rejected by clerk after manual document review.',
    initialStatus: 'received', isOperational: true,
    asyncStages: [
      { delayMs: 8000,  status: 'under_review', message: 'Accepted by system. Assigned to clerk for review.' },
      { delayMs: 20000, status: 'accepted',     message: 'System acceptance confirmed. Pending clerk review.' },
      { delayMs: 32000, status: 'rejected',     message: 'Rejected by clerk: Party name in complaint does not match registration.',
        errors: [{ code: 'CLERK_NAME_MISMATCH', message: 'Defendant name "Atlantic Logistics Corp" does not match registered entity "Atlantic Logistics Corporation of Florida, Inc."' }] },
    ],
  },

  accepted_stamped: {
    scenario: 'accepted_stamped', label: 'Accepted + Stamped Copy Returned',
    description: 'Full lifecycle: received → under review → accepted → stamped documents returned.',
    initialStatus: 'received', isOperational: true, willStamp: true,
    asyncStages: [
      { delayMs: 6000,  status: 'under_review', message: 'Clerk reviewing filing.' },
      { delayMs: 15000, status: 'accepted',     message: 'Filing accepted. Case No. 2026-CA-003941-XXXX-MB assigned.' },
      { delayMs: 18000, status: 'stamped',      message: 'Clerk-stamped documents are ready for download.' },
    ],
  },

  payment_failed: {
    scenario: 'payment_failed', label: 'Payment Failed',
    description: 'ACH payment was declined. Filing is held pending payment resolution.',
    initialStatus: 'rejected', isOperational: true,
    errors: [
      { code: 'PAYMENT_DECLINED', message: 'ACH payment of $401.00 was declined by financial institution. Filing is on hold.', field: 'payment' },
      { code: 'PAYMENT_ACTION_REQUIRED', message: 'Update payment method at MyFLCourtAccess.com within 48 hours or filing will be voided.' },
    ],
  },

  service_list_unavailable: {
    scenario: 'service_list_unavailable', label: 'E-Service List Unavailable',
    description: 'Filing accepted but e-service to opposing counsel failed. Service list is temporarily unavailable.',
    initialStatus: 'received', isOperational: true,
    asyncStages: [
      { delayMs: 8000,  status: 'accepted', message: 'Filing accepted. Case No. assigned.' },
    ],
    errors: [
      { code: 'ESERVICE_LIST_UNAVAILABLE', message: 'E-service to registered parties failed. Service list unavailable. Manual service required.', field: 'serviceList' },
    ],
  },
};

export function getScenario(name: ErrorScenario): ScenarioOutcome {
  return SCENARIOS[name] ?? SCENARIOS.valid;
}

export const ALL_SCENARIO_NAMES = Object.keys(SCENARIOS) as ErrorScenario[];
