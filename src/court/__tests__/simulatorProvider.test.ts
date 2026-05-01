/**
 * Simulator Acceptance Tests — Phase 3.5
 *
 * Required deliverable per implementation plan v4.
 * Tests all 15 Florida TPV certification scenarios.
 * Must pass before BullMQ (Phase 5) is introduced.
 *
 * Each test creates its own SimulatorProvider instance (testMode:true) to prevent
 * cross-test state contamination. Async stages fire at 50/100/150ms instead of 8/20/30s.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { SimulatorProvider } from '../simulatorProvider';
import { FloridaTPVProvider } from '../floridaTPVProvider';
import { calculateFees } from '../feeCalculator';
import { generateECFXml } from '../ecfXmlGenerator';
import { SCENARIOS, ALL_SCENARIO_NAMES } from '../errorScenarios';
import type { FilingPacket } from '../courtFilingProvider';

// ── Fixture ───────────────────────────────────────────────────────────────────

const BASE_PACKET: FilingPacket = {
  caseId:      'TEST-2026-001',
  courtCode:   'palm_beach_circuit',
  filingType:  'new_case',
  caseType:    'personal_injury',
  parties: [
    { role: 'plaintiff', name: 'Michael Rodriguez' },
    { role: 'defendant', name: 'Atlantic Logistics Corp.' },
  ],
  documents: [{
    documentId: 'DOC-001',
    type:       'complaint',
    fileName:   'complaint.pdf',
    sha256:     'abc123def456',
    base64:     'JVBERi0xLjQgJeLjz9MKMyAwIG9iag==',
    isLead:     true,
  }],
  submittedBy: { name: 'Samuel Yaffa', barNumber: 'FL-BAR-123456' },
  referenceId: 'YAFFA-TEST-001',
};

/** Each test gets its own provider — no shared state between tests */
const mkSim = () => new SimulatorProvider({ testMode: true });

/** Wait for real async stages (50/100/150ms in testMode) to settle */
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Fee Calculator ────────────────────────────────────────────────────────────
describe('Fee Calculator', () => {
  it('calculates PI new-case fee: $401 + $10 summons = $411', () => {
    const quote = calculateFees(BASE_PACKET);
    expect(quote.total).toBe(411);
    expect(quote.currency).toBe('USD');
    expect(quote.lineItems.find(i => i.amount === 401)).toBeTruthy();
    expect(quote.lineItems.find(i => i.description.includes('Summons'))).toBeTruthy();
    expect(quote.courtCode).toBe('palm_beach_circuit');
  });

  it('calculates subsequent filing fee: $50', () => {
    const quote = calculateFees({ ...BASE_PACKET, filingType: 'subsequent' });
    expect(quote.total).toBe(50);
  });

  it('charges per-defendant summons for multiple defendants', () => {
    const multi = {
      ...BASE_PACKET,
      parties: [
        { role: 'plaintiff' as const, name: 'Plaintiff A' },
        { role: 'defendant' as const, name: 'Defendant Corp 1' },
        { role: 'defendant' as const, name: 'Defendant Corp 2' },
      ],
    };
    const quote = calculateFees(multi);
    expect(quote.lineItems.find(i => i.description.includes('Summons'))?.amount).toBe(20);
    expect(quote.total).toBe(421);
  });
});

// ── Court Policy ──────────────────────────────────────────────────────────────
describe('Court Policy', () => {
  it('returns palm_beach_circuit as operational', async () => {
    const policy = await mkSim().getCourtPolicy('palm_beach_circuit');
    expect(policy.isOperational).toBe(true);
    expect(policy.courtCode).toBe('palm_beach_circuit');
    expect(policy.maxDocSizeBytes).toBe(25 * 1024 * 1024);
    expect(policy.allowedCaseTypes).toContain('personal_injury');
  });

  it('returns non-operational for unknown court code', async () => {
    const policy = await mkSim().getCourtPolicy('unknown_court_xyz');
    expect(policy.isOperational).toBe(false);
    expect(policy.maxDocSizeBytes).toBe(0);
  });
});

// ── ECF XML Generator ─────────────────────────────────────────────────────────
describe('ECF XML Generator', () => {
  it('generates representative ECF 4.01 XML', () => {
    const xml = generateECFXml(BASE_PACKET, 'SIM-TEST-001');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('ecf:RecordDocketingMessage');
    expect(xml).toContain('REPRESENTATIVE ECF 4.01-STYLE XML');
    expect(xml).toContain('NOT Florida-certified XSD-compliant XML');
    expect(xml).toContain('Michael Rodriguez');
    expect(xml).toContain('palm_beach_circuit');
    expect(xml).toContain('SIM-TEST-001');
  });

  it('escapes XML special characters in party names', () => {
    const xml = generateECFXml(
      { ...BASE_PACKET, parties: [{ role: 'plaintiff', name: "O'Brien & Associates <LLC>" }] },
      'SIM-ESCAPE-001'
    );
    expect(xml).not.toContain('<LLC>');
    expect(xml).toContain('&lt;LLC&gt;');
  });
});

// ── Scenario 1: Valid ─────────────────────────────────────────────────────────
describe('Scenario 1: valid — full lifecycle', () => {
  it('returns submissionId and received status', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'valid' });
    expect(receipt.submissionId).toMatch(/^SIM-FL-\d{4}-\d{6}$/);
    expect(receipt.status).toBe('received');
    expect(receipt.fees.total).toBe(411);
    expect(receipt.nextStatusUrl).toContain(receipt.submissionId);
  });

  it('transitions to under_review after first async stage (50ms)', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'valid' });
    await wait(80);
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('under_review');
  });

  it('transitions to accepted after second async stage (100ms)', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'valid' });
    await wait(200);
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('accepted');
  });
});

// ── Scenario 2: Missing Signature ────────────────────────────────────────────
describe('Scenario 2: missing_signature', () => {
  it('starts received, async rejects with MISSING_SIGNATURE', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'missing_signature' });
    expect(receipt.status).toBe('received');
    await wait(200);
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('rejected');
    expect(status.errors?.some(e => e.code === 'MISSING_SIGNATURE')).toBe(true);
  });
});

// ── Scenario 3: Invalid Fee ───────────────────────────────────────────────────
describe('Scenario 3: invalid_fee', () => {
  it('immediately rejects with INVALID_FEE + field=fees.total', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'invalid_fee' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.errors?.some(e => e.code === 'INVALID_FEE')).toBe(true);
    expect(receipt.errors?.some(e => e.field === 'fees.total')).toBe(true);
  });
});

// ── Scenario 4: Wrong Jurisdiction ───────────────────────────────────────────
describe('Scenario 4: wrong_jurisdiction', () => {
  it('immediately rejects with INVALID_COURT_CODE + JURISDICTION_MISMATCH', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'wrong_jurisdiction' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.errors?.some(e => e.code === 'INVALID_COURT_CODE')).toBe(true);
    expect(receipt.errors?.some(e => e.code === 'JURISDICTION_MISMATCH')).toBe(true);
  });
});

// ── Scenario 5: Invalid UCN ───────────────────────────────────────────────────
describe('Scenario 5: invalid_ucn', () => {
  it('immediately rejects with INVALID_UCN_FORMAT + field=caseNumber', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'invalid_ucn' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.errors?.some(e => e.code === 'INVALID_UCN_FORMAT')).toBe(true);
    expect(receipt.errors?.some(e => e.field === 'caseNumber')).toBe(true);
  });
});

// ── Scenario 6: Missing Required Document ────────────────────────────────────
describe('Scenario 6: missing_required_document', () => {
  it('immediately rejects with MISSING_LEAD_DOCUMENT + MISSING_CIVIL_COVER_SHEET', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'missing_required_document' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.errors?.some(e => e.code === 'MISSING_LEAD_DOCUMENT')).toBe(true);
    expect(receipt.errors?.some(e => e.code === 'MISSING_CIVIL_COVER_SHEET')).toBe(true);
    expect(receipt.errors?.every(e => e.field === 'documents')).toBe(true);
  });
});

// ── Scenario 7: Duplicate Filing ─────────────────────────────────────────────
describe('Scenario 7: duplicate_filing', () => {
  it('returns status=duplicate with DUPLICATE_SUBMISSION + field=referenceId', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'duplicate_filing' });
    expect(receipt.status).toBe('duplicate');
    expect(receipt.errors?.some(e => e.code === 'DUPLICATE_SUBMISSION')).toBe(true);
    expect(receipt.errors?.some(e => e.field === 'referenceId')).toBe(true);
  });
});

// ── Scenario 8: Document Too Large ───────────────────────────────────────────
describe('Scenario 8: document_too_large', () => {
  it('immediately rejects with DOCUMENT_TOO_LARGE + field=documents[0].sizeBytes', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'document_too_large' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.errors?.some(e => e.code === 'DOCUMENT_TOO_LARGE')).toBe(true);
    expect(receipt.errors?.some(e => e.field === 'documents[0].sizeBytes')).toBe(true);
  });
});

// ── Scenario 9: Scheduled Downtime ── PRIORITY ───────────────────────────────
describe('Scenario 9: scheduled_downtime [PRIORITY]', () => {
  it('scenario is marked non-operational', () => {
    expect(SCENARIOS.scheduled_downtime.isOperational).toBe(false);
    expect(SCENARIOS.scheduled_downtime.initialStatus).toBe('error');
  });

  it('enters error state immediately with PORTAL_MAINTENANCE', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'scheduled_downtime' });
    expect(receipt.status).toBe('error');
    expect(receipt.errors?.some(e => e.code === 'PORTAL_MAINTENANCE')).toBe(true);
  });

  it('status is retrievable after portal error — system does not crash', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'scheduled_downtime' });
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('error');
  });
});

// ── Scenario 10: Unscheduled Outage ── PRIORITY ──────────────────────────────
describe('Scenario 10: unscheduled_outage [PRIORITY]', () => {
  it('scenario is marked non-operational', () => {
    expect(SCENARIOS.unscheduled_outage.isOperational).toBe(false);
  });

  it('returns error with PORTAL_UNAVAILABLE', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'unscheduled_outage' });
    expect(receipt.status).toBe('error');
    expect(receipt.errors?.some(e => e.code === 'PORTAL_UNAVAILABLE')).toBe(true);
  });

  it('no phantom state changes — error persists after time passes', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'unscheduled_outage' });
    await wait(500);
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('error');
  });
});

// ── Scenario 11: Timeout ── PRIORITY ─────────────────────────────────────────
describe('Scenario 11: timeout [PRIORITY]', () => {
  it('returns received on submit', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'timeout' });
    expect(receipt.status).toBe('received');
  });

  it('transitions to under_review at stage 1 (50ms)', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'timeout' });
    await wait(80);
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('under_review');
  });

  it('transitions to timeout at stage 2 (100ms)', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'timeout' });
    await wait(200);
    const status = await sim.getFilingStatus(receipt.submissionId);
    expect(status.status).toBe('timeout');
    expect(status.message).toContain('Manual follow-up');
  });

  it('returns no stamped documents on timeout', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'timeout' });
    await wait(200);
    const docs = await sim.getStampedDocuments(receipt.submissionId);
    expect(docs).toHaveLength(0);
  });
});

// ── Scenario 12: Clerk Rejection ── PRIORITY ─────────────────────────────────
describe('Scenario 12: clerk_rejection [PRIORITY]', () => {
  it('3-stage lifecycle: received → under_review → accepted → rejected', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'clerk_rejection' });
    expect(receipt.status).toBe('received');

    await wait(60);  // after stage 1 (50ms), before stage 2 (100ms)
    expect((await sim.getFilingStatus(receipt.submissionId)).status).toBe('under_review');

    await wait(60);  // now ~120ms: after stage 2 (100ms), before stage 3 (150ms)
    expect((await sim.getFilingStatus(receipt.submissionId)).status).toBe('accepted');

    await wait(100); // now ~220ms: after stage 3 (150ms)
    const final = await sim.getFilingStatus(receipt.submissionId);
    expect(final.status).toBe('rejected');
    expect(final.errors?.some(e => e.code === 'CLERK_NAME_MISMATCH')).toBe(true);
  });

  it('no stamped documents generated after clerk rejection', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'clerk_rejection' });
    await wait(400);
    expect(await sim.getStampedDocuments(receipt.submissionId)).toHaveLength(0);
  });
});

// ── Scenario 13: Accepted + Stamped ── PRIORITY ──────────────────────────────
describe('Scenario 13: accepted_stamped [PRIORITY]', () => {
  it('lifecycle transitions: received → under_review → accepted', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'accepted_stamped' });
    expect(receipt.status).toBe('received');

    await wait(60);  // after stage 1 (50ms), before stage 2 (100ms)
    expect((await sim.getFilingStatus(receipt.submissionId)).status).toBe('under_review');

    await wait(60);  // now ~120ms: after stage 2 (100ms), before stage 3/stamp (150ms)
    expect((await sim.getFilingStatus(receipt.submissionId)).status).toBe('accepted');
  });

  /**
   * One submission, one 6s wait covering:
   *   - stages fire at 50ms + 100ms (testMode)
   *   - PDFKit generates 3 documents ~3s after acceptance
   *   - 6s total is more than sufficient
   * Uses its own localSim to avoid interference.
   * caseNumber regex uses \d{4,5} since seq = 1000–9999 but counter can produce 5-digit total IDs.
   */
  it('generates 3 stamped documents with correct types and content', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'accepted_stamped' });
    expect(receipt.submissionId).toMatch(/^SIM-FL-\d{4}-\d{6}$/);

    await wait(6_000);

    const docs = await sim.getStampedDocuments(receipt.submissionId);
    expect(docs.length, 'Expected at least 3 stamped documents').toBeGreaterThanOrEqual(3);

    const types = docs.map(d => d.type);
    expect(types).toContain('stamped_complaint');
    expect(types).toContain('confirmation_receipt');
    expect(types).toContain('submission_xml');

    for (const doc of docs) {
      expect(doc.base64?.length,  `${doc.type} base64 missing`).toBeGreaterThan(100);
      expect(doc.stampedAt,       `${doc.type} stampedAt missing`).toBeTruthy();
      expect(doc.caseNumber,      `${doc.type} caseNumber invalid`).toMatch(/^\d{4}-CA-\d{4,5}-XXXX-MB$/);
      expect(doc.fileName,        `${doc.type} fileName missing`).toBeTruthy();
    }
  }, 15_000);
});

// ── Scenario 14: Payment Failed ───────────────────────────────────────────────
describe('Scenario 14: payment_failed', () => {
  it('immediately rejects with PAYMENT_DECLINED + PAYMENT_ACTION_REQUIRED', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'payment_failed' });
    expect(receipt.status).toBe('rejected');
    expect(receipt.errors?.some(e => e.code === 'PAYMENT_DECLINED')).toBe(true);
    expect(receipt.errors?.some(e => e.field === 'payment')).toBe(true);
    expect(receipt.errors?.some(e => e.code === 'PAYMENT_ACTION_REQUIRED')).toBe(true);
  });
});

// ── Scenario 15: Service List Unavailable ────────────────────────────────────
describe('Scenario 15: service_list_unavailable', () => {
  it('filing accepted despite e-service warning', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'service_list_unavailable' });
    expect(receipt.status).toBe('received');
    expect(receipt.errors?.some(e => e.code === 'ESERVICE_LIST_UNAVAILABLE')).toBe(true);

    await wait(200);
    expect((await sim.getFilingStatus(receipt.submissionId)).status).toBe('accepted');
  });

  it('ESERVICE_LIST_UNAVAILABLE error has field=serviceList', async () => {
    const sim = mkSim();
    // @ts-ignore
    const receipt = await sim.submitFiling(BASE_PACKET, { scenario: 'service_list_unavailable' });
    expect(receipt.errors?.find(e => e.code === 'ESERVICE_LIST_UNAVAILABLE')?.field).toBe('serviceList');
  });
});

// ── Unknown submission handling ───────────────────────────────────────────────
describe('Unknown submission ID handling', () => {
  it('getFilingStatus returns error without throwing', async () => {
    const status = await mkSim().getFilingStatus('SIM-FL-DOES-NOT-EXIST');
    expect(status.status).toBe('error');
    expect(status.errors?.some(e => e.code === 'SUBMISSION_NOT_FOUND')).toBe(true);
  });

  it('getStampedDocuments returns empty array', async () => {
    expect(await mkSim().getStampedDocuments('SIM-FL-DOES-NOT-EXIST')).toEqual([]);
  });
});

// ── FloridaTPVProvider stub ───────────────────────────────────────────────────
describe('FloridaTPVProvider stub', () => {
  it('constructor throws credential guard when TPV env vars are missing', () => {
    // The Phase 7 guard: FloridaTPVProvider MUST refuse to initialize
    // if credentials are absent — preventing accidental activation.
    // This is the correct contract until Step 3 of the Swap Plan is complete.
    expect(() => new FloridaTPVProvider()).toThrow(
      '[FloridaTPVProvider] Missing required environment variables'
    );
  });

  it('credential guard error lists all missing variables', () => {
    try {
      new FloridaTPVProvider();
      expect.fail('Should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('FLORIDA_TPV_API_URL');
      expect(msg).toContain('FLORIDA_TPV_API_KEY');
      expect(msg).toContain('FLORIDA_TPV_CLIENT_ID');
      expect(msg).toContain('FLORIDA_TPV_CLIENT_SECRET');
      expect(msg).toContain('Credentialed API Swap Plan');
    }
  });
});

// ── Scenario registry integrity ───────────────────────────────────────────────
describe('Scenario registry integrity', () => {
  it('has exactly 15 registered scenarios', () => {
    expect(ALL_SCENARIO_NAMES).toHaveLength(15);
  });

  it('every scenario has required fields', () => {
    for (const id of ALL_SCENARIO_NAMES) {
      const s = SCENARIOS[id];
      expect(s.label,                              `${id} missing label`).toBeTruthy();
      expect(s.description,                        `${id} missing description`).toBeTruthy();
      expect(s.initialStatus,                      `${id} missing initialStatus`).toBeTruthy();
      expect(typeof s.isOperational,               `${id} isOperational must be boolean`).toBe('boolean');
    }
  });
});
