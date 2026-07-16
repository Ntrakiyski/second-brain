import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  _resetDbReady,
  getDbReady,
  initializeDatabase,
} from "../../src/db";
import type { Env } from "../../src/types";

const schemaSnapshot = readFileSync(
  resolve(process.cwd(), "db/schema.sql"),
  "utf8",
);

class SqliteD1Statement {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.owner, this.sql, values);
  }

  async run(): Promise<any> {
    this.owner.beforeExecute(this.sql);
    const result = this.owner.sqlite
      .prepare(this.sql)
      .run(...this.values as SQLInputValue[]);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }

  async all<T = Record<string, unknown>>(): Promise<any> {
    this.owner.beforeExecute(this.sql);
    const results = this.owner.sqlite
      .prepare(this.sql)
      .all(...this.values as SQLInputValue[]) as T[];
    return { success: true, results, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    this.owner.beforeExecute(this.sql);
    const row = this.owner.sqlite
      .prepare(this.sql)
      .get(...this.values as SQLInputValue[]) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly executedSql: string[] = [];
  failOn: RegExp | null = null;

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this, sql);
  }

  async exec(sql: string): Promise<any> {
    this.beforeExecute(sql);
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  async batch(statements: SqliteD1Statement[]): Promise<any[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: any[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  beforeExecute(sql: string): void {
    this.executedSql.push(sql.replace(/\s+/g, " ").trim());
    if (this.failOn?.test(sql)) throw new Error(`Injected D1 failure for: ${sql}`);
  }

  columns(table: string): string[] {
    return (this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((row) => row.name);
  }

  versions(): number[] {
    return (this.sqlite.prepare(
      `SELECT version FROM schema_migrations ORDER BY version`,
    ).all() as { version: number }[]).map((row) => Number(row.version));
  }

  schemaSignature(): unknown {
    const tables = (this.sqlite.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all() as { name: string }[]).map((row) => row.name);
    const columns = Object.fromEntries(tables.map((table) => [
      table,
      (this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[])
        .map((column) => ({
          name: column.name,
          type: column.type,
          notnull: Number(column.notnull),
          default: column.dflt_value,
          primaryKey: Number(column.pk),
        }))
        .sort((left, right) => String(left.name).localeCompare(String(right.name))),
    ]));
    const indexes = (this.sqlite.prepare(
      `SELECT name, tbl_name AS tableName, sql FROM sqlite_master
       WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
       ORDER BY name`,
    ).all() as Record<string, unknown>[]);
    return { tables, columns, indexes };
  }

  close(): void { this.sqlite.close(); }
}

function makeEnv(db: SqliteD1): Env {
  return { DB: db as unknown as D1Database } as Env;
}

describe("ordered database migrations", () => {
  let db: SqliteD1;

  beforeEach(() => {
    _resetDbReady();
    db = new SqliteD1();
  });

  afterEach(() => {
    _resetDbReady();
    db.close();
  });

  it("builds a fresh database in order and only becomes ready after success", async () => {
    await initializeDatabase(makeEnv(db));

    expect(getDbReady()).toBe(true);
    expect(db.versions()).toEqual([1, 2, 3]);
    expect(db.columns("entries")).toEqual(expect.arrayContaining([
      "owner_user_id",
      "retention_score",
      "last_recalled_at",
      "valid_from",
      "valid_to",
      "recorded_at",
      "epistemic_status",
    ]));
    expect(db.columns("edges")).toContain("confidence");

    const ownerColumn = db.executedSql.findIndex((statement) =>
      statement.startsWith("ALTER TABLE entries ADD COLUMN owner_user_id"));
    const ownerIndex = db.executedSql.findIndex((statement) =>
      statement.startsWith("CREATE INDEX IF NOT EXISTS idx_entries_owner"));
    expect(ownerColumn).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(ownerColumn);

    const tables = db.sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ).all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      "entries",
      "edges",
      "users",
      "episodes",
      "entry_snapshots",
      "passages",
      "documents",
      "document_sections",
      "edge_proposals",
      "agent_runs",
      "agent_events",
    ]));
  });

  it("keeps schema.sql compatible with runtime-owned migration records", async () => {
    db.sqlite.exec(schemaSnapshot);

    expect(db.versions()).toEqual([]);
    await initializeDatabase(makeEnv(db));

    expect(db.versions()).toEqual([1, 2, 3]);
    expect(db.sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_entries_owner'`,
    ).get()).toMatchObject({ name: "idx_entries_owner" });
  });

  it("converges to the same tables, columns, and indexes from both bootstrap paths", async () => {
    await initializeDatabase(makeEnv(db));
    const runtimeSignature = db.schemaSignature();

    const snapshotDb = new SqliteD1();
    try {
      snapshotDb.sqlite.exec(schemaSnapshot);
      _resetDbReady();
      await initializeDatabase(makeEnv(snapshotDb));
      expect(snapshotDb.schemaSignature()).toEqual(runtimeSignature);
    } finally {
      snapshotDb.close();
    }
  });

  it("upgrades the pre-owner legacy schema without losing existing data", async () => {
    db.sqlite.exec(`
      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'api',
        created_at INTEGER NOT NULL,
        vector_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE edges (
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
      );
      INSERT INTO entries (id, content, tags, source, created_at, vector_ids)
      VALUES ('legacy-1', 'preserve me', '[]', 'api', 1000, '[]');
    `);
    // The operator-facing schema command must also be safe against legacy
    // tables; runtime migrations remain responsible for adding columns.
    db.sqlite.exec(schemaSnapshot);

    await initializeDatabase(makeEnv(db));

    const legacy = db.sqlite.prepare(
      `SELECT content, owner_user_id, retention_score, epistemic_status
       FROM entries WHERE id = 'legacy-1'`,
    ).get() as Record<string, unknown>;
    const system = db.sqlite.prepare(
      `SELECT id, status FROM users WHERE username = '_system'`,
    ).get() as Record<string, unknown>;

    expect(legacy).toMatchObject({
      content: "preserve me",
      owner_user_id: system.id,
      retention_score: 1,
      epistemic_status: "canonical",
    });
    expect(system.status).toBe("inactive");
    expect(db.columns("edges")).toContain("confidence");
    expect(db.versions()).toEqual([1, 2, 3]);

    _resetDbReady();
    await initializeDatabase(makeEnv(db));
    expect(db.versions()).toEqual([1, 2, 3]);
    expect(db.sqlite.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE username = '_system'`,
    ).get()).toMatchObject({ count: 1 });
  });

  it("propagates migration failure, rolls back its version, and permits retry", async () => {
    db.failOn = /CREATE INDEX IF NOT EXISTS idx_entries_owner/;

    await expect(initializeDatabase(makeEnv(db))).rejects.toThrow(
      "Database migration 2 (entry_and_edge_features) failed",
    );

    expect(getDbReady()).toBe(false);
    expect(db.versions()).toEqual([1]);
    expect(db.columns("entries")).not.toContain("owner_user_id");

    db.failOn = null;
    await initializeDatabase(makeEnv(db));

    expect(getDbReady()).toBe(true);
    expect(db.versions()).toEqual([1, 2, 3]);
    expect(db.columns("entries")).toContain("owner_user_id");
  });

  it("fails closed when migration history is unknown or inconsistent", async () => {
    db.sqlite.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations VALUES (2, 'entry_and_edge_features', 1);
    `);

    await expect(initializeDatabase(makeEnv(db))).rejects.toThrow(
      "Database migration history is not contiguous",
    );
    expect(getDbReady()).toBe(false);
  });

  it("does not trust version rows when the physical schema is incomplete", async () => {
    db.sqlite.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations VALUES (1, 'core_tables', 1);
      INSERT INTO schema_migrations VALUES (2, 'entry_and_edge_features', 1);
      INSERT INTO schema_migrations VALUES (3, 'memory_and_operator_tables', 1);
      CREATE TABLE entries (id TEXT PRIMARY KEY, content TEXT NOT NULL);
    `);

    await expect(initializeDatabase(makeEnv(db))).rejects.toThrow(
      "Database schema validation failed",
    );
    expect(getDbReady()).toBe(false);
  });
});
