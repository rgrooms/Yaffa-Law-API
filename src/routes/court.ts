/**
 * Court Filing Routes — /court/*
 *
 * These are the ONLY court-filing routes the Legal OS calls.
 * All requests go through courtFilingAdapter — never touching the simulator directly.
 *
 * This is the production-safe interface.
 */

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import { supabase } from '../lib/supabase';
import { courtFilingAdapter } from '../court/courtFilingAdapter';
import { simulatorProvider } from '../court/simulatorProvider';
import type { FilingPacket } from '../court/courtFilingProvider';
import type { ErrorScenario } from '../court/errorScenarios';

const router = Router();
router.use(authenticate);

// ── POST /court/policy — Get court policy ─────────────────────────────────────
router.post('/policy', async (req: AuthRequest, res: Response): Promise<void> => {
  const { court_code = 'palm_beach_circuit' } = req.body;
  const policy = await courtFilingAdapter.getCourtPolicy(court_code);
  res.json({ policy });
});

// ── POST /court/fees — Calculate filing fees ──────────────────────────────────
router.post('/fees', async (req: AuthRequest, res: Response): Promise<void> => {
  const packet = req.body as Partial<FilingPacket>;
  if (!packet.filingType || !packet.caseType || !packet.courtCode) {
    res.status(400).json({ error: 'filingType, caseType, and courtCode are required' });
    return;
  }
  const quote = await courtFilingAdapter.calculateFees(packet as FilingPacket);
  res.json({ fee_quote: quote });
});

// ── POST /court/submit — Submit filing through adapter ────────────────────────
router.post(
  '/submit',
  requireRole('attorney', 'admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const {
      case_id,
      packet,
      scenario = 'valid',
      callback_url,
    } = req.body as { case_id?: string; packet: FilingPacket; scenario?: ErrorScenario; callback_url?: string };

    if (!packet) {
      res.status(400).json({ error: 'packet is required' });
      return;
    }

    try {
      // @ts-ignore — options param added in SimulatorProvider
      const receipt = await simulatorProvider.submitFiling(packet, { scenario, callbackUrl: callback_url });

      // Persist submission to DB (best-effort — court_submissions table from phase 2 schema)
      try {
        await supabase.from('system_events').insert({
          id:         uuidv4(),
          case_id:    case_id || packet.caseId,
          component:  'court_filing',
          event_type: receipt.status === 'rejected' ? 'failure' : 'success',
          severity:   receipt.status === 'rejected' ? 'critical' : 'info',
          message:    `Court filing submitted: ${receipt.submissionId} — status: ${receipt.status}`,
          payload:    receipt,
        });
      } catch (_) { /* non-fatal */ }

      await auditLog(req, 'court.filing.submitted', case_id || packet.caseId, {
        submission_id: receipt.submissionId,
        status:        receipt.status,
        scenario,
        fees:          receipt.fees,
      });

      res.status(201).json({ receipt });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Filing submission failed';
      res.status(500).json({ error: msg });
    }
  }
);

// ── GET /court/status/:submissionId — Poll filing status ─────────────────────
router.get('/status/:submissionId', async (req: AuthRequest, res: Response): Promise<void> => {
  const status = await courtFilingAdapter.getFilingStatus(req.params.submissionId);
  await auditLog(req, 'court.filing.status_checked', null, {
    submission_id: req.params.submissionId, status: status.status,
  });
  res.json({ filing_status: status });
});

// ── GET /court/stamped/:submissionId — Get stamped documents ──────────────────
router.get('/stamped/:submissionId', async (req: AuthRequest, res: Response): Promise<void> => {
  const docs = await courtFilingAdapter.getStampedDocuments(req.params.submissionId);

  if (!docs.length) {
    const status = await courtFilingAdapter.getFilingStatus(req.params.submissionId);
    res.status(202).json({
      message: `Filing status is "${status.status}" — stamped documents not yet available.`,
      filing_status: status,
    });
    return;
  }

  await auditLog(req, 'court.stamped_documents.retrieved', null, {
    submission_id: req.params.submissionId, doc_count: docs.length,
  });

  res.json({ stamped_documents: docs, count: docs.length });
});

export default router;
