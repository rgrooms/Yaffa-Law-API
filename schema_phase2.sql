-- ============================================================
-- YAFFA LAW — Phase 2 Schema Addendum
-- Run in Supabase SQL Editor after schema.sql
-- ============================================================

-- ── State transition log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_state_transitions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id     TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  actor_id    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── System events / failure log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id     TEXT,
  component   TEXT NOT NULL,  -- 'ai' | 'ocr' | 'make' | 'rpa' | 'doc_gen' | 'validation'
  event_type  TEXT NOT NULL,  -- 'failure' | 'retry' | 'fallback' | 'success' | 'warning'
  severity    TEXT NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'critical'
  message     TEXT,
  retry_count INTEGER DEFAULT 0,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Case timeline events ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_timeline (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id     TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  actor_name  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Job queue tracking ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id      TEXT,
  type         TEXT NOT NULL,  -- 'ai.extract' | 'ocr.process' | 'doc.generate' | 'rpa.file'
  status       TEXT NOT NULL DEFAULT 'queued',
  retry_count  INTEGER DEFAULT 0,
  payload      JSONB,
  result       JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ── Deep access audit log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id),
  resource_type TEXT NOT NULL,  -- 'case' | 'document' | 'medical_record' | 'audit_log'
  resource_id   TEXT NOT NULL,
  action        TEXT NOT NULL,  -- 'view' | 'download' | 'print' | 'export'
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI cost tracking ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id       TEXT,
  job_id        UUID REFERENCES jobs(id),
  model         TEXT NOT NULL,
  task          TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10, 6),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI learning loop corrections ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_corrections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id      TEXT,
  document_id  UUID REFERENCES documents(id),
  field        TEXT NOT NULL,
  ai_value     TEXT,
  human_value  TEXT,
  case_type    TEXT,
  jurisdiction TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Metrics ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  metric_name TEXT NOT NULL,
  case_id     TEXT,
  value       NUMERIC,
  metadata    JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Document version additions ────────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version_number    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS parent_version_id UUID REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_current        BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS change_summary    TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS confidence_score  NUMERIC;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_system_events_case_id  ON system_events(case_id);
CREATE INDEX IF NOT EXISTS idx_case_timeline_case_id  ON case_timeline(case_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status            ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_usage_case_id       ON ai_usage(case_id);
CREATE INDEX IF NOT EXISTS idx_access_log_user_id     ON access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_access_log_resource    ON access_log(resource_type, resource_id);
