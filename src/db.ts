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

async function tableDefinition(db: D1Database, table: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).bind(table).first<{ sql: string | null }>();
  return row?.sql ?? null;
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
  {
    version: 4,
    name: "provenance_integrity",
    statements: async (db) => {
      const entries = await tableColumns(db, "entries");
      const episodes = await tableColumns(db, "episodes");
      const snapshots = await tableColumns(db, "entry_snapshots");
      const passages = await tableColumns(db, "passages");
      const documents = await tableColumns(db, "documents");
      const sections = await tableColumns(db, "document_sections");
      const statements: string[] = [];

      addColumnIfMissing(statements, entries, "entries", "current_episode_id", "TEXT");
      addColumnIfMissing(statements, entries, "entries", "revision", "INTEGER NOT NULL DEFAULT 0");

      addColumnIfMissing(statements, episodes, "episodes", "materialized_content", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, episodes, "episodes", "content_hash", "TEXT");
      addColumnIfMissing(statements, episodes, "episodes", "mutation_id", "TEXT");
      addColumnIfMissing(statements, episodes, "episodes", "mutation_kind", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, episodes, "episodes", "parent_episode_id", "TEXT");
      addColumnIfMissing(statements, episodes, "episodes", "restored_from_snapshot_id", "TEXT");
      addColumnIfMissing(statements, episodes, "episodes", "owner_user_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, episodes, "episodes", "source_url", "TEXT");

      addColumnIfMissing(statements, snapshots, "entry_snapshots", "episode_id", "TEXT");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "mutation_id", "TEXT");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "mutation_kind", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "recorded_at", "INTEGER");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "valid_from", "INTEGER");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "valid_to", "INTEGER");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "epistemic_status", "TEXT");
      addColumnIfMissing(statements, snapshots, "entry_snapshots", "revision", "INTEGER");

      addColumnIfMissing(statements, documents, "documents", "episode_id", "TEXT");
      addColumnIfMissing(statements, documents, "documents", "owner_user_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, documents, "documents", "content_hash", "TEXT");
      addColumnIfMissing(statements, documents, "documents", "version", "TEXT");

      addColumnIfMissing(statements, sections, "document_sections", "page_start", "INTEGER");
      addColumnIfMissing(statements, sections, "document_sections", "page_end", "INTEGER");
      addColumnIfMissing(statements, sections, "document_sections", "start_offset", "INTEGER");
      addColumnIfMissing(statements, sections, "document_sections", "end_offset", "INTEGER");

      addColumnIfMissing(statements, passages, "passages", "document_id", "TEXT");
      addColumnIfMissing(statements, passages, "passages", "section_id", "TEXT");
      addColumnIfMissing(statements, passages, "passages", "page_end", "INTEGER");

      // Existing episode content is the only safe materialized state available.
      // Legacy current_episode_id and semantic lineage remain NULL because the old
      // merge path cannot prove which episode represents the current entry.
      statements.push(
        `UPDATE episodes
         SET materialized_content = content
         WHERE materialized_content = ''`,
        `UPDATE episodes
         SET owner_user_id = COALESCE(
           (SELECT entries.owner_user_id FROM entries WHERE entries.id = episodes.entry_id),
           ''
         )
         WHERE owner_user_id = ''`,
        `CREATE INDEX IF NOT EXISTS idx_entries_current_episode ON entries(current_episode_id)`,
        `CREATE INDEX IF NOT EXISTS idx_episodes_parent ON episodes(parent_episode_id)`,
        `CREATE INDEX IF NOT EXISTS idx_episodes_owner ON episodes(owner_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_episodes_content_hash ON episodes(content_hash)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_entry_mutation
           ON episodes(entry_id, mutation_id) WHERE mutation_id IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_snapshots_episode ON entry_snapshots(episode_id)`,
        `CREATE INDEX IF NOT EXISTS idx_snapshots_transaction_time
           ON entry_snapshots(entry_id, recorded_at, created_at)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_entry_mutation
           ON entry_snapshots(entry_id, mutation_id) WHERE mutation_id IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_documents_episode ON documents(episode_id)`,
        `CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_passages_document ON passages(document_id)`,
        `CREATE INDEX IF NOT EXISTS idx_passages_section ON passages(section_id)`,
        `CREATE TABLE IF NOT EXISTS vector_cleanup_queue (
          id TEXT PRIMARY KEY,
          vector_ids TEXT NOT NULL,
          reason TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_vector_cleanup_retry
           ON vector_cleanup_queue(attempts, updated_at)`,
      );
      return statements;
    },
  },
  {
    version: 5,
    name: "team_tenancy",
    statements: async (db) => {
      const users = await tableColumns(db, "users");
      const entries = await tableColumns(db, "entries");
      const edgeProposals = await tableColumns(db, "edge_proposals");
      const edgeProposalDefinition = await tableDefinition(db, "edge_proposals");
      const statements: string[] = [];

      addColumnIfMissing(statements, users, "users", "role", "TEXT NOT NULL DEFAULT 'member'");

      addColumnIfMissing(statements, entries, "entries", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, entries, "entries", "visibility", "TEXT NOT NULL DEFAULT 'private'");
      addColumnIfMissing(statements, entries, "entries", "vector_sync_pending", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(statements, entries, "entries", "updated_at", "INTEGER NOT NULL DEFAULT 0");

      statements.push(
        `UPDATE entries
         SET created_by_user_id = owner_user_id
         WHERE created_by_user_id = ''`,
        // CASE evaluation is ordered in SQLite. Malformed JSON never reaches
        // json_type/json_each and therefore fails closed to private.
        `UPDATE entries
         SET visibility = CASE
           WHEN json_valid(tags) = 0 THEN 'private'
           WHEN json_type(tags) <> 'array' THEN 'private'
           WHEN EXISTS (
             SELECT 1 FROM json_each(entries.tags)
             WHERE json_each.type <> 'text'
           ) THEN 'private'
           WHEN EXISTS (
             SELECT 1 FROM json_each(entries.tags)
             WHERE json_each.type = 'text' AND json_each.value = 'private'
           ) THEN 'private'
           ELSE 'public'
         END`,
        `UPDATE entries
         SET updated_at = created_at
         WHERE updated_at = 0`,
        // Promote at most one deterministic bootstrap administrator. Existing
        // active administrators always win, and the inactive system principal
        // is never eligible.
        `UPDATE users
         SET role = 'admin'
         WHERE id = (
           SELECT id FROM users
           WHERE status = 'active' AND normalized_username <> '_system'
           ORDER BY created_at ASC, id ASC
           LIMIT 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM users
           WHERE status = 'active'
             AND normalized_username <> '_system'
             AND role = 'admin'
         )`,
        `CREATE INDEX IF NOT EXISTS idx_entries_owner_visibility_created
           ON entries(owner_user_id, visibility, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_entries_creator_created
           ON entries(created_by_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_users_role_status_created
           ON users(role, status, created_at)`,
        `CREATE TABLE IF NOT EXISTS user_deactivations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          requested_by_user_id TEXT NOT NULL,
          transfer_to_user_id TEXT,
          transfer_cursor TEXT,
          processed_entries INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          last_error TEXT,
          requested_at INTEGER NOT NULL,
          started_at INTEGER,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_user_deactivations_user_created
           ON user_deactivations(user_id, requested_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_user_deactivations_resume
           ON user_deactivations(status, updated_at)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_deactivations_active_user
           ON user_deactivations(user_id)
           WHERE status IN ('pending', 'running')`,
      );

      // Migration 3 encoded status into a table-level UNIQUE constraint. That
      // prevented a second historical rejection or approval forever. Rebuild
      // atomically only when that legacy definition is present; D1 batch()
      // rolls the table swap and the migration marker back together.
      const hasLegacyStatusUnique = Boolean(edgeProposalDefinition &&
        /UNIQUE\s*\(\s*source_id\s*,\s*target_id\s*,\s*type\s*,\s*status\s*\)/i.test(edgeProposalDefinition));

      if (hasLegacyStatusUnique) {
        const resolvedByProjection = edgeProposals.has("resolved_by") ? "resolved_by" : "NULL";
        statements.push(
          `DROP TABLE IF EXISTS edge_proposals_v5`,
          `CREATE TABLE edge_proposals_v5 (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'contradicts',
            reason TEXT NOT NULL DEFAULT '',
            proposed_by TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            resolved_at INTEGER,
            resolved_by TEXT
          )`,
          `INSERT INTO edge_proposals_v5 (
             id, source_id, target_id, type, reason, proposed_by, status,
             created_at, resolved_at, resolved_by
           )
           SELECT id, source_id, target_id, type, reason, proposed_by, status,
             created_at, resolved_at, ${resolvedByProjection}
           FROM edge_proposals`,
          `DROP TABLE edge_proposals`,
          `ALTER TABLE edge_proposals_v5 RENAME TO edge_proposals`,
        );
      } else {
        addColumnIfMissing(
          statements,
          edgeProposals,
          "edge_proposals",
          "resolved_by",
          "TEXT",
        );
      }

      statements.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_proposals_pending_unique
           ON edge_proposals(source_id, target_id, type)
           WHERE status = 'pending'`,
        `CREATE INDEX IF NOT EXISTS idx_edge_proposals_status_created
           ON edge_proposals(status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_edge_proposals_source_target
           ON edge_proposals(source_id, target_id)`,
      );

      return statements;
    },
  },
  {
    version: 6,
    name: "operator_governance",
    statements: async (db) => {
      const runs = await tableColumns(db, "agent_runs");
      const events = await tableColumns(db, "agent_events");
      const statements: string[] = [];

      addColumnIfMissing(statements, runs, "agent_runs", "actor_kind", "TEXT NOT NULL DEFAULT 'human'");
      addColumnIfMissing(statements, runs, "agent_runs", "actor_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, runs, "agent_runs", "service_identity_id", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "credential_id", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "auth_method", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, runs, "agent_runs", "autonomy_profile", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, runs, "agent_runs", "policy_version", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, runs, "agent_runs", "correlation_id", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "status", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, runs, "agent_runs", "policy_decision", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "requested_scopes", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(statements, runs, "agent_runs", "granted_scopes", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(statements, runs, "agent_runs", "decision_reason", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "proposal_id", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "target_ids", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(statements, runs, "agent_runs", "redacted_request_summary", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "request_hash", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "redacted_result_summary", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "result_hash", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "error_code", "TEXT");
      addColumnIfMissing(statements, runs, "agent_runs", "requested_at", "INTEGER");
      addColumnIfMissing(statements, runs, "agent_runs", "succeeded_at", "INTEGER");
      addColumnIfMissing(statements, runs, "agent_runs", "failed_at", "INTEGER");

      addColumnIfMissing(statements, events, "agent_events", "sequence", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(statements, events, "agent_events", "event_type", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, events, "agent_events", "actor_kind", "TEXT NOT NULL DEFAULT 'human'");
      addColumnIfMissing(statements, events, "agent_events", "actor_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(statements, events, "agent_events", "service_identity_id", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "credential_id", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "auth_method", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, events, "agent_events", "autonomy_profile", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, events, "agent_events", "policy_version", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, events, "agent_events", "correlation_id", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "status", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(statements, events, "agent_events", "policy_decision", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "requested_scopes", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(statements, events, "agent_events", "granted_scopes", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(statements, events, "agent_events", "decision_reason", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "proposal_id", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "target_ids", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(statements, events, "agent_events", "redacted_input_summary", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "redacted_output_summary", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "input_hash", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "output_hash", "TEXT");
      addColumnIfMissing(statements, events, "agent_events", "error_code", "TEXT");

      statements.push(
        `UPDATE agent_runs
         SET actor_id = user_id
         WHERE actor_id = ''`,
        `UPDATE agent_runs
         SET requested_at = started_at
         WHERE requested_at IS NULL`,
        `UPDATE agent_runs
         SET status = CASE
           WHEN completed_at IS NULL THEN 'started'
           ELSE 'succeeded'
         END
         WHERE status = 'legacy'`,
        `UPDATE agent_runs
         SET succeeded_at = completed_at
         WHERE succeeded_at IS NULL
           AND completed_at IS NOT NULL
           AND status = 'succeeded'`,
        // Assign deterministic per-run ordering to legacy rows. New governed
        // writers provide an explicit sequence; the old audit writer remains
        // compatible via the zero default during the transition.
        `UPDATE agent_events AS current
         SET sequence = (
           SELECT COUNT(*) FROM agent_events AS prior
           WHERE prior.run_id = current.run_id
             AND (
               prior.created_at < current.created_at
               OR (prior.created_at = current.created_at AND prior.id <= current.id)
             )
         )
         WHERE sequence = 0`,
        `UPDATE agent_events
         SET event_type = CASE
           WHEN error IS NULL THEN 'succeeded'
           ELSE 'failed'
         END,
         status = CASE
           WHEN error IS NULL THEN 'succeeded'
           ELSE 'failed'
         END
         WHERE event_type = 'legacy' OR status = 'legacy'`,
        `UPDATE agent_events
         SET actor_kind = COALESCE(
           (SELECT agent_runs.actor_kind FROM agent_runs WHERE agent_runs.id = agent_events.run_id),
           'human'
         ),
         actor_id = COALESCE(
           (SELECT agent_runs.actor_id FROM agent_runs WHERE agent_runs.id = agent_events.run_id),
           ''
         ),
         auth_method = COALESCE(
           (SELECT agent_runs.auth_method FROM agent_runs WHERE agent_runs.id = agent_events.run_id),
           'legacy'
         ),
         autonomy_profile = COALESCE(
           (SELECT agent_runs.autonomy_profile FROM agent_runs WHERE agent_runs.id = agent_events.run_id),
           'legacy'
         ),
         policy_version = COALESCE(
           (SELECT agent_runs.policy_version FROM agent_runs WHERE agent_runs.id = agent_events.run_id),
           'legacy'
         )
         WHERE actor_id = ''`,
        `CREATE TABLE IF NOT EXISTS service_identities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          owner_user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          default_autonomy_profile TEXT NOT NULL DEFAULT 'observe',
          created_by_user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          revoked_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_service_identities_owner_status
           ON service_identities(owner_user_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_service_identities_status_updated
           ON service_identities(status, updated_at)`,
        `CREATE TABLE IF NOT EXISTS service_credentials (
          id TEXT PRIMARY KEY,
          service_identity_id TEXT NOT NULL,
          credential_hash TEXT NOT NULL UNIQUE,
          credential_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          expires_at INTEGER,
          last_used_at INTEGER,
          use_count INTEGER NOT NULL DEFAULT 0,
          last_used_metadata TEXT,
          rotated_from_credential_id TEXT,
          created_by_user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER,
          revoked_by_user_id TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_service_credentials_service_status
           ON service_credentials(service_identity_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_service_credentials_prefix
           ON service_credentials(credential_prefix)`,
        `CREATE INDEX IF NOT EXISTS idx_service_credentials_expiry
           ON service_credentials(status, expires_at)`,
        `CREATE TABLE IF NOT EXISTS security_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          actor_kind TEXT,
          actor_id TEXT,
          service_identity_id TEXT,
          credential_id TEXT,
          auth_method TEXT,
          correlation_id TEXT,
          source_ip_hash TEXT,
          user_agent_hash TEXT,
          reason TEXT NOT NULL,
          error_code TEXT,
          redacted_summary TEXT,
          summary_hash TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_security_events_created
           ON security_events(created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_security_events_actor
           ON security_events(actor_kind, actor_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_security_events_correlation
           ON security_events(correlation_id)`,
        `CREATE TABLE IF NOT EXISTS action_proposals (
          id TEXT PRIMARY KEY,
          action_type TEXT NOT NULL,
          proposer_kind TEXT NOT NULL,
          proposer_id TEXT NOT NULL,
          visibility_scope TEXT NOT NULL DEFAULT 'private',
          payload_json TEXT NOT NULL,
          payload_hash TEXT,
          target_ids TEXT NOT NULL DEFAULT '[]',
          expected_preconditions TEXT NOT NULL DEFAULT '{}',
          expected_revision INTEGER,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'executing', 'executed', 'rejected', 'failed', 'stale', 'expired')),
          risk_level TEXT NOT NULL DEFAULT 'medium',
          reason TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          autonomy_profile TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          expires_at INTEGER,
          reviewer_kind TEXT,
          reviewer_id TEXT,
          review_reason TEXT,
          reviewed_at INTEGER,
          executor_kind TEXT,
          executor_id TEXT,
          execution_started_at INTEGER,
          executed_at INTEGER,
          rejected_at INTEGER,
          failed_at INTEGER,
          stale_at INTEGER,
          expired_at INTEGER,
          result_json TEXT,
          result_hash TEXT,
          error_code TEXT,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_action_proposals_status_created
           ON action_proposals(status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_action_proposals_proposer
           ON action_proposals(proposer_kind, proposer_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_action_proposals_action_status
           ON action_proposals(action_type, status, updated_at)`,
        `CREATE INDEX IF NOT EXISTS idx_action_proposals_expiry
           ON action_proposals(status, expires_at)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_action_proposals_idempotency
           ON action_proposals(idempotency_key)`,
        `CREATE TABLE IF NOT EXISTS proposal_events (
          id TEXT PRIMARY KEY,
          proposal_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          actor_kind TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          data_json TEXT NOT NULL DEFAULT '{}',
          data_hash TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_events_sequence
           ON proposal_events(proposal_id, sequence)`,
        `CREATE INDEX IF NOT EXISTS idx_proposal_events_proposal_created
           ON proposal_events(proposal_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_proposal_events_type_created
           ON proposal_events(event_type, created_at DESC)`,
        // Legacy edge proposals remain authoritative for old REST/MCP handlers.
        // The generic proposal uses a namespaced deterministic identity and a
        // null payload hash to make clear that pre-v6 payloads were not hashed.
        `INSERT OR IGNORE INTO action_proposals (
           id, action_type, proposer_kind, proposer_id, visibility_scope,
           payload_json, payload_hash, target_ids, expected_preconditions,
           expected_revision, status, risk_level, reason, evidence_json,
           autonomy_profile, policy_version, idempotency_key, expires_at,
           reviewer_kind, reviewer_id, reviewed_at, executed_at, rejected_at,
           failed_at, created_at, updated_at
         )
         SELECT
           'legacy-edge:' || ep.id,
           'edge.publish',
           CASE
             WHEN ep.proposed_by = '' OR substr(ep.proposed_by, 1, 1) = '_' THEN 'system'
             ELSE 'human'
           END,
           CASE WHEN ep.proposed_by = '' THEN '_legacy_unknown' ELSE ep.proposed_by END,
           CASE
             WHEN source.visibility = 'public' AND target.visibility = 'public' THEN 'team'
             ELSE 'private'
           END,
           json_object(
             'edge_type', ep.type,
             'source_id', ep.source_id,
             'target_id', ep.target_id,
             'reason', ep.reason
           ),
           NULL,
           json_array(ep.source_id, ep.target_id),
           json_object('legacy_edge_proposal_id', ep.id, 'legacy_status', ep.status),
           NULL,
           CASE ep.status
             WHEN 'pending' THEN 'pending'
             WHEN 'approved' THEN 'executed'
             WHEN 'rejected' THEN 'rejected'
             ELSE 'failed'
           END,
           'medium',
           CASE WHEN ep.reason = '' THEN 'Migrated legacy edge proposal' ELSE ep.reason END,
           json_array(json_object('kind', 'legacy_edge_proposal', 'id', ep.id)),
           'legacy',
           'legacy-v5',
           'legacy-edge-proposal:' || ep.id,
           NULL,
           CASE WHEN ep.resolved_by IS NULL THEN NULL ELSE 'human' END,
           ep.resolved_by,
           ep.resolved_at,
           CASE WHEN ep.status = 'approved' THEN ep.resolved_at ELSE NULL END,
           CASE WHEN ep.status = 'rejected' THEN ep.resolved_at ELSE NULL END,
           CASE WHEN ep.status NOT IN ('pending', 'approved', 'rejected') THEN ep.resolved_at ELSE NULL END,
           ep.created_at,
           COALESCE(ep.resolved_at, ep.created_at)
         FROM edge_proposals AS ep
         LEFT JOIN entries AS source ON source.id = ep.source_id
         LEFT JOIN entries AS target ON target.id = ep.target_id`,
        `INSERT OR IGNORE INTO proposal_events (
           id, proposal_id, sequence, event_type, actor_kind, actor_id,
           data_json, data_hash, created_at
         )
         SELECT
           'legacy-edge-event-created:' || ep.id,
           'legacy-edge:' || ep.id,
           1,
           'migrated',
           'system',
           '_migration_v6',
           json_object('legacy_status', ep.status),
           NULL,
           ep.created_at
         FROM edge_proposals AS ep`,
        `INSERT OR IGNORE INTO proposal_events (
           id, proposal_id, sequence, event_type, actor_kind, actor_id,
           data_json, data_hash, created_at
         )
         SELECT
           'legacy-edge-event-resolved:' || ep.id,
           'legacy-edge:' || ep.id,
           2,
           CASE ep.status
             WHEN 'approved' THEN 'executed'
             WHEN 'rejected' THEN 'rejected'
             ELSE 'failed'
           END,
           CASE WHEN ep.resolved_by IS NULL THEN 'system' ELSE 'human' END,
           COALESCE(ep.resolved_by, '_legacy_unknown'),
           json_object('legacy_status', ep.status),
           NULL,
           COALESCE(ep.resolved_at, ep.created_at)
         FROM edge_proposals AS ep
         WHERE ep.status <> 'pending'`,
        `CREATE TRIGGER IF NOT EXISTS proposal_events_no_update
           BEFORE UPDATE ON proposal_events
           BEGIN
             SELECT RAISE(ABORT, 'proposal_events are append-only');
           END`,
        `CREATE TRIGGER IF NOT EXISTS proposal_events_no_delete
           BEFORE DELETE ON proposal_events
           BEGIN
             SELECT RAISE(ABORT, 'proposal_events are append-only');
           END`,
        `CREATE INDEX IF NOT EXISTS idx_agent_runs_actor_started
           ON agent_runs(actor_kind, actor_id, started_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_runs_service_started
           ON agent_runs(service_identity_id, started_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started
           ON agent_runs(status, started_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_runs_correlation
           ON agent_runs(correlation_id)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_events_run_sequence
           ON agent_events(run_id, sequence, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_events_actor_created
           ON agent_events(actor_kind, actor_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_events_event_created
           ON agent_events(event_type, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_events_proposal
           ON agent_events(proposal_id)`,
      );

      return statements;
    },
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
      epistemic_status, current_episode_id, revision, created_by_user_id,
      visibility, vector_sync_pending, updated_at FROM entries LIMIT 0`,
    `SELECT id, source_id, target_id, type, weight, provenance, metadata,
      confidence, created_at, updated_at FROM edges LIMIT 0`,
    `SELECT id, username, normalized_username, auth_key_hash, auth_key_prefix,
      status, created_at, last_used_at, role FROM users LIMIT 0`,
    `SELECT id, entry_id, content, content_type, source, created_at,
      materialized_content, content_hash, mutation_id, mutation_kind,
      parent_episode_id, restored_from_snapshot_id, owner_user_id, source_url
      FROM episodes LIMIT 0`,
    `SELECT id, entry_id, content, tags, source, created_at, episode_id,
      mutation_id, mutation_kind, recorded_at, valid_from, valid_to,
      epistemic_status, revision FROM entry_snapshots LIMIT 0`,
    `SELECT id, entry_id, episode_id, document_id, section_id, content,
      section, page, page_end, start_offset, end_offset, vector_ids, created_at
      FROM passages LIMIT 0`,
    `SELECT id, title, source_url, content_type, created_at, episode_id,
      owner_user_id, content_hash, version FROM documents LIMIT 0`,
    `SELECT id, document_id, parent_section_id, title, level, order_index,
      created_at, page_start, page_end, start_offset, end_offset
      FROM document_sections LIMIT 0`,
    `SELECT id, source_id, target_id, type, reason, proposed_by, status,
      created_at, resolved_at, resolved_by FROM edge_proposals LIMIT 0`,
    `SELECT id, user_id, requested_by_user_id, transfer_to_user_id,
      transfer_cursor, processed_entries, status, last_error, requested_at,
      started_at, updated_at, completed_at FROM user_deactivations LIMIT 0`,
    `SELECT id, user_id, started_at, completed_at, tool_count, actor_kind,
      actor_id, service_identity_id, credential_id, auth_method,
      autonomy_profile, policy_version, correlation_id, status,
      policy_decision, requested_scopes, granted_scopes, decision_reason,
      proposal_id, target_ids, redacted_request_summary, request_hash,
      redacted_result_summary, result_hash, error_code, requested_at,
      succeeded_at, failed_at
      FROM agent_runs LIMIT 0`,
    `SELECT id, run_id, tool_name, input_summary, output_summary, duration_ms,
      error, created_at, sequence, event_type, actor_kind, actor_id,
      service_identity_id, credential_id, auth_method, autonomy_profile,
      policy_version, correlation_id, status, policy_decision,
      requested_scopes, granted_scopes, decision_reason, proposal_id,
      target_ids, redacted_input_summary, redacted_output_summary, input_hash,
      output_hash, error_code FROM agent_events LIMIT 0`,
    `SELECT id, name, description, owner_user_id, status,
      default_autonomy_profile, created_by_user_id, created_at, updated_at,
      revoked_at FROM service_identities LIMIT 0`,
    `SELECT id, service_identity_id, credential_hash, credential_prefix,
      scopes, status, expires_at, last_used_at, use_count, last_used_metadata,
      rotated_from_credential_id, created_by_user_id, created_at, revoked_at,
      revoked_by_user_id FROM service_credentials LIMIT 0`,
    `SELECT id, event_type, actor_kind, actor_id, service_identity_id,
      credential_id, auth_method, correlation_id, source_ip_hash,
      user_agent_hash, reason, error_code, redacted_summary, summary_hash,
      metadata, created_at FROM security_events LIMIT 0`,
    `SELECT id, action_type, proposer_kind, proposer_id, visibility_scope,
      payload_json, payload_hash, target_ids, expected_preconditions,
      expected_revision, status, risk_level, reason, evidence_json,
      autonomy_profile, policy_version, idempotency_key, expires_at,
      reviewer_kind, reviewer_id, review_reason, reviewed_at, executor_kind,
      executor_id, execution_started_at, executed_at, rejected_at, failed_at,
      stale_at, expired_at, result_json, result_hash, error_code,
      error_message, created_at, updated_at FROM action_proposals LIMIT 0`,
    `SELECT id, proposal_id, sequence, event_type, actor_kind, actor_id,
      data_json, data_hash, created_at FROM proposal_events LIMIT 0`,
    `SELECT id, vector_ids, reason, attempts, last_error, created_at, updated_at
      FROM vector_cleanup_queue LIMIT 0`,
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
    `UPDATE entries
     SET owner_user_id = ?,
       created_by_user_id = CASE
         WHEN created_by_user_id = '' THEN ?
         ELSE created_by_user_id
       END
     WHERE owner_user_id = ''`,
  ).bind(systemRow.id, systemRow.id).run();
  cachedSystemUserId = systemRow.id;
}

async function bootstrapTeamAdmin(env: Env): Promise<void> {
  // This remains safe on every cold start: an existing active administrator
  // prevents mutation, and otherwise exactly the earliest active non-system
  // account is promoted. The deterministic id tie-break handles old imports
  // whose timestamps have only second-level precision.
  await env.DB.prepare(
    `UPDATE users
     SET role = 'admin'
     WHERE id = (
       SELECT id FROM users
       WHERE status = 'active' AND normalized_username <> '_system'
       ORDER BY created_at ASC, id ASC
       LIMIT 1
     )
     AND NOT EXISTS (
       SELECT 1 FROM users
       WHERE status = 'active'
         AND normalized_username <> '_system'
         AND role = 'admin'
     )`,
  ).run();
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
  await bootstrapTeamAdmin(env);
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
