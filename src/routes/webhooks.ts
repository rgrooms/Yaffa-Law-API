import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';

const router = Router();

// ── POST /webhooks/make/confirm — Every Make scenario posts here ───────────────
// Payload: { scenario_id, case_id, status: 'success'|'failed', error? }
router.post('/make/confirm', async (req: Request, res: Response): Promise<void> => {
  const { scenario_id, case_id, status, error } = req.body;

  if (!scenario_id || !status) {
    res.status(400).json({ error: 'scenario_id and status are required' });
    return;
  }

  const severity = status === 'failed' ? 'critical' : 'info';

  await supabase.from('system_events').insert({
    id: uuidv4(),
    case_id: case_id || null,
    component: 'make',
    event_type: status === 'success' ? 'success' : 'failure',
    severity,
    message: status === 'failed'
      ? `Make scenario ${scenario_id} failed: ${error || 'unknown error'}`
      : `Make scenario ${scenario_id} completed successfully`,
    payload: req.body,
  });

  res.json({ received: true, status });
});

// ── GET /webhooks/make/health — Make scenario health summary ──────────────────
router.get('/make/health', async (_req: Request, res: Response): Promise<void> => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // last 24h

  const { data, error } = await supabase
    .from('system_events')
    .select('event_type, severity, message, payload, created_at')
    .eq('component', 'make')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch Make health data' });
    return;
  }

  const total    = data?.length || 0;
  const failures = data?.filter(e => e.event_type === 'failure').length || 0;
  const successes = total - failures;

  res.json({
    period: 'last_24h',
    total,
    successes,
    failures,
    health_score: total > 0 ? Math.round((successes / total) * 100) : 100,
    events: data,
  });
});

export default router;
