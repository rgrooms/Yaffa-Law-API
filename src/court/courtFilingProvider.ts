/**
 * Court Filing Adapter — Stable interface
 *
 * The Legal OS ALWAYS calls this interface.
 * The concrete provider (simulator | florida_tpv) is injected at runtime via COURT_PROVIDER env var.
 * Swapping providers requires zero changes to business logic.
 */

// ── Core domain types ─────────────────────────────────────────────────────────

export interface FilingParty {
  role:       'plaintiff' | 'defendant' | 'respondent' | 'petitioner' | 'intervenor';
  name:       string;
  address?:   string;
  barNumber?: string;     // for attorneys
  entityType?: 'individual' | 'corporation' | 'llc' | 'government';
}

export interface FilingDocument {
  documentId: string;
  type:       'complaint' | 'summons' | 'cover_sheet' | 'medical_summary' | 'email_draft' | 'motion' | 'answer';
  fileName:   string;
  sha256:     string;
  base64:     string;       // PDF content
  sizeBytes?: number;
  isLead?:    boolean;      // Lead document must come first
}

export interface FilingPacket {
  caseId:       string;
  courtCode:    string;     // e.g. 'palm_beach_circuit'
  filingType:   'new_case' | 'subsequent' | 'cross_claim' | 'counterclaim';
  caseType:     'personal_injury' | 'medical_malpractice' | 'property_damage' | 'wrongful_death';
  parties:      FilingParty[];
  documents:    FilingDocument[];
  submittedBy:  { name: string; barNumber: string };
  referenceId?: string;     // Your internal reference to avoid duplicates
}

// ── Response types ────────────────────────────────────────────────────────────

export interface CourtPolicy {
  courtCode:       string;
  courtName:       string;
  jurisdiction:    string;
  acceptedFormats: string[];
  maxDocSizeBytes: number;
  allowedCaseTypes: string[];
  filingSchedule:  { timezone: string; open: string; close: string; };
  isOperational:   boolean;
  maintenanceNote?: string;
}

export interface FeeLineItem {
  description: string;
  amount:      number;
}

export interface FeeQuote {
  courtCode:    string;
  filingType:   string;
  caseType:     string;
  lineItems:    FeeLineItem[];
  total:        number;
  currency:     'USD';
  quotedAt:     string;
  validUntilMs: number;
}

export interface SubmissionReceipt {
  submissionId:  string;
  status:        FilingStatus['status'];
  courtCode:     string;
  receivedAt:    string;
  fees:          { filingFee: number; summonsFee: number; total: number; };
  nextStatusUrl: string;
  referenceId?:  string;
  errors?:       FilingError[];
}

export interface FilingStatus {
  submissionId: string;
  status:       'received' | 'under_review' | 'accepted' | 'rejected' | 'stamped' | 'error' | 'timeout' | 'duplicate';
  updatedAt:    string;
  message?:     string;
  errors?:      FilingError[];
  nextCheckMs?: number;     // recommended polling interval
}

export interface FilingError {
  code:     string;
  message:  string;
  field?:   string;
}

export interface StampedDocument {
  documentId:    string;
  type:          'stamped_complaint' | 'confirmation_receipt' | 'submission_xml';
  fileName:      string;
  url?:          string;
  base64?:       string;
  stampedAt:     string;
  caseNumber?:   string;   // court-assigned
  division?:     string;
}

// ── The stable interface ──────────────────────────────────────────────────────

export interface CourtFilingProvider {
  getCourtPolicy(courtCode: string): Promise<CourtPolicy>;
  calculateFees(packet: FilingPacket): Promise<FeeQuote>;
  submitFiling(packet: FilingPacket): Promise<SubmissionReceipt>;
  getFilingStatus(submissionId: string): Promise<FilingStatus>;
  getStampedDocuments(submissionId: string): Promise<StampedDocument[]>;
}
