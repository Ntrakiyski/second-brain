/**
 * db.ts — Ordered D1 schema migrations and runtime database state.
 *
 * Schema changes are applied sequentially and recorded in schema_migrations.
 * Each migration is idempotent so an interrupted migration can be retried. D1
 * batch() keeps a migration's statements and version marker atomic. Unexpected
 * failures propagate; the Worker must never advertise a partially migrated
 * database as ready.
 */

import { type Env } from "./types";
import { hmacKey, AUTH_PEPPER } from "./auth";

// ─── Runtime state ────────────────────────────────────────────────────────────

let dbReady = false;
let initializationPromise: Promise<void> | null = null;
let cachedSystemUserId: string | null = null;

export function getDbReady(): boolean { return dbReady; }

/**
 * Kept for compatibility with request handlers that currently set the flag
 * after initializeDatabase resolves. initializeDatabase itself is authoritative
 * and only sets this true after every migration and bootstrap step succeeds.
 */
export function setDbReady(value: boolean): void {
  dbReady = value;
  if (!value) cachedSystemUserId = null;
}

// Test-only: reset process-local state so initialization runs on the next call.
export function _resetDbReady(): void {
  dbReady = false;
  initializationPromise = null;
  cachedSystemUserId = null;
}

// ─── Vectorize index health ──────────────────────────────────────────────────

export const VECTORIZE_INDEX_NAME = "second-brain-vectors_v2";

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

// ─── Ordered schema migrations ───────────────────────────────────────────────

interface Migration {
  version: number;
  name: string;
  statements: (db: D1Database) => Promise<string[]>;
}

const sql = (...statements: string[]) => async (): Promise<string[]> => statements;

async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  // Table names are internal constants, never request input.
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(result.results.map((row) => row.name));
}

function addColumnIfMissing(
  statements: string[],
  columns: Set<string>,
  table: string,
  column: string,
  definition: string,
): void {
  if (!columns.has(column)) {
    statements.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "core_tables",
    statements: sql(
      `CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'api',
        created_at INTEGER NOT NULL,
        vector_ids TEXT NOT NULL DEFAULT '[]'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source)`,
      `CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'relates_to',
        weight REAL NOT NULL DEFAULT 0.5,
        provenance TEXT NOT NULL DEFAULT 'inferred',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(source_id, target_id, type)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        normalized_username TEXT NOT NULL UNIQUE,
        auth_key_hash TEXT NOT NULL,
        auth_key_prefix TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON users(normalized_username)`,
    ),
  },
  {
    version: 2,
    name: "entry_and_edge_features",
    statements: async (db) => {
      const entries = await tableColumns(db, "entries");
      const edges = await tableColumns(db, "edges");
      const statements: string[] = [];

      addColumnIfMissing(statements, entries, "entries", "recall_count", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(statements, entries, "entries", "importance_score", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(statements, entries, "entries", "contradiction_wins", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(statements, entries, "entries", "contradiction_losses", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(statements, entries, "entries", "owner_user_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, entries, "entries", "retention_score", "REAL NOT NULL DEFAULT 1.0");
      addColumnIfMissing(statements, entries, "entries", "last_recalled_at", "INTEGER");
      addColumnIfMissing(statements, entries, "entries", "valid_from", "INTEGER");
      addColumnIfMissing(statements, entries, "entries", "valid_to", "INTEGER");
      addColumnIfMissing(statements, entries, "entries", "recorded_at", "INTEGER");
      addColumnIfMissing(statements, entries, "entries", "epistemic_status", "TEXT NOT NULL DEFAULT 'canonical'");
      addColumnIfMissing(statements, edges, "edges", "confidence", "REAL NOT NULL DEFAULT 1.0");

      // These indexes are deliberately emitted after their columns are present.
      statements.push(
        `CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_entries_temporal ON entries(valid_from, valid_to)`,
      );
      return statements;
    },
  },
  {
    version: 3,
    name: "memory_and_operator_tables",
    statements: sql(
      `CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text',
        source TEXT NOT NULL DEFAULT 'api',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_episodes_entry_id ON episodes(entry_id)`,
      `CREATE TABLE IF NOT EXISTS entry_snapshots (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'api',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_snapshots_entry_id ON entry_snapshots(entry_id)`,
      `CREATE TABLE IF NOT EXISTS passages (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        episode_id TEXT,
        content TEXT NOT NULL,
        section TEXT,
        page INTEGER,
        start_offset INTEGER,
        end_offset INTEGER,
        vector_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_passages_entry_id ON passages(entry_id)`,
      `CREATE INDEX IF NOT EXISTS idx_passages_episode_id ON passages(episode_id)`,
      `CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_url TEXT,
        content_type TEXT NOT NULL DEFAULT 'research',
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS document_sections (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        parent_section_id TEXT,
        title TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sections_document_id ON document_sections(document_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sections_parent ON document_sections(parent_section_id)`,
      `CREATE TABLE IF NOT EXISTS edge_proposals (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'contradicts',
        reason TEXT NOT NULL DEFAULT '',
        proposed_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        UNIQUE(source_id, target_id, type, status)
      )`,
      `CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        tool_count INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC)`,
      `CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        duration_ms INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_events_tool_name ON agent_events(tool_name)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at DESC)`,
    ),
  },
] as const;

async function ensureMigrationTable(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`).run();
}

async function readAppliedVersions(db: D1Database): Promise<Set<number>> {
  const result = await db.prepare(
    `SELECT version, name FROM schema_migrations ORDER BY version ASC`,
  ).all<{ version: number; name: string }>();

  const applied = new Set<number>();
  let expected = 1;
  for (const row of result.results) {
    const version = Number(row.version);
    const known = MIGRATIONS.find((migration) => migration.version === version);
    if (!known) {
      throw new Error(`Database schema version ${version} is newer than this Worker supports`);
    }
    if (version !== expected) {
      throw new Error(`Database migration history is not contiguous: expected ${expected}, found ${version}`);
    }
    if (row.name !== known.name) {
      throw new Error(`Database migration ${version} name mismatch: expected ${known.name}, found ${row.name}`);
    }
    applied.add(version);
    expected += 1;
  }
  return applied;
}

async function applyMigration(db: D1Database, migration: Migration): Promise<void> {
  const sqlStatements = await migration.statements(db);
  const statements = sqlStatements.map((statement) => db.prepare(statement));
  statements.push(
    db.prepare(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
    ).bind(migration.version, migration.name, Date.now()),
  );

  try {
    await db.batch(statements);
  } catch (cause) {
    throw new Error(
      `Database migration ${migration.version} (${migration.name}) failed`,
      { cause },
    );
  }
}

async function validateCurrentSchema(db: D1Database): Promise<void> {
  // Version rows are not sufficient proof on their own: an operator could have
  // restored mismatched tables or an older schema script could have been marked
  // manually. Zero-row probes make D1 resolve every required table and column
  // without reading user data.
  const probes = [
    `SELECT id, content, tags, source, created_at, vector_ids,
      recall_count, importance_score, contradiction_wins,
      contradiction_losses, owner_user_id, retention_score,
      last_recalled_at, valid_from, valid_to, recorded_at,
      epistemic_status FROM entries LIMIT 0`,
    `SELECT id, source_id, target_id, type, weight, provenance, metadata,
      confidence, created_at, updated_at FROM edges LIMIT 0`,
    `SELECT id, username, normalized_username, auth_key_hash, auth_key_prefix,
      status, created_at, last_used_at FROM users LIMIT 0`,
    `SELECT id, entry_id, content, content_type, source, created_at FROM episodes LIMIT 0`,
    `SELECT id, entry_id, content, tags, source, created_at FROM entry_snapshots LIMIT 0`,
    `SELECT id, entry_id, episode_id, content, section, page, start_offset,
      end_offset, vector_ids, created_at FROM passages LIMIT 0`,
    `SELECT id, title, source_url, content_type, created_at FROM documents LIMIT 0`,
    `SELECT id, document_id, parent_section_id, title, level, order_index,
      created_at FROM document_sections LIMIT 0`,
    `SELECT id, source_id, target_id, type, reason, proposed_by, status,
      created_at, resolved_at FROM edge_proposals LIMIT 0`,
    `SELECT id, user_id, started_at, completed_at, tool_count FROM agent_runs LIMIT 0`,
    `SELECT id, run_id, tool_name, input_summary, output_summary, duration_ms,
      error, created_at FROM agent_events LIMIT 0`,
  ];

  try {
    for (const probe of probes) await db.prepare(probe).all();
  } catch (cause) {
    throw new Error("Database schema validation failed", { cause });
  }
}

async function bootstrapSystemOwner(env: Env): Promise<void> {
  let systemRow = await env.DB.prepare(
    `SELECT id FROM users WHERE username = '_system'`,
  ).first<{ id: string }>();

  if (!systemRow) {
    const systemId = crypto.randomUUID().replace(/-/g, "");
    const randomKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((byte) => byte.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 32);
    const keyHash = await hmacKey(randomKey, AUTH_PEPPER);
    await env.DB.prepare(
      `INSERT INTO users (
        id, username, normalized_username, auth_key_hash,
        auth_key_prefix, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'inactive', ?)
      ON CONFLICT(normalized_username) DO NOTHING`,
    ).bind(systemId, "_system", "_system", keyHash, "sb_system.", Date.now()).run();
    // Another isolate may have won the first-deploy race. Read the canonical
    // row instead of assuming this candidate was inserted.
    systemRow = await env.DB.prepare(
      `SELECT id FROM users WHERE username = '_system'`,
    ).first<{ id: string }>();
    if (!systemRow) throw new Error("System owner bootstrap did not create a user");
  }

  await env.DB.prepare(
    `UPDATE entries SET owner_user_id = ? WHERE owner_user_id = ''`,
  ).bind(systemRow.id).run();
  cachedSystemUserId = systemRow.id;
}

async function runInitialization(env: Env): Promise<void> {
  await ensureMigrationTable(env.DB);
  const applied = await readAppliedVersions(env.DB);

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      await applyMigration(env.DB, migration);
    }
  }

  await validateCurrentSchema(env.DB);
  await bootstrapSystemOwner(env);
}

// ─── Public database API ─────────────────────────────────────────────────────

export async function getSystemUserId(env: Env): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;
  const row = await env.DB.prepare(
    `SELECT id FROM users WHERE username = '_system'`,
  ).first<{ id: string }>();
  if (row) {
    cachedSystemUserId = row.id;
    return row.id;
  }
  // This path is only reachable before initialization. Callers retain their
  // legacy fallback, while normal request handling initializes first.
  return "_system";
}

export async function initializeDatabase(env: Env): Promise<void> {
  if (dbReady) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = runInitialization(env)
    .then(() => {
      dbReady = true;
    })
    .catch((error) => {
      dbReady = false;
      cachedSystemUserId = null;
      throw error;
    })
    .finally(() => {
      initializationPromise = null;
    });

  return initializationPromise;
}
