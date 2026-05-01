/**
 * Florida Court Fee Calculator
 *
 * Based on the Florida Courts filing fee schedule for civil cases.
 * Palm Beach County Circuit Court — 15th Judicial Circuit.
 *
 * Sources: Florida Statutes §28.241 and court fee schedules.
 * These are approximations for simulator purposes.
 * Actual fees must be confirmed against current Florida court fee schedule.
 */

import type { FilingPacket, FeeQuote, FeeLineItem } from './courtFilingProvider';

// Florida civil filing fee schedule (approximate — verify against §28.241)
const FEE_SCHEDULE = {
  new_case: {
    personal_injury:      { base: 401,  description: 'New civil case filing fee — Personal Injury (>$50K)' },
    medical_malpractice:  { base: 401,  description: 'New civil case filing fee — Medical Malpractice (>$50K)' },
    property_damage:      { base: 401,  description: 'New civil case filing fee — Property Damage (>$50K)' },
    wrongful_death:       { base: 401,  description: 'New civil case filing fee — Wrongful Death (>$50K)' },
  },
  subsequent: {
    personal_injury:      { base: 50,   description: 'Subsequent filing fee' },
    medical_malpractice:  { base: 50,   description: 'Subsequent filing fee' },
    property_damage:      { base: 50,   description: 'Subsequent filing fee' },
    wrongful_death:       { base: 50,   description: 'Subsequent filing fee' },
  },
  cross_claim:      { base: 50,  description: 'Cross claim / counter claim filing fee' },
  counterclaim:     { base: 50,  description: 'Counter claim filing fee' },
};

const SUMMONS_FEE     = 10;    // per summons
const SERVICE_FEE     = 40;    // process server (estimated)
const JURY_DEMAND_FEE = 0;     // included in base for PI cases

export function calculateFees(packet: FilingPacket): FeeQuote {
  const lineItems: FeeLineItem[] = [];

  // Base filing fee
  const schedule = FEE_SCHEDULE[packet.filingType];
  let baseFee = 0;
  let baseDesc = '';

  if (packet.filingType === 'new_case' || packet.filingType === 'subsequent') {
    const typeSchedule = (FEE_SCHEDULE[packet.filingType] as Record<string, { base: number; description: string }>)[packet.caseType];
    baseFee  = typeSchedule?.base   ?? 401;
    baseDesc = typeSchedule?.description ?? 'Filing fee';
  } else {
    const s = schedule as { base: number; description: string };
    baseFee  = s.base;
    baseDesc = s.description;
  }

  lineItems.push({ description: baseDesc, amount: baseFee });

  // Summons fee (one per defendant)
  const defendants = packet.parties.filter(p => p.role === 'defendant').length;
  if (defendants > 0 && packet.filingType === 'new_case') {
    lineItems.push({
      description: `Summons fee (${defendants} defendant${defendants > 1 ? 's' : ''} × $${SUMMONS_FEE})`,
      amount: defendants * SUMMONS_FEE,
    });
  }

  // Jury demand (included, note for transparency)
  lineItems.push({ description: 'Jury demand — included in filing fee', amount: JURY_DEMAND_FEE });

  const total = lineItems.reduce((sum, item) => sum + item.amount, 0);

  return {
    courtCode:    packet.courtCode,
    filingType:   packet.filingType,
    caseType:     packet.caseType,
    lineItems,
    total,
    currency:     'USD',
    quotedAt:     new Date().toISOString(),
    validUntilMs: Date.now() + 30 * 60 * 1000, // valid for 30 minutes
  };
}
