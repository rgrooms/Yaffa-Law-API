import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { supabase } from '../lib/supabase';

export async function auditLog(
  req: AuthRequest,
  action: string,
  caseId: string | null,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      case_id: caseId,
      action,
      actor_id: req.user?.id || null,
      actor_name: req.user?.name || 'system',
      actor_role: req.user?.role || 'system',
      ip_address: req.ip,
      payload,
    });
  } catch (err) {
    // Audit logging should never crash the request
    console.error('[AuditLog] Failed to write:', err);
  }
}
