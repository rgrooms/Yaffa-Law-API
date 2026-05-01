-- ============================================================
-- YAFFA LAW — Legal Operations OS
-- Supabase Database Schema
-- Run this in your Supabase SQL Editor (project → SQL Editor → New query)
-- ============================================================

-- ── Enable UUID extension ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('attorney', 'paralegal', 'admin')),
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CASES ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id            TEXT NOT NULL UNIQUE,             -- e.g. YLG-M8X1K2
  plaintiff_name     TEXT NOT NULL,
  plaintiff_email    TEXT,
  plaintiff_phone    TEXT,
  defendant_name     TEXT,
  incident_type      TEXT,                             -- 'Auto Accident', 'Med-Mal', etc.
  date_of_loss       TEXT,
  incident_location  TEXT,
  injuries           TEXT,
  description        TEXT,
  jurisdiction       TEXT NOT NULL DEFAULT 'palm_beach_fl',
  status             TEXT NOT NULL DEFAULT 'intake'
                      CHECK (status IN ('intake','medical','filing','comms','control','filed','closed')),
  source             TEXT DEFAULT 'Web Form',
  case_number        TEXT,                             -- Assigned by court
  division           TEXT,                             -- e.g. 'AW'
  filing_fee_paid    BOOLEAN DEFAULT FALSE,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── DOCUMENTS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id        TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  type           TEXT NOT NULL
                   CHECK (type IN ('complaint','summons','cover_sheet','email_draft','medical_summary','exhibit')),
  title          TEXT,
  content        TEXT,                                 -- JSON string or HTML
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','approved','rejected','sent_back','filed')),
  approved_by    UUID REFERENCES users(id),
  approved_at    TIMESTAMPTZ,
  rejection_note TEXT,
  pdf_url        TEXT,                                 -- Storage URL after PDF generated
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── MEDICAL RECORDS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_records (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id            TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  file_name          TEXT,
  drive_file_id      TEXT,
  drive_path         TEXT,
  parsed_json        JSONB,                            -- Structured extraction output
  processing_status  TEXT NOT NULL DEFAULT 'pending'
                       CHECK (processing_status IN ('pending','processing','processed','failed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOG ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id     TEXT,                                    -- Nullable for non-case actions
  action      TEXT NOT NULL,                           -- e.g. 'case.created', 'document.approved'
  actor_id    UUID REFERENCES users(id),
  actor_name  TEXT,
  actor_role  TEXT,
  ip_address  TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cases_case_id       ON cases(case_id);
CREATE INDEX IF NOT EXISTS idx_cases_status        ON cases(status);
CREATE INDEX IF NOT EXISTS idx_documents_case_id   ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_status    ON documents(status);
CREATE INDEX IF NOT EXISTS idx_medical_case_id     ON medical_records(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_case_id       ON audit_log(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at    ON audit_log(created_at DESC);

-- ── SEED: Default users ───────────────────────────────────────────────────────
-- Passwords are bcrypt hashed. Default password: Yaffa2024!
-- CHANGE THESE IN PRODUCTION.
INSERT INTO users (email, name, role, password_hash) VALUES
  ('attorney@yaffa.law',  'Samuel Yaffa',  'attorney',  '$2a$12$k3snZz0rLnpvT3i8NhlvD.X2nPwWTs.BfQ19g2Yr/6PfZRkTbTQ9K'),
  ('paralegal@yaffa.law', 'Lori Martinez', 'paralegal', '$2a$12$k3snZz0rLnpvT3i8NhlvD.X2nPwWTs.BfQ19g2Yr/6PfZRkTbTQ9K'),
  ('admin@yaffa.law',     'Admin User',    'admin',     '$2a$12$k3snZz0rLnpvT3i8NhlvD.X2nPwWTs.BfQ19g2Yr/6PfZRkTbTQ9K')
ON CONFLICT (email) DO NOTHING;
