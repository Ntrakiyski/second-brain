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
  } catch (e) {
    console.error("Database initialization error (non-fatal):", e);
  }
  for (const alter of [
    `ALTER TABLE entries ADD COLUMN recall_count INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN importance_score INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN contradiction_wins INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN contradiction_losses INTEGER DEFAULT 0`,
    `ALTER TABLE entries ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''`,
  ]) {
    try { await env.DB.exec(alter); } catch { /* column already exists — no-op */ }
  }

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
