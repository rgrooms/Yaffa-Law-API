import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { authenticate, AuthRequest } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';

const router = Router();
router.use(authenticate);

// ── POST /cases/:caseId/medical — Save processed medical record ───────────────
router.post('/:caseId/medical', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;
  const { file_name, drive_file_id, drive_path, parsed_json, processing_status } = req.body;

  const { data, error } = await supabase
    .from('medical_records')
    .insert({
      id: uuidv4(),
      case_id: caseId,
      file_name,
      drive_file_id,
      drive_path,
      parsed_json,
      processing_status: processing_status || 'processed',
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to save medical record' });
    return;
  }

  await auditLog(req, 'medical_record.saved', caseId, { file_name, drive_file_id });
  res.status(201).json({ record: data });
});

// ── GET /cases/:caseId/medical — Fetch all medical records for a case ─────────
router.get('/:caseId/medical', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;

  const { data, error } = await supabase
    .from('medical_records')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch medical records' });
    return;
  }

  res.json({ records: data });
});

export default router;
