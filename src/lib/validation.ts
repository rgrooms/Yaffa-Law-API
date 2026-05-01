/**
 * Two-Layer AI Output + Case Validation Engine
 *
 * Layer 1 — Schema Validation: Required fields, types, formats
 * Layer 2 — Semantic / Business Rule Validation: Legal logic, cross-field checks
 */

export interface ValidationResult {
  passed: boolean;
  layer1: { passed: boolean; errors: string[] };
  layer2: { passed: boolean; flags: ValidationFlag[] };
  confidenceScore: number; // 0–100
}

export interface ValidationFlag {
  severity: 'error' | 'warning' | 'info';
  field?: string;
  message: string;
  rule: string;
}

// ── Layer 1: Schema Validation ────────────────────────────────────────────────
export function validateSchema(data: Record<string, unknown>): {
  passed: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  const required = ['plaintiff_name', 'incident_type', 'date_of_loss'];
  for (const field of required) {
    if (!data[field] || String(data[field]).trim() === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Email format (if present)
  if (data.plaintiff_email) {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(String(data.plaintiff_email))) {
      errors.push('plaintiff_email is not a valid email format');
    }
  }

  // Date of loss must be a recognizable date
  if (data.date_of_loss) {
    const parsed = new Date(String(data.date_of_loss));
    if (isNaN(parsed.getTime())) {
      errors.push('date_of_loss is not a recognizable date');
    }
  }

  return { passed: errors.length === 0, errors };
}

// ── Layer 2: Semantic / Business Rule Validation ──────────────────────────────
export function validateSemantics(
  data: Record<string, unknown>,
  jurisdiction = 'palm_beach_fl'
): {
  passed: boolean;
  flags: ValidationFlag[];
} {
  const flags: ValidationFlag[] = [];

  // Rule: date_of_loss must be in the past and within 4 years (FL SOL = 4yr for PI)
  if (data.date_of_loss) {
    const dol = new Date(String(data.date_of_loss));
    const now = new Date();
    const msIn4Years = 4 * 365.25 * 24 * 60 * 60 * 1000;

    if (dol > now) {
      flags.push({ severity: 'error', field: 'date_of_loss', rule: 'date_not_future',
        message: 'Date of loss cannot be in the future' });
    }

    const msSinceLoss = now.getTime() - dol.getTime();
    const daysRemaining = Math.floor((msIn4Years - msSinceLoss) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 0) {
      flags.push({ severity: 'error', field: 'date_of_loss', rule: 'sol_expired',
        message: 'Statute of limitations may have expired (Florida PI: 4 years)' });
    } else if (daysRemaining <= 30) {
      flags.push({ severity: 'error', field: 'date_of_loss', rule: 'sol_critical',
        message: `CRITICAL: Only ${daysRemaining} days remaining on statute of limitations` });
    } else if (daysRemaining <= 60) {
      flags.push({ severity: 'warning', field: 'date_of_loss', rule: 'sol_warning_60',
        message: `Warning: ${daysRemaining} days remaining on statute of limitations` });
    } else if (daysRemaining <= 90) {
      flags.push({ severity: 'info', field: 'date_of_loss', rule: 'sol_notice_90',
        message: `Notice: ${daysRemaining} days remaining on statute of limitations` });
    }
  }

  // Rule: Defendant name should be consistent (not empty)
  if (!data.defendant_name || String(data.defendant_name).trim() === '') {
    flags.push({ severity: 'warning', field: 'defendant_name', rule: 'defendant_missing',
      message: 'Defendant name is missing — required for filing' });
  }

  // Rule: If billing total is present, must be positive
  if (data.billing_total !== undefined) {
    const amt = Number(data.billing_total);
    if (isNaN(amt) || amt <= 0) {
      flags.push({ severity: 'error', field: 'billing_total', rule: 'billing_invalid',
        message: 'Billing total must be a positive number' });
    }
  }

  // Rule: CASE NO. and DIVISION must be present for filing
  const hasCaseNo   = data.case_number && String(data.case_number).trim() !== '';
  const hasDivision = data.division    && String(data.division).trim()    !== '';

  if (!hasCaseNo) {
    flags.push({ severity: 'warning', field: 'case_number', rule: 'case_number_missing',
      message: '"CASE NO." is missing — required before court submission' });
  }
  if (!hasDivision) {
    flags.push({ severity: 'warning', field: 'division', rule: 'division_missing',
      message: '"DIVISION" is missing — required before court submission' });
  }

  const hasErrors = flags.some(f => f.severity === 'error');
  return { passed: !hasErrors, flags };
}

// ── Combined validation + confidence score ────────────────────────────────────
export function validateCase(
  data: Record<string, unknown>,
  jurisdiction = 'palm_beach_fl'
): ValidationResult {
  const layer1 = validateSchema(data);
  const layer2 = validateSemantics(data, jurisdiction);

  // Confidence score: start at 100, deduct per issue
  let score = 100;
  score -= layer1.errors.length * 15;
  for (const flag of layer2.flags) {
    if (flag.severity === 'error')   score -= 20;
    if (flag.severity === 'warning') score -= 8;
    if (flag.severity === 'info')    score -= 2;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    passed: layer1.passed && layer2.passed,
    layer1,
    layer2,
    confidenceScore: score,
  };
}
