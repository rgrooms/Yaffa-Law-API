import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import { generateComplaint, generateMedicalSummary } from '../lib/documentGenerator';

const router = Router();
router.use(authenticate);

// ── POST /cases/:caseId/documents — Save AI-generated draft ──────────────────
router.post('/:caseId/documents', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;
  const { type, title, content, version = 1 } = req.body;

  if (!type || !content) {
    res.status(400).json({ error: 'type and content are required' });
    return;
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      id: uuidv4(),
      case_id: caseId,
      type,       // 'complaint' | 'summons' | 'cover_sheet' | 'email_draft' | 'medical_summary'
      title,
      content,
      version,
      status: 'draft',
      created_by: req.user!.id,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to save document' });
    return;
  }

  await auditLog(req, 'document.created', caseId, { doc_id: data.id, type, title });
  res.status(201).json({ document: data });
});

// ── GET /cases/:caseId/documents — List all docs for a case ──────────────────
router.get('/:caseId/documents', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;
  const { type } = req.query;

  let query = supabase
    .from('documents')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });

  if (type) query = query.eq('type', type as string);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: 'Failed to fetch documents' });
    return;
  }

  res.json({ documents: data });
});

// ── PATCH /cases/:caseId/documents/:docId/approve — HIL approval ─────────────
router.patch(
  '/:caseId/documents/:docId/approve',
  requireRole('attorney', 'admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { caseId, docId } = req.params;
    const { action, rejection_note } = req.body; // action: 'approved' | 'rejected' | 'sent_back'

    if (!['approved', 'rejected', 'sent_back'].includes(action)) {
      res.status(400).json({ error: 'action must be approved, rejected, or sent_back' });
      return;
    }

    if (action === 'rejected' && !rejection_note) {
      res.status(400).json({ error: 'rejection_note is required when rejecting' });
      return;
    }

    const { data, error } = await supabase
      .from('documents')
      .update({
        status: action,
        approved_by: req.user!.id,
        approved_at: new Date().toISOString(),
        rejection_note: rejection_note || null,
      })
      .eq('id', docId)
      .eq('case_id', caseId)
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: 'Failed to update document status' });
      return;
    }

    await auditLog(req, `document.${action}`, caseId, {
      doc_id: docId,
      rejection_note,
    });

    res.json({ document: data });
  }
);

// ── POST /cases/:caseId/documents/generate — Generate + version a PDF document ─────
router.post(
  '/:caseId/documents/generate',
  requireRole('attorney', 'paralegal', 'admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { caseId } = req.params;
    const { doc_type = 'complaint', download = false } = req.body;

    // Fetch case + medical records for generation
    const [caseResult, medResult] = await Promise.all([
      supabase.from('cases').select('*').eq('case_id', caseId).single(),
      supabase.from('medical_records').select('*').eq('case_id', caseId),
    ]);

    if (caseResult.error || !caseResult.data) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const caseData    = caseResult.data as Record<string, unknown>;
    const medRecords  = (medResult.data || []) as Record<string, unknown>[];

    // Get current version count for this doc type
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .eq('type', doc_type);

    const versionNumber = (count || 0) + 1;

    // Mark all existing versions as not current (immutable versioning)
    await supabase
      .from('documents')
      .update({ is_current: false })
      .eq('case_id', caseId)
      .eq('type', doc_type);

    // Generate the PDF
    let generated;
    try {
      if (doc_type === 'complaint') {
        generated = await generateComplaint(caseData);
      } else if (doc_type === 'medical_summary') {
        generated = await generateMedicalSummary(caseData, medRecords);
      } else {
        res.status(400).json({ error: `doc_type '${doc_type}' is not supported. Use: complaint, medical_summary` });
        return;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'PDF generation failed';
      res.status(500).json({ error: msg });
      return;
    }

    // Convert PDF buffer to base64 for storage in Supabase (or stream directly)
    const pdfBase64 = generated.buffer.toString('base64');

    // Save new version as a document record (gracefully degrade if version columns aren't in schema yet)
    let docRecord: Record<string, unknown> | null = null;
    try {
      const insertPayload = {
        id:          uuidv4(),
        case_id:     caseId,
        type:        doc_type,
        title:       generated.title,
        content:     pdfBase64,
        version:     versionNumber,
        status:      'draft',
        created_by:  req.user!.id,
      };

      // Try with version columns (Phase 2 schema)
      const fullPayload = {
        ...insertPayload,
        version_number: versionNumber,
        is_current:     true,
        change_summary: `Version ${versionNumber} — auto-generated ${new Date().toISOString()}`,
      };

      const { data: d1, error: e1 } = await supabase
        .from('documents')
        .insert(fullPayload)
        .select('id, case_id, type, title, version, status, created_at')
        .single();

      if (e1) {
        // Fallback: insert without Phase 2 columns
        const { data: d2, error: e2 } = await supabase
          .from('documents')
          .insert(insertPayload)
          .select('id, case_id, type, title, version, status, created_at')
          .single();
        if (!e2) docRecord = d2;
      } else {
        docRecord = d1;
      }
    } catch (_) { /* non-fatal */ }

    if (docRecord) {
      await auditLog(req, 'document.generated', caseId, {
        doc_id: docRecord.id, type: doc_type, version: versionNumber,
      });
    }

    // If download=true, stream the PDF directly
    if (download) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${doc_type}_v${versionNumber}.pdf"`);
      res.send(generated.buffer);
      return;
    }

    res.status(201).json({
      document: docRecord,
      version:  versionNumber,
      pdf_base64: pdfBase64,
      size_bytes: generated.buffer.length,
    });
  }
);

export default router;
