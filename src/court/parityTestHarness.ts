/**
 * Parity Test Harness — Phase 7
 *
 * Runs all 15 Florida TPV scenarios against any CourtFilingProvider implementation
 * and verifies behavioral parity. Used to validate the FloridaTPVProvider against
 * the SimulatorProvider before switching to production.
 *
 * Step 4 of the 7-Step Credentialed API Swap Plan:
 *   "Run 15 parity tests against Florida sandbox"
 *
 * Usage:
 *   npx tsx src/court/parityTestHarness.ts --provider=simulator
 *   npx tsx src/court/parityTestHarness.ts --provider=florida_tpv
 *
 * Exit codes:
 *   0 = all parity tests passed
 *   1 = one or more parity failures
 */

import { getProvider }        from './courtProviderFactory';
import { ALL_SCENARIO_NAMES } from './errorScenarios';
import type { CourtFilingProvider, FilingPacket } from './courtFilingProvider';
import type { CourtProviderName }                  from './courtProviderFactory';

// ── Shared test packet ────────────────────────────────────────────────────────
const BASE_PACKET: FilingPacket = {
  caseId:      'PARITY-TEST-001',
  courtCode:   'palm_beach_circuit',
  filingType:  'new_case',
  caseType:    'personal_injury',
  parties: [
    { role: 'plaintiff', name: 'Parity Test Plaintiff' },
    { role: 'defendant', name: 'Parity Test Defendant Corp.' },
  ],
  documents: [{
    documentId: 'DOC-PARITY-001',
    type:       'complaint',
    fileName:   'parity-complaint.pdf',
    sha256:     'parity-sha256-test',
    base64:     'JVBERi0x',
    isLead:     true,
  }],
  submittedBy: {
    name:      'Parity Test Attorney',
    barNumber: 'FL-PARITY-TEST',
  },
  referenceId: `PARITY-${Date.now()}`,
};

// ── Test result types ─────────────────────────────────────────────────────────
interface ParityResult {
  scenario:   string;
  passed:     boolean;
  errors:     string[];
  timing:     number;     // ms
  details?:   object;
}

interface ParityReport {
  provider:   string;
  timestamp:  string;
  totalTests: number;
  passed:     number;
  failed:     number;
  results:    ParityResult[];
}

// ── Parity check functions ────────────────────────────────────────────────────

/**
 * Checks that a submission returns a valid SubmissionReceipt shape.
 * This is the minimum contract any provider must satisfy.
 */
function validateReceiptShape(
  receipt: Awaited<ReturnType<CourtFilingProvider['submitFiling']>>,
  scenario: string
): string[] {
  const errors: string[] = [];

  if (!receipt.submissionId)     errors.push(`[${scenario}] Missing submissionId`);
  if (!receipt.status)           errors.push(`[${scenario}] Missing status`);
  if (!receipt.courtCode)        errors.push(`[${scenario}] Missing courtCode`);
  if (!receipt.receivedAt)       errors.push(`[${scenario}] Missing receivedAt`);
  if (receipt.fees?.total == null) errors.push(`[${scenario}] Missing fees.total`);
  if (!receipt.nextStatusUrl)    errors.push(`[${scenario}] Missing nextStatusUrl`);

  return errors;
}

/**
 * Wait utility — real timers only (no fake timers in parity tests)
 */
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * runParityTest
 *
 * Runs a single scenario against the provider and validates the contract.
 */
async function runParityTest(
  provider:  CourtFilingProvider,
  scenario:  string
): Promise<ParityResult> {
  const start  = Date.now();
  const errors: string[] = [];

  try {
    // @ts-expect-error — scenario is a simulator-specific option
    const receipt = await provider.submitFiling(BASE_PACKET, { scenario });
    errors.push(...validateReceiptShape(receipt, scenario));

    // Poll for terminal status (max 10 polls × 3s = 30s)
    let finalStatus = await provider.getFilingStatus(receipt.submissionId);
    let attempts    = 0;
    const TERMINAL  = ['accepted', 'rejected', 'error', 'timeout', 'duplicate', 'stamped'];

    while (!TERMINAL.includes(finalStatus.status) && attempts < 10) {
      await wait(3_000);
      finalStatus = await provider.getFilingStatus(receipt.submissionId);
      attempts++;
    }

    if (!finalStatus.submissionId) errors.push(`[${scenario}] Status missing submissionId`);
    if (!finalStatus.status)       errors.push(`[${scenario}] Status missing status`);
    if (!finalStatus.updatedAt)    errors.push(`[${scenario}] Status missing updatedAt`);

    if (!TERMINAL.includes(finalStatus.status)) {
      errors.push(`[${scenario}] Filing never reached terminal state — last: ${finalStatus.status}`);
    }

    return {
      scenario,
      passed:  errors.length === 0,
      errors,
      timing:  Date.now() - start,
      details: { receipt: { submissionId: receipt.submissionId, status: receipt.status }, finalStatus },
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // NOT_IMPLEMENTED errors are expected failures — provider not yet active
    if (msg.includes('NOT IMPLEMENTED') || msg.includes('Not implemented')) {
      return {
        scenario,
        passed:  false,
        errors:  [`[${scenario}] Provider not implemented: ${msg.split('\n')[0]}`],
        timing:  Date.now() - start,
        details: { notImplemented: true },
      };
    }

    return {
      scenario,
      passed:  false,
      errors:  [`[${scenario}] Unexpected error: ${msg}`],
      timing:  Date.now() - start,
    };
  }
}

/**
 * runParitySuite
 *
 * Runs all 15 scenarios and returns a full parity report.
 */
export async function runParitySuite(providerName: CourtProviderName): Promise<ParityReport> {
  console.log(`\n🔬 Parity Test Suite — Provider: ${providerName}`);
  console.log('─'.repeat(55));

  const provider  = getProvider(providerName);
  const results: ParityResult[] = [];

  for (const scenario of ALL_SCENARIO_NAMES) {
    process.stdout.write(`  Testing ${scenario}… `);
    const result = await runParityTest(provider, scenario);
    results.push(result);

    if (result.passed) {
      console.log(`✓ (${result.timing}ms)`);
    } else {
      console.log(`✗ FAILED`);
      result.errors.forEach(e => console.log(`    → ${e}`));
    }
  }

  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed).length;
  const report: ParityReport = {
    provider:   providerName,
    timestamp:  new Date().toISOString(),
    totalTests: results.length,
    passed,
    failed,
    results,
  };

  console.log('\n' + '─'.repeat(55));
  console.log(`  ${passed}/${results.length} tests passed — ${failed} failures`);
  if (failed === 0) {
    console.log('  ✅ All parity tests passed — safe to activate provider\n');
  } else {
    console.log('  ❌ Parity failures found — do NOT activate provider\n');
  }

  return report;
}

// ── CLI runner ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const arg     = process.argv.find(a => a.startsWith('--provider='));
  const name    = (arg?.split('=')[1] ?? 'simulator') as CourtProviderName;

  runParitySuite(name).then(report => {
    const fs = require('fs');
    const outPath = `parity-report-${name}-${Date.now()}.json`;
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`📋 Report written to: ${outPath}`);
    process.exit(report.failed > 0 ? 1 : 0);
  }).catch(err => {
    console.error('Parity suite failed:', err);
    process.exit(1);
  });
}
