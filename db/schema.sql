-- Current schema snapshot for a fresh Second Brain D1 database.
-- Runtime upgrades are ordered and recorded by src/db.ts. Keep this snapshot in
-- sync with the latest runtime migration.
-- Run with: wrangler d1 execute second-brain-db --file=db/schema.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id                     TEXT PRIMARY KEY,
  content                TEXT NOT NULL,
  tags                   TEXT NOT NULL DEFAULT '[]',
  source                 TEXT NOT NULL DEFAULT 'api',
  created_at             INTEGER NOT NULL,
  vector_ids             TEXT NOT NULL DEFAULT '[]',
  recall_count           INTEGER NOT NULL DEFAULT 0,
  importance_score       INTEGER NOT NULL DEFAULT 0,
  contradiction_wins     INTEGER NOT NULL DEFAULT 0,
  contradiction_losses   INTEGER NOT NULL DEFAULT 0,
  owner_user_id          TEXT NOT NULL DEFAULT '',
  retention_score        REAL NOT NULL DEFAULT 1.0,
  last_recalled_at       INTEGER,
  valid_from             INTEGER,
  valid_to               INTEGER,
  recorded_at            INTEGER,
  epistemic_status       TEXT NOT NULL DEFAULT 'canonical'
);

CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
-- idx_entries_owner and idx_entries_temporal are created by runtime migration 2
-- after it has verified that legacy entries tables contain the required columns.

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  normalized_username TEXT NOT NULL UNIQUE,
  auth_key_hash       TEXT NOT NULL,
  auth_key_prefix     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(normalized_username);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'relates_to',
  weight      REAL NOT NULL DEFAULT 0.5,
  provenance  TEXT NOT NULL DEFAULT 'inferred',
  metadata    TEXT NOT NULL DEFAULT '{}',
  confidence  REAL NOT NULL DEFAULT 1.0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(source_id, target_id, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

CREATE TABLE IF NOT EXISTS episodes (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  source       TEXT NOT NULL DEFAULT 'api',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_entry_id ON episodes(entry_id);

CREATE TABLE IF NOT EXISTS entry_snapshots (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL,
  content    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  source     TEXT NOT NULL DEFAULT 'api',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_entry_id ON entry_snapshots(entry_id);

CREATE TABLE IF NOT EXISTS passages (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT NOT NULL,
  episode_id   TEXT,
  content      TEXT NOT NULL,
  section      TEXT,
  page         INTEGER,
  start_offset INTEGER,
  end_offset   INTEGER,
  vector_ids   TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passages_entry_id ON passages(entry_id);
CREATE INDEX IF NOT EXISTS idx_passages_episode_id ON passages(episode_id);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  source_url   TEXT,
  content_type TEXT NOT NULL DEFAULT 'research',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS document_sections (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL,
  parent_section_id TEXT,
  title             TEXT NOT NULL,
  level             INTEGER NOT NULL DEFAULT 0,
  order_index       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sections_document_id ON document_sections(document_id);
CREATE INDEX IF NOT EXISTS idx_sections_parent ON document_sections(parent_section_id);

CREATE TABLE IF NOT EXISTS edge_proposals (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'contradicts',
  reason      TEXT NOT NULL DEFAULT '',
  proposed_by TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE(source_id, target_id, type, status)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  completed_at INTEGER,
  tool_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS agent_events (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  input_summary  TEXT,
  output_summary TEXT,
  duration_ms    INTEGER,
  error          TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_tool_name ON agent_events(tool_name);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC);

-- Do not insert schema_migrations rows here. CREATE TABLE IF NOT EXISTS cannot
-- prove that an existing legacy table has the current columns. src/db.ts records
-- a version only after its ordered migration batch succeeds.
