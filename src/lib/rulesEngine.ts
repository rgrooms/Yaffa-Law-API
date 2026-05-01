/**
 * Rules Engine — Phase 3
 *
 * Evaluates a case against a full set of legal risk rules and produces:
 *  - A prioritized list of risk flags (critical / high / medium / low)
 *  - A Case Health Score (0–100)
 *  - An overall case readiness status
 */

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface RiskFlag {
  id:         string;
  severity:   RiskSeverity;
  category:   'sol' | 'documentation' | 'evidence' | 'filing' | 'financial' | 'compliance';
  title:      string;
  detail:     string;
  action?:    string;   // Recommended next action
}

export interface CaseHealthReport {
  score:      number;       // 0–100
  grade:      'A' | 'B' | 'C' | 'D' | 'F';
  status:     'ready' | 'needs_attention' | 'blocked';
  flags:      RiskFlag[];
  summary:    string;
  breakdown:  Record<string, number>;  // category → deduction
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number | null {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function daysUntilSOL(dateStr: string, solYears = 4): number | null {
  const since = daysSince(dateStr);
  if (since === null) return null;
  const solDays = solYears * 365;
  return solDays - since;
}

// ── Rule evaluators ────────────────────────────────────────────────────────────

function solRules(caseData: Record<string, unknown>): { flags: RiskFlag[]; deduction: number } {
  const flags: RiskFlag[] = [];
  let deduction = 0;

  const dol = caseData.date_of_loss as string | undefined;
  if (!dol) {
    flags.push({
      id: 'sol_no_date', severity: 'critical', category: 'sol',
      title: 'Date of Loss Missing',
      detail: 'Cannot calculate statute of limitations without date of loss.',
      action: 'Obtain and enter the exact date of loss immediately.',
    });
    deduction += 25;
    return { flags, deduction };
  }

  const daysLeft = daysUntilSOL(dol);

  if (daysLeft === null) {
    flags.push({ id: 'sol_invalid_date', severity: 'high', category: 'sol',
      title: 'Date of Loss Invalid', detail: 'Date of loss cannot be parsed as a valid date.', action: 'Verify and correct the date of loss.' });
    deduction += 20;
  } else if (daysLeft <= 0) {
    flags.push({ id: 'sol_expired', severity: 'critical', category: 'sol',
      title: 'Statute of Limitations Expired',
      detail: 'The 4-year Florida personal injury SOL has passed. Case may be time-barred.',
      action: 'Consult with Sam immediately regarding tolling arguments.' });
    deduction += 40;
  } else if (daysLeft <= 30) {
    flags.push({ id: 'sol_critical', severity: 'critical', category: 'sol',
      title: `SOL Critical — ${daysLeft} Days Remaining`,
      detail: 'Less than 30 days remain on the statute of limitations.',
      action: 'File immediately or obtain written tolling agreement.' });
    deduction += 30;
  } else if (daysLeft <= 60) {
    flags.push({ id: 'sol_warning', severity: 'high', category: 'sol',
      title: `SOL Warning — ${daysLeft} Days Remaining`,
      detail: '60-day SOL warning threshold reached.',
      action: 'Escalate filing timeline. Notify Sam.' });
    deduction += 15;
  } else if (daysLeft <= 90) {
    flags.push({ id: 'sol_notice', severity: 'medium', category: 'sol',
      title: `SOL Notice — ${daysLeft} Days Remaining`,
      detail: '90-day notice. Monitor closely.',
      action: 'Review filing schedule with paralegal.' });
    deduction += 8;
  }

  return { flags, deduction };
}

function documentationRules(caseData: Record<string, unknown>): { flags: RiskFlag[]; deduction: number } {
  const flags: RiskFlag[] = [];
  let deduction = 0;

  if (!caseData.plaintiff_name) {
    flags.push({ id: 'doc_no_plaintiff', severity: 'critical', category: 'documentation',
      title: 'Plaintiff Name Missing', detail: 'Cannot generate any filing without plaintiff identity.', action: 'Enter plaintiff full legal name.' });
    deduction += 20;
  }

  if (!caseData.plaintiff_email && !caseData.plaintiff_phone) {
    flags.push({ id: 'doc_no_contact', severity: 'high', category: 'documentation',
      title: 'No Client Contact Information', detail: 'Neither email nor phone is recorded for this client.', action: 'Collect at least one contact method.' });
    deduction += 10;
  }

  if (!caseData.defendant_name) {
    flags.push({ id: 'doc_no_defendant', severity: 'high', category: 'documentation',
      title: 'Defendant Name Missing', detail: 'Required for all filings and demand letters.', action: 'Confirm defendant corporate entity name (check Sunbiz for FL corps).' });
    deduction += 10;
  }

  if (!caseData.injuries) {
    flags.push({ id: 'doc_no_injuries', severity: 'medium', category: 'documentation',
      title: 'Injuries Not Documented', detail: 'Injury description is missing from the case record.', action: 'Add injury summary from ER or treating physician records.' });
    deduction += 8;
  }

  return { flags, deduction };
}

function evidenceRules(
  caseData: Record<string, unknown>,
  medicalRecords: unknown[] = [],
  documents: unknown[] = []
): { flags: RiskFlag[]; deduction: number } {
  const flags: RiskFlag[] = [];
  let deduction = 0;

  if (medicalRecords.length === 0) {
    flags.push({ id: 'ev_no_medical', severity: 'high', category: 'evidence',
      title: 'No Medical Records Processed', detail: 'No medical records have been uploaded and processed for this case.',
      action: 'Request medical records from all treating providers via Step 2.' });
    deduction += 12;
  }

  if (documents.length === 0) {
    flags.push({ id: 'ev_no_docs', severity: 'medium', category: 'evidence',
      title: 'No Documents Generated', detail: 'No AI-drafted documents have been created for this case.',
      action: 'Complete Step 3 (Filing Preparation) to generate complaint draft.' });
    deduction += 8;
  }

  return { flags, deduction };
}

function filingReadinessRules(caseData: Record<string, unknown>): { flags: RiskFlag[]; deduction: number } {
  const flags: RiskFlag[] = [];
  let deduction = 0;

  if (!caseData.case_number) {
    flags.push({ id: 'fil_no_case_no', severity: 'medium', category: 'filing',
      title: 'Court Case Number Not Assigned',
      detail: '"CASE NO." is required in all court filings. This field must be populated before submission.',
      action: 'Obtain case number from clerk upon initial filing.' });
    deduction += 6;
  }

  if (!caseData.division) {
    flags.push({ id: 'fil_no_division', severity: 'medium', category: 'filing',
      title: 'Court Division Not Assigned',
      detail: '"DIVISION" is required on all filings in the 15th Judicial Circuit.',
      action: 'Confirm division assignment with clerk after filing.' });
    deduction += 6;
  }

  return { flags, deduction };
}

// ── Grade mapping ─────────────────────────────────────────────────────────────
function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ── Main entry point ──────────────────────────────────────────────────────────
export function evaluateCaseHealth(
  caseData: Record<string, unknown>,
  medicalRecords: unknown[] = [],
  documents: unknown[] = []
): CaseHealthReport {
  const sol           = solRules(caseData);
  const documentation = documentationRules(caseData);
  const evidence      = evidenceRules(caseData, medicalRecords, documents);
  const filing        = filingReadinessRules(caseData);

  const allFlags  = [...sol.flags, ...documentation.flags, ...evidence.flags, ...filing.flags];
  const breakdown = {
    sol:           sol.deduction,
    documentation: documentation.deduction,
    evidence:      evidence.deduction,
    filing:        filing.deduction,
  };

  const totalDeduction = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(100, 100 - totalDeduction));
  const grade = scoreToGrade(score);

  const hasCritical = allFlags.some(f => f.severity === 'critical');
  const hasHigh     = allFlags.some(f => f.severity === 'high');
  const status: CaseHealthReport['status'] = hasCritical ? 'blocked' : hasHigh ? 'needs_attention' : 'ready';

  const summary = hasCritical
    ? 'Critical issues must be resolved before this case can proceed.'
    : hasHigh
    ? 'Case has high-priority items requiring attention before filing.'
    : score >= 90
    ? 'Case is in excellent shape and ready for next steps.'
    : 'Case is progressing well. Minor items outstanding.';

  // Sort: critical → high → medium → low → info
  const severityOrder: Record<RiskSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  allFlags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { score, grade, status, flags: allFlags, summary, breakdown };
}
