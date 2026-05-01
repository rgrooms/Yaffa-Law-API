/**
 * Data Classification Layer
 *
 * Tier 1 — Highly Sensitive: PII, medical records, SSN, DOB
 * Tier 2 — Case Metadata: case type, jurisdiction, amounts, dates
 * Tier 3 — Public / Templates: legal boilerplate, court rules
 *
 * Rule: Tier 1 fields are ALWAYS redacted before sending to external AI.
 * AI operates on anonymized structure. De-anonymization happens server-side.
 */

export type DataTier = 1 | 2 | 3;

// Fields classified as Tier 1 (PII / medical — never sent raw to AI)
const TIER1_FIELDS = new Set([
  'plaintiff_name', 'plaintiff_email', 'plaintiff_phone',
  'ssn', 'date_of_birth', 'dob',
  'medical_records', 'diagnosis', 'treatment_details',
  'billing_statements', 'insurance_policy_number',
  'driver_license', 'passport_number',
]);

// Tier 1 field → placeholder token mapping (consistent per session)
export function redactTier1(data: Record<string, unknown>): {
  redacted: Record<string, unknown>;
  tokens: Record<string, string>;
} {
  const redacted: Record<string, unknown> = {};
  const tokens: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (TIER1_FIELDS.has(key) && value) {
      const token = `[REDACTED_${key.toUpperCase()}]`;
      redacted[key] = token;
      tokens[token] = String(value);
    } else {
      redacted[key] = value;
    }
  }

  return { redacted, tokens };
}

// Restore Tier 1 values in AI output using the token map
export function deRedact(
  aiOutput: Record<string, unknown>,
  tokens: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(aiOutput)) {
    if (typeof value === 'string' && tokens[value]) {
      result[key] = tokens[value];
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Classify a single field
export function classifyField(fieldName: string): DataTier {
  if (TIER1_FIELDS.has(fieldName)) return 1;
  const tier2 = ['case_id', 'incident_type', 'date_of_loss', 'jurisdiction',
    'billing_total', 'incident_location', 'injuries', 'defendant_name'];
  if (tier2.includes(fieldName)) return 2;
  return 3;
}
