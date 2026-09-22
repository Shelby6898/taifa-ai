-- Taifa AI database schema.
-- Each student runs their own local Postgres on their own device.
-- Run once per fresh install with:
--   psql -d taifa_ai -f schema.sql

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, name)
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL,
  content TEXT,
  action TEXT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_project ON conversation_messages(project_id, created_at);

CREATE TABLE IF NOT EXISTS project_memory_facts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  fact TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_memory_facts_project ON project_memory_facts(project_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  external_id TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  stage TEXT NOT NULL,
  plan_data JSONB NOT NULL,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plans_project_pending ON plans(project_id) WHERE resolution IS NULL;

CREATE TABLE IF NOT EXISTS plan_campaigns (
  id SERIAL PRIMARY KEY,
  external_id TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  description TEXT,
  batch_number INTEGER NOT NULL DEFAULT 1,
  completed_files JSONB NOT NULL DEFAULT '[]',
  remaining_files JSONB NOT NULL DEFAULT '[]',
  resolution TEXT,
  failure_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_campaigns_project_pending ON plan_campaigns(project_id) WHERE resolution IS NULL;
