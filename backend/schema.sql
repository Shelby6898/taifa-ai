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

-- Independent Learning Chat conversations (not linked to projects).
CREATE TABLE IF NOT EXISTS learning_conversations (
  id SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New learning chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_conversations_student
ON learning_conversations(student_id, updated_at DESC);

-- Learning messages are isolated from project conversation_messages.
CREATE TABLE IF NOT EXISTS learning_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES learning_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_messages_conversation
ON learning_messages(conversation_id, created_at, id);
