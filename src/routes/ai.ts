import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import { supabase } from '../lib/supabase';
import { redactTier1, deRedact } from '../lib/dataClassification';
import { validateCase } from '../lib/validation';

const router = Router();
router.use(authenticate);

// ── Model cost table (USD per 1K tokens) ──────────────────────────────────────
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':          { input: 0.000150, output: 0.000600 },  // Tier 1 – cheap
  'gpt-4o':               { input: 0.002500, output: 0.010000 },  // Tier 2 – balanced
  'claude-3-5-haiku':     { input: 0.000800, output: 0.004000 },  // Tier 1 – cheap
  'claude-3-5-sonnet':    { input: 0.003000, output: 0.015000 },  // Tier 2 – balanced
  'claude-3-opus':        { input: 0.015000, output: 0.075000 },  // Tier 3 – expensive
};

// ── Task → Model routing (cheapest model that can handle the task) ─────────────
const TASK_MODEL_MAP: Record<string, string> = {
  'intake.classify':    'gpt-4o-mini',
  'intake.extract':     'gpt-4o-mini',
  'medical.extract':    'gpt-4o',
  'medical.summarize':  'gpt-4o',
  'doc.draft':          'gpt-4o',
  'doc.validate':       'gpt-4o-mini',
  'case.analyze':       'claude-3-5-sonnet',
  'sol.check':          'gpt-4o-mini',
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model];
  if (!costs) return 0;
  return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
}

async function trackUsage(
  caseId: string | null,
  jobId: string | null,
  model: string,
  task: string,
  inputTokens: number,
  outputTokens: number
) {
  const costUsd = estimateCost(model, inputTokens, outputTokens);
  await supabase.from('ai_usage').insert({
    id: uuidv4(),
    case_id: caseId,
    job_id: jobId,
    model,
    task,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  });
  return costUsd;
}

// ── POST /ai/validate — Run validation on a case (no AI needed) ───────────────
router.post('/validate', async (req: AuthRequest, res: Response): Promise<void> => {
  const { case_id, data, jurisdiction } = req.body;

  if (!data || typeof data !== 'object') {
    res.status(400).json({ error: 'data object is required' });
    return;
  }

  const result = validateCase(data, jurisdiction || 'palm_beach_fl');

  await auditLog(req, 'ai.validate', case_id || null, {
    passed: result.passed,
    confidence: result.confidenceScore,
    flag_count: result.layer2.flags.length,
  });

  res.json({ validation: result });
});

// ── POST /ai/run — AI Gateway with model routing + cost tracking ──────────────
router.post('/run', async (req: AuthRequest, res: Response): Promise<void> => {
  const { case_id, task, data, model_override } = req.body;

  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Return a well-structured stub when no API key is configured
    res.json({
      task,
      model: 'stub',
      result: {
        status: 'stub',
        message: 'AI Gateway is configured. Add OPENAI_API_KEY to .env to activate live AI.',
        data: { extracted: true, fields: data || {} },
      },
      usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      validation: data ? validateCase(data) : null,
    });
    return;
  }

  // Select model
  const model = model_override || TASK_MODEL_MAP[task] || 'gpt-4o-mini';

  // Redact Tier 1 PII before sending to AI
  const { redacted, tokens } = data ? redactTier1(data) : { redacted: {}, tokens: {} };

  // Build prompt
  const systemPrompt = `You are a legal data extraction assistant for Yaffa Law Group.
Task: ${task}
Always respond with valid JSON only. No prose, no explanation outside the JSON structure.
Jurisdiction: Florida, Palm Beach County.`;

  const userPrompt = `Extract and structure the following case data:
${JSON.stringify(redacted, null, 2)}

Return a JSON object with all relevant fields populated.`;

  let result: Record<string, unknown> = {};
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`OpenAI error: ${err}`);
    }

    const aiData = await aiRes.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const rawContent = aiData.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(rawContent);

    // De-redact: restore Tier 1 fields in AI output
    result = deRedact(parsed, tokens);

    inputTokens  = aiData.usage?.prompt_tokens     || 0;
    outputTokens = aiData.usage?.completion_tokens || 0;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Log failure to system_events
    await supabase.from('system_events').insert({
      id: uuidv4(),
      case_id: case_id || null,
      component: 'ai',
      event_type: 'failure',
      severity: 'warning',
      message,
    });

    res.status(502).json({ error: 'AI processing failed', detail: message });
    return;
  }

  // Track cost
  const costUsd = await trackUsage(case_id || null, null, model, task, inputTokens, outputTokens);

  // Run validation on AI output
  const validation = validateCase(result as Record<string, unknown>);

  await auditLog(req, 'ai.run', case_id || null, { task, model, costUsd, passed: validation.passed });

  res.json({
    task,
    model,
    result,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd },
    validation,
  });
});

// ── GET /ai/usage/:caseId — Cost breakdown for a case ─────────────────────────
router.get('/usage/:caseId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { caseId } = req.params;

  const { data, error } = await supabase
    .from('ai_usage')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch AI usage' });
    return;
  }

  const totalCost = (data || []).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);

  res.json({ usage: data, total_cost_usd: totalCost });
});

export default router;
