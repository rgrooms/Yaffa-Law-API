import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import { evaluateCaseHealth } from '../lib/rulesEngine';

const router = Router();

// All case routes require authentication
router.use(authenticate);

// ── POST /cases — Create a new case from intake form ──────────────────────────
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    plaintiff_name,
    plaintiff_email,
    plaintiff_phone,
    incident_type,
    date_of_loss,
    incident_location,
    injuries,
    description,
    defendant_name,
    source,
  } = req.body;

  if (!plaintiff_name || !date_of_loss) {
    res.status(400).json({ error: 'plaintiff_name and date_of_loss are required' });
    return;
  }

  const case_id = `YLG-${Date.now().toString(36).toUpperCase()}`;

  const { data, error } = await supabase
    .from('cases')
    .insert({
      id: uuidv4(),
      case_id,
      plaintiff_name,
      plaintiff_email,
      plaintiff_phone,
      incident_type,
      date_of_loss,
      incident_location,
      injuries,
      description,
      defendant_name: defendant_name || 'ATLANTIC LOGISTICS CORP.',
      jurisdiction: 'palm_beach_fl',
      status: 'intake',
      source: source || 'Web Form',
      created_by: req.user!.id,
    })
    .select()
    .single();

  if (error) {
    console.error('[POST /cases]', error);
    res.status(500).json({ error: 'Failed to create case' });
    return;
  }

  await auditLog(req, 'case.created', data.case_id, { plaintiff_name });
  res.status(201).json({ case: data });
});

// ── GET /cases — List all cases (filtered by role) ───────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, search } = req.query;

  let query = supabase
    .from('cases')
    .select('id, case_id, plaintiff_name, defendant_name, status, incident_type, date_of_loss, created_at, jurisdiction')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status as string);
  if (search) query = query.ilike('plaintiff_name', `%${search}%`);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: 'Failed to fetch cases' });
    return;
  }

  res.json({ cases: data });
});

// ── GET /cases/:caseId — Full case detail ────────────────────────────────────
router.get('/:caseId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;

  const [caseResult, docsResult, medicalResult] = await Promise.all([
    supabase.from('cases').select('*').eq('case_id', caseId).single(),
    supabase.from('documents').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
    supabase.from('medical_records').select('*').eq('case_id', caseId),
  ]);

  if (caseResult.error || !caseResult.data) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }

  await auditLog(req, 'case.viewed', caseId, {});
  res.json({
    case: caseResult.data,
    documents: docsResult.data || [],
    medical_records: medicalResult.data || [],
  });
});

// ── PATCH /cases/:caseId — Update case status or fields ──────────────────────
router.patch('/:caseId', requireRole('attorney', 'admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;
  const updates = req.body;

  // Prevent overwriting protected fields
  delete updates.id;
  delete updates.case_id;
  delete updates.created_by;
  delete updates.created_at;

  const { data, error } = await supabase
    .from('cases')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('case_id', caseId)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to update case' });
    return;
  }

  await auditLog(req, 'case.updated', caseId, { updates });
  res.json({ case: data });
});

// ── GET /cases/:caseId/audit ─────────────────────────────────────────────────────────
router.get('/:caseId/audit', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;

  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
    return;
  }

  res.json({ audit: data });
});

// ── GET /cases/:caseId/health — Case Health Score + Risk Flags ────────────────
router.get('/:caseId/health', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;

  const [caseResult, medResult, docResult] = await Promise.all([
    supabase.from('cases').select('*').eq('case_id', caseId).single(),
    supabase.from('medical_records').select('*').eq('case_id', caseId),
    supabase.from('documents').select('id, type, status').eq('case_id', caseId),
  ]);

  if (caseResult.error || !caseResult.data) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }

  const report = evaluateCaseHealth(
    caseResult.data as Record<string, unknown>,
    medResult.data || [],
    docResult.data || []
  );

  await auditLog(req, 'case.health_checked', caseId, { score: report.score, grade: report.grade });
  res.json({ health: report, case_id: caseId });
});

export default router;
