/**
 * Court Simulator Routes — /sim/*
 *
 * These routes expose the simulator internals for testing and demo.
 * The Legal OS does NOT call /sim/* directly — it uses /court/* which goes through the adapter.
 *
 * /sim/* = Simulator internals (test/demo only)
 * /court/* = Adapter-facing routes (Legal OS facing, production-safe interface)
 */

import { Router, Request, Response } from 'express';
import { simulatorProvider } from '../court/simulatorProvider';
import { generateECFXml } from '../court/ecfXmlGenerator';
import { calculateFees } from '../court/feeCalculator';
import type { FilingPacket } from '../court/courtFilingProvider';
import type { ErrorScenario } from '../court/errorScenarios';
import { ALL_SCENARIO_NAMES, SCENARIOS } from '../court/errorScenarios';

const router = Router();

// ── POST /sim/court-policy — Get simulator court policy ───────────────────────
router.post('/court-policy', async (req: Request, res: Response): Promise<void> => {
  const { court_code = 'palm_beach_circuit' } = req.body;
  const policy = await simulatorProvider.getCourtPolicy(court_code);
  res.json({ policy });
});

// ── POST /sim/fees/calculate — Fee calculation ────────────────────────────────
router.post('/fees/calculate', async (req: Request, res: Response): Promise<void> => {
  const packet = req.body as Partial<FilingPacket>;

  if (!packet.filingType || !packet.caseType || !packet.courtCode) {
    res.status(400).json({ error: 'filingType, caseType, and courtCode are required' });
    return;
  }

  const quote = calculateFees(packet as FilingPacket);
  res.json({ fee_quote: quote });
});

// ── POST /sim/filings — Submit a filing (with scenario selection) ─────────────
router.post('/filings', async (req: Request, res: Response): Promise<void> => {
  const { packet, scenario = 'valid', callback_url } = req.body as {
    packet: FilingPacket;
    scenario?: ErrorScenario;
    callback_url?: string;
  };

  if (!packet) {
    res.status(400).json({ error: 'packet is required' });
    return;
  }

  if (!ALL_SCENARIO_NAMES.includes(scenario)) {
    res.status(400).json({
      error: `Unknown scenario "${scenario}"`,
      available: ALL_SCENARIO_NAMES,
    });
    return;
  }

  const outcome = SCENARIOS[scenario];
  if (!outcome.isOperational) {
    // Immediately return portal unavailable error
    res.status(503).json({
      error:     'Portal Unavailable',
      scenario,
      label:     outcome.label,
      errors:    outcome.errors,
    });
    return;
  }

  // @ts-ignore — submitFiling is overloaded with options on SimulatorProvider
  const receipt = await simulatorProvider.submitFiling(packet, {
    scenario,
    callbackUrl: callback_url,
  });

  // Also return the representative ECF XML
  const ecfXml = generateECFXml(packet, receipt.submissionId);

  res.status(201).json({
    receipt,
    scenario_label: outcome.label,
    ecf_xml_preview: ecfXml.substring(0, 400) + '...',
  });
});

// ── GET /sim/filings/:submissionId/status — Polling status ───────────────────
router.get('/filings/:submissionId/status', async (req: Request, res: Response): Promise<void> => {
  const status = await simulatorProvider.getFilingStatus(req.params.submissionId);
  res.json({ filing_status: status });
});

// ── GET /sim/filings/:submissionId/receipt — Full submission record ───────────
router.get('/filings/:submissionId/receipt', async (req: Request, res: Response): Promise<void> => {
  const record = simulatorProvider.getSubmissionRecord(req.params.submissionId);
  if (!record) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  // Omit heavy packet from listing
  const { packet: _packet, ...rest } = record;
  res.json({ receipt: rest, party_count: record.packet.parties.length });
});

// ── GET /sim/filings/:submissionId/stamped-documents — Return stamped set ─────
router.get('/filings/:submissionId/stamped-documents', async (req: Request, res: Response): Promise<void> => {
  const docs = await simulatorProvider.getStampedDocuments(req.params.submissionId);
  if (!docs.length) {
    const status = await simulatorProvider.getFilingStatus(req.params.submissionId);
    if (status.status === 'error') {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }
    res.status(202).json({
      message: `Filing is in status "${status.status}" — stamped documents not yet available.`,
      filing_status: status,
    });
    return;
  }
  // Return metadata only (base64 is large — omit unless requested)
  const { download } = req.query;
  const response = docs.map(d => ({
    ...d,
    base64: download === 'true' ? d.base64 : `[${Math.round((d.base64?.length ?? 0) * 0.75 / 1024)}KB — add ?download=true to retrieve]`,
  }));
  res.json({ stamped_documents: response, count: docs.length });
});

// ── POST /sim/filings/:submissionId/callback — Trigger manual callback ────────
router.post('/filings/:submissionId/callback', async (req: Request, res: Response): Promise<void> => {
  const record = simulatorProvider.getSubmissionRecord(req.params.submissionId);
  if (!record) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  const status = await simulatorProvider.getFilingStatus(req.params.submissionId);
  res.json({ callback_fired: true, filing_status: status });
});

// ── POST /sim/errors/trigger — Trigger a specific error scenario ──────────────
router.post('/errors/trigger', async (req: Request, res: Response): Promise<void> => {
  const { scenario, court_code = 'palm_beach_circuit' } = req.body as {
    scenario: ErrorScenario;
    court_code?: string;
  };

  if (!scenario || !ALL_SCENARIO_NAMES.includes(scenario)) {
    res.status(400).json({
      error: 'Valid scenario is required',
      available_scenarios: ALL_SCENARIO_NAMES.map(s => ({
        id: s,
        label: SCENARIOS[s].label,
        description: SCENARIOS[s].description,
      })),
    });
    return;
  }

  const mockPacket: FilingPacket = {
    caseId:      'TEST-TRIGGER',
    courtCode:   court_code,
    filingType:  'new_case',
    caseType:    'personal_injury',
    parties:     [
      { role: 'plaintiff', name: 'Test Plaintiff' },
      { role: 'defendant', name: 'Test Defendant Corp.' },
    ],
    documents:   [{ documentId: 'DOC-TEST', type: 'complaint', fileName: 'test.pdf', sha256: 'abc', base64: 'JVBERi0x', isLead: true }],
    submittedBy: { name: 'Test Attorney', barNumber: 'FL-TEST-999' },
  };

  const outcome = SCENARIOS[scenario];
  if (!outcome.isOperational) {
    res.status(503).json({ scenario, label: outcome.label, errors: outcome.errors });
    return;
  }

  // @ts-ignore
  const receipt = await simulatorProvider.submitFiling(mockPacket, { scenario });
  res.json({
    scenario,
    label:   outcome.label,
    receipt,
    async_stages: outcome.asyncStages?.map(s => ({ delay_ms: s.delayMs, status: s.status, message: s.message })) ?? [],
  });
});

// ── GET /sim/scenarios — List all available scenarios ────────────────────────
router.get('/scenarios', (_req: Request, res: Response): void => {
  res.json({
    scenarios: ALL_SCENARIO_NAMES.map(id => ({
      id,
      label:         SCENARIOS[id].label,
      description:   SCENARIOS[id].description,
      initialStatus: SCENARIOS[id].initialStatus,
      isOperational: SCENARIOS[id].isOperational,
      asyncStages:   SCENARIOS[id].asyncStages?.length ?? 0,
      willStamp:     SCENARIOS[id].willStamp ?? false,
    })),
  });
});

// ── GET /sim/filings — List all simulator submissions ────────────────────────
router.get('/filings', (_req: Request, res: Response): void => {
  const all = simulatorProvider.getAllSubmissions().map(r => ({
    submissionId: r.submissionId,
    caseId:       r.packet.caseId,
    scenario:     r.scenario,
    status:       r.status,
    receivedAt:   r.receivedAt,
    updatedAt:    r.updatedAt,
    fees:         r.fees,
    caseNumber:   r.caseNumber,
  }));
  res.json({ submissions: all, count: all.length });
});

export default router;
