/**
 * db.ts — Database initialization and runtime state.
 *
 * Purpose: Bootstrap D1 schema (entries, edges, users tables), run idempotent
 *   migrations, cache the _system user ID, and report Vectorize index health.
 * Input:   Cloudflare Env (D1, Vectorize bindings) on first request.
 * Output:  Schema-ready database, cached system user ID, and VectorizeHealth status.
 * Logic:   CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN (swallowing
 *   "duplicate column" errors), HMAC-hashed _system user bootstrap, and
 *   Vectorize.describe() capability check.
 */

import { type Env } from "./types";
import { hmacKey, AUTH_PEPPER } from "./auth";

// ─── Runtime state ────────────────────────────────────────────────────────────

let dbReady = false;

export function getDbReady(): boolean { return dbReady; }
export function setDbReady(value: boolean): void { dbReady = value; }
let cachedSystemUserId: string | null = null;

// Test-only: reset dbReady so initializeDatabase runs on next request
export function _resetDbReady() { dbReady = false; cachedSystemUserId = null; }

// ─── Vectorize index health ───────────────────────────────────────────────────
// Vectorize is the one resource Cloudflare cannot auto-provision at deploy time,
// and the default one-click build token lacks permission to create it. When the
// index is missing the Worker still runs (capture stays resilient), but semantic
// recall is degraded. We detect that at runtime via the binding's describe()
// (a capability-based call that works regardless of API token scopes) so the
// dashboard and recall can report it. See docs/superpowers/specs/2026-06-26-*.

export const VECTORIZE_INDEX_NAME = "second-brain-vectors";

export interface VectorizeHealth {
  ok: boolean;
  indexName: string;
  dimensions?: number;
  error?: string;
}

export async function checkVectorizeHealth(env: Env): Promise<VectorizeHealth> {
  try {
    const info = (await env.VECTORIZE.describe()) as any;
    return {
      ok: true,
      indexName: VECTORIZE_INDEX_NAME,
      dimensions: info?.dimensions ?? info?.config?.dimensions,
    };
  } catch (e) {
    return {
      ok: false,
      indexName: VECTORIZE_INDEX_NAME,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Database initialization ──────────────────────────────────────────────────

export async function getSystemUserId(env: Env): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;
  const row = await (env.DB as any).prepare(
    "SELECT id FROM users WHERE username = '_system'"
  ).first();
  if (row) { cachedSystemUserId = row.id; return row.id; }
  // Should not happen after initialization, but fallback
  return "_system";
}

export async function initializeDatabase(env: Env): Promise<void> {
  try {
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'api', created_at INTEGER NOT NULL, vector_ids TEXT NOT NULL DEFAULT '[]')`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_user_id)`);
    // Relationship graph (issue #16). One additive table — never touches existing
    // rows/queries, so old code ignores it and rollback is a no-op. Designed to never
    // need an ALTER: type/provenance are free TEXT validated in code, and metadata is
    // a JSON escape-hatch for any future per-edge attribute.
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'relates_to', weight REAL NOT NULL DEFAULT 0.5, provenance TEXT NOT NULL DEFAULT 'inferred', metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(source_id, target_id, type))`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`);
    // Users table for multi-user auth
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, normalized_username TEXT NOT NULL UNIQUE, auth_key_hash TEXT NOT NULL, auth_key_prefix TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, last_used_at INTEGER)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(normalized_username)`);
    // Episodes: immutable raw content ledger
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, content TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'text', source TEXT NOT NULL DEFAULT 'api', created_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_entry_id ON episodes(entry_id)`);
    // Entry snapshots: pre-mutation backups
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS entry_snapshots (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'api', created_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_entry_id ON entry_snapshots(entry_id)`);
    // Passages: evidence text spans for citation
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS passages (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, episode_id TEXT, content TEXT NOT NULL, section TEXT, page INTEGER, start_offset INTEGER, end_offset INTEGER, vector_ids TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_passages_entry_id ON passages(entry_id)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_passages_episode_id ON passages(episode_id)`);
    // Document hierarchy
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT, content_type TEXT NOT NULL DEFAULT 'research', created_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS document_sections (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, parent_section_id TEXT, title TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0, order_index INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_sections_document_id ON document_sections(document_id)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_sections_parent ON document_sections(parent_section_id)`);
    // Edge proposals: human-gated contradiction inbox (Pillar 2)
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS edge_proposals (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'contradicts', reason TEXT NOT NULL DEFAULT '', proposed_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, resolved_at INTEGER, UNIQUE(source_id, target_id, type, status))`);
    // Agent audit log: one row per MCP session (Pillar 3 — Operator)
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, tool_count INTEGER NOT NULL DEFAULT 0)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC)`);
    // Agent tool call events: one row per tool invocation (Pillar 3 — Operator)
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool_name TEXT NOT NULL, input_summary TEXT, output_summary TEXT, duration_ms INTEGER, error TEXT, created_at INTEGER NOT NULL)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_agent_events_tool_name ON agent_events(tool_name)`);
    await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC)`);
  } catch (e) {
    console.error("Database initialization error (non-fatal):", e);
  }
  for (const alter of [
    `ALTER TABLE entries ADD COLUMN recall_count INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN importance_score INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN contradiction_wins INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN contradiction_losses INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''`,
    // Ticket 03: confidence on edges
    `ALTER TABLE edges ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0`,
    // Ticket 04: spaced repetition decay
    `ALTER TABLE entries ADD COLUMN retention_score REAL NOT NULL DEFAULT 1.0`,
    `ALTER TABLE entries ADD COLUMN last_recalled_at INTEGER`,
    // Ticket 05: bitemporal facts
    `ALTER TABLE entries ADD COLUMN valid_from INTEGER`,
    `ALTER TABLE entries ADD COLUMN valid_to INTEGER`,
    `ALTER TABLE entries ADD COLUMN recorded_at INTEGER`,
    // Ticket 06: staleness detection
    `ALTER TABLE entries ADD COLUMN epistemic_status TEXT NOT NULL DEFAULT 'canonical'`,
  ]) {
    try { await env.DB.exec(alter); } catch { /* column already exists — no-op */ }
  }
  // Ticket 05: temporal index for as_of queries
  try { await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_entries_temporal ON entries(valid_from, valid_to)`); } catch { /* no-op */ }

  // Migration: ensure _system user exists and all entries are owned
  try {
    let systemRow = await (env.DB as any).prepare(
      "SELECT id FROM users WHERE username = '_system'"
    ).first();

    if (!systemRow) {
      // Create _system user with inactive status and a random key nobody has
      const systemId = crypto.randomUUID().replace(/-/g, "");
      const randomKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
      const keyHash = await hmacKey(randomKey, AUTH_PEPPER);
      await (env.DB as any).prepare(
        "INSERT INTO users (id, username, normalized_username, auth_key_hash, auth_key_prefix, status, created_at) VALUES (?, ?, ?, ?, ?, 'inactive', ?)"
      ).bind(systemId, "_system", "_system", keyHash, "sb_system.", Date.now()).run();
      systemRow = { id: systemId };
    }

    cachedSystemUserId = systemRow.id;

    // Assign all unowned entries to system user
    const { meta } = await (env.DB as any).prepare(
      "UPDATE entries SET owner_user_id = ? WHERE owner_user_id = ''"
    ).bind(systemRow.id).run();
    if (meta?.changes > 0) {
      console.log(`Migration: assigned ${meta.changes} entries to _system user`);
    }
  } catch (e) {
    console.error("Migration error (non-fatal):", e);
  }
}
