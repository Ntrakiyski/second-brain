-- Run with: wrangler d1 execute second-brain-db --file=schema.sql

CREATE TABLE IF NOT EXISTS entries (
  id               TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  tags             TEXT NOT NULL DEFAULT '[]',   -- JSON array
  source           TEXT NOT NULL DEFAULT 'api',  -- 'phone', 'browser', 'voice', 'claude', 'api'
  created_at       INTEGER NOT NULL,             -- Unix ms timestamp
  vector_ids       TEXT NOT NULL DEFAULT '[]',   -- JSON array of Vectorize vector IDs
  recall_count         INTEGER DEFAULT 0,
  importance_score     INTEGER DEFAULT 0,
  contradiction_wins   INTEGER DEFAULT 0,
  contradiction_losses INTEGER DEFAULT 0,
  owner_user_id    TEXT NOT NULL DEFAULT '',
  valid_from       INTEGER,
  valid_to         INTEGER,
  recorded_at      INTEGER,
  epistemic_status TEXT NOT NULL DEFAULT 'canonical'
);

CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_entries_temporal ON entries(valid_from, valid_to);

-- User model for multi-user support
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  normalized_username TEXT NOT NULL UNIQUE,
  auth_key_hash TEXT NOT NULL,
  auth_key_prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(normalized_username);

-- Relationship graph (issue #16). One additive table — old code ignores it and
-- rollback is a no-op. Designed to never need an ALTER: type/provenance are free
-- TEXT validated in app code (not SQL CHECK), and metadata is a JSON escape-hatch
-- for any future per-edge attribute (the edges analogue of entries.tags).
CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'relates_to',  -- relates_to | supersedes | caused_by | decided | about_person | part_of_project | follows
  weight      REAL NOT NULL DEFAULT 0.5,           -- 0..1 strength/confidence
  provenance  TEXT NOT NULL DEFAULT 'inferred',    -- explicit | inferred | system
  metadata    TEXT NOT NULL DEFAULT '{}',          -- JSON escape-hatch for future per-edge fields
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(source_id, target_id, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

-- Episodes: immutable raw content ledger (Memory Pillar Phase 1)
-- Every new capture creates an episode row preserving original text.
-- Episodes are never updated or deleted.
CREATE TABLE IF NOT EXISTS episodes (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL,
  content     TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  source      TEXT NOT NULL DEFAULT 'api',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_entry_id ON episodes(entry_id);

-- Entry snapshots: pre-mutation backups (Memory Pillar Phase 1)
-- Created before every update, append, and compression. Append-only.
CREATE TABLE IF NOT EXISTS entry_snapshots (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL DEFAULT 'api',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_entry_id ON entry_snapshots(entry_id);

-- Evidence passages: sub-entry text spans for citation (Memory Pillar Phase 1)
-- Links research claims to exact text positions in source documents.
CREATE TABLE IF NOT EXISTS passages (
  id            TEXT PRIMARY KEY,
  entry_id      TEXT NOT NULL,
  episode_id    TEXT,
  content       TEXT NOT NULL,
  section       TEXT,
  page          INTEGER,
  start_offset  INTEGER,
  end_offset    INTEGER,
  vector_ids    TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passages_entry_id ON passages(entry_id);
CREATE INDEX IF NOT EXISTS idx_passages_episode_id ON passages(episode_id);

-- Document hierarchy: research document structure (Memory Pillar Phase 1)
-- document → section → passage → claim for ingested research content.
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source_url  TEXT,
  content_type TEXT NOT NULL DEFAULT 'research',
  created_at  INTEGER NOT NULL
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

-- Agent audit log: one row per MCP session (Pillar 3 — Operator)
CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  completed_at INTEGER,
  tool_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC);

-- Agent tool call events: one row per tool invocation (Pillar 3 — Operator)
CREATE TABLE IF NOT EXISTS agent_events (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  duration_ms INTEGER,
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_tool_name ON agent_events(tool_name);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC);
