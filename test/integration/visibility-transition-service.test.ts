import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  setEntryVisibility,
  type EntryVisibility,
} from "../../src/visibility";
import { recallEntries } from "../../src/recall";
import type { Env } from "../../src/types";
import { makeAIMock, makeKVMock } from "../helpers/make-env";

const schema = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");

class SqliteStatement {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.owner, this.sql, values);
  }

  async run(): Promise<any> {
    this.owner.executed.push(this.sql.replace(/\s+/g, " ").trim());
    const result = this.owner.sqlite
      .prepare(this.sql)
      .run(...this.values as SQLInputValue[]);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }

  async all<T = Record<string, unknown>>(): Promise<any> {
    const results = this.owner.sqlite
      .prepare(this.sql)
      .all(...this.values as SQLInputValue[]) as T[];
    return { success: true, results, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = this.owner.sqlite
      .prepare(this.sql)
      .get(...this.values as SQLInputValue[]) as Record<string, unknown> | undefined;
    if (!result) return null;
    return (column ? result[column] : result) as T;
  }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly executed: string[] = [];

  constructor() {
    this.sqlite.exec(schema);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql);
  }

  async batch(statements: SqliteStatement[]): Promise<any[]> {
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

  close(): void {
    this.sqlite.close();
  }
}

interface TestVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

interface Harness {
  db: SqliteD1;
  env: Env;
  vectors: Map<string, TestVector>;
  getByIds: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const db = new SqliteD1();
  const vectors = new Map<string, TestVector>();
  const getByIds = vi.fn(async (ids: string[]) =>
    ids.flatMap(id => {
      const vector = vectors.get(id);
      return vector ? [structuredClone(vector)] : [];
    }));
  const upsert = vi.fn(async (items: TestVector[]) => {
    for (const item of items) vectors.set(item.id, structuredClone(item));
    return { mutationId: "visibility-upsert" };
  });
  const env = {
    DB: db as unknown as D1Database,
    VECTORIZE: {
      getByIds,
      upsert,
      insert: vi.fn(),
      deleteByIds: vi.fn(),
      query: vi.fn().mockResolvedValue({ matches: [] }),
      describe: vi.fn(),
    } as unknown as VectorizeIndex,
    AI: makeAIMock(),
    AUTH_TOKEN: "test-token",
    OAUTH_KV: makeKVMock(),
  } as Env;
  return { db, env, vectors, getByIds, upsert };
}

function one<T>(db: SqliteD1, sql: string, ...values: SQLInputValue[]): T {
  return db.sqlite.prepare(sql).get(...values) as T;
}

function seedEntry(
  harness: Harness,
  visibility: EntryVisibility,
  tags = visibility === "private" ? ["work", "private"] : ["work"],
): void {
  harness.db.sqlite.prepare(
    `INSERT INTO entries (
       id, content, tags, source, created_at, vector_ids, owner_user_id,
       current_episode_id, revision, created_by_user_id, visibility,
       vector_sync_pending, valid_from, recorded_at, epistemic_status, updated_at
     ) VALUES (?, ?, ?, 'api', 100, ?, ?, ?, 1, ?, ?, 0, 10, 100,
               'canonical', 100)`,
  ).run(
    "entry-1",
    "Visibility-sensitive memory",
    JSON.stringify(tags),
    JSON.stringify(["ev-current"]),
    "user-owner",
    "episode-current",
    "user-owner",
    visibility,
  );

  harness.db.sqlite.prepare(
    `INSERT INTO passages (
       id, entry_id, episode_id, content, vector_ids, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "passage-current",
    "entry-1",
    "episode-current",
    "Current passage",
    JSON.stringify(["pv-current"]),
    100,
  );
  harness.db.sqlite.prepare(
    `INSERT INTO passages (
       id, entry_id, episode_id, content, vector_ids, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "passage-old",
    "entry-1",
    "episode-old",
    "Historical passage",
    JSON.stringify(["pv-old"]),
    90,
  );

  for (const id of ["ev-current", "pv-current", "pv-old"]) {
    harness.vectors.set(id, {
      id,
      values: [0.1, 0.2],
      metadata: {
        owner_user_id: "user-owner",
        is_private: visibility === "private",
        preserved: `metadata-${id}`,
      },
    });
  }
}

async function recallAt(
  harness: Harness,
  userId: string,
  knownAt: number,
  asOf: number,
) {
  return recallEntries(
    {
      query: "visibility sensitive memory",
      topK: 5,
      userId,
      knownAt,
      asOf,
    },
    harness.env,
    { waitUntil: vi.fn() } as unknown as ExecutionContext,
  );
}

function seedRelationships(harness: Harness): void {
  harness.db.sqlite.prepare(
    `INSERT INTO entries (
       id, content, tags, source, created_at, vector_ids, owner_user_id,
       created_by_user_id, visibility, updated_at
     ) VALUES ('entry-2', 'Related', '[]', 'api', 100, '[]',
               'user-owner', 'user-owner', 'public', 100)`,
  ).run();
  harness.db.sqlite.prepare(
    `INSERT INTO entries (
       id, content, tags, source, created_at, vector_ids, owner_user_id,
       created_by_user_id, visibility, updated_at
     ) VALUES ('entry-3', 'Unrelated', '[]', 'api', 100, '[]',
               'user-owner', 'user-owner', 'public', 100)`,
  ).run();

  harness.db.sqlite.prepare(
    `INSERT INTO edges
       (id, source_id, target_id, type, created_at, updated_at)
     VALUES ('edge-touching', 'entry-1', 'entry-2', 'relates_to', 100, 100),
            ('edge-unrelated', 'entry-2', 'entry-3', 'relates_to', 100, 100)`,
  ).run();
  harness.db.sqlite.prepare(
    `INSERT INTO edge_proposals
       (id, source_id, target_id, type, reason, proposed_by, status, created_at)
     VALUES ('edge-proposal-touching', 'entry-2', 'entry-1', 'contradicts',
             'touching', 'user-owner', 'pending', 100),
            ('edge-proposal-unrelated', 'entry-2', 'entry-3', 'contradicts',
             'unrelated', 'user-owner', 'pending', 100)`,
  ).run();
  harness.db.sqlite.prepare(
    `INSERT INTO action_proposals (
       id, action_type, proposer_kind, proposer_id, visibility_scope,
       payload_json, target_ids, expected_preconditions, status, risk_level,
       reason, evidence_json, autonomy_profile, policy_version,
       idempotency_key, created_at, updated_at
     ) VALUES (
       'action-proposal-touching', 'entry.update', 'service', 'svc-hermes',
       'private', '{}', '["entry-1"]', '{}', 'pending', 'medium',
       'touching', '[]', 'safe', 'v1', 'idem-touching', 100, 100
     ), (
       'action-proposal-unrelated', 'entry.update', 'service', 'svc-hermes',
       'private', '{}', '["entry-2"]', '{}', 'pending', 'medium',
       'unrelated', '[]', 'safe', 'v1', 'idem-unrelated', 100, 100
     )`,
  ).run();
}

describe("setEntryVisibility", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    harness.db.close();
  });

  it("allows only the entry owner to change visibility", async () => {
    seedEntry(harness, "public");

    await expect(setEntryVisibility(
      "entry-1",
      "user-other",
      "private",
      harness.env,
    )).rejects.toMatchObject({
      code: "not_owner",
    });

    expect(one<any>(harness.db, "SELECT visibility, tags, vector_sync_pending FROM entries WHERE id = 'entry-1'"))
      .toMatchObject({ visibility: "public", tags: '["work"]', vector_sync_pending: 0 });
    expect(harness.getByIds).not.toHaveBeenCalled();
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  it("commits public-to-private in D1 first and remains fail-closed for retry after vector failure", async () => {
    seedEntry(harness, "public", ["work", "work"]);
    seedRelationships(harness);
    const observedDuringUpsert: Record<string, unknown>[] = [];
    harness.upsert.mockImplementationOnce(async () => {
      observedDuringUpsert.push(one<any>(
        harness.db,
        `SELECT visibility, tags, vector_sync_pending FROM entries WHERE id = 'entry-1'`,
      ));
      throw new Error("injected Vectorize outage");
    });

    await expect(setEntryVisibility(
      "entry-1",
      "user-owner",
      "private",
      harness.env,
    )).rejects.toMatchObject({
      code: "vector_sync_failed",
    });

    expect(observedDuringUpsert).toEqual([{
      visibility: "private",
      tags: '["work","private"]',
      vector_sync_pending: 1,
    }]);
    expect(one<any>(harness.db, "SELECT visibility, tags, vector_sync_pending FROM entries WHERE id = 'entry-1'"))
      .toMatchObject({
        visibility: "private",
        tags: '["work","private"]',
        vector_sync_pending: 1,
      });

    const retry = await setEntryVisibility(
      "entry-1",
      "user-owner",
      "private",
      harness.env,
    );
    expect(retry).toEqual({
      entryId: "entry-1",
      visibility: "private",
      changed: false,
      vectorSyncPending: false,
    });
    expect(one<any>(harness.db, "SELECT vector_sync_pending FROM entries WHERE id = 'entry-1'"))
      .toMatchObject({ vector_sync_pending: 0 });
  });

  it("keeps D1 private until private-to-public vector metadata is safely rewritten", async () => {
    seedEntry(harness, "private");
    seedRelationships(harness);
    const observedDuringUpsert: Record<string, unknown>[] = [];
    harness.upsert.mockImplementationOnce(async (items: TestVector[]) => {
      observedDuringUpsert.push({
        ...one<any>(
          harness.db,
          `SELECT visibility, tags, vector_sync_pending FROM entries WHERE id = 'entry-1'`,
        ),
        touchingEdgeCount: one<{ count: number }>(
          harness.db,
          `SELECT COUNT(*) AS count FROM edges WHERE id = 'edge-touching'`,
        ).count,
      });
      for (const item of items) harness.vectors.set(item.id, structuredClone(item));
      return { mutationId: "visibility-upsert" };
    });

    const result = await setEntryVisibility(
      "entry-1",
      "user-owner",
      "public",
      harness.env,
    );

    expect(observedDuringUpsert).toEqual([{
      visibility: "private",
      tags: '["work","private"]',
      vector_sync_pending: 1,
      touchingEdgeCount: 1,
    }]);
    expect(result).toEqual({
      entryId: "entry-1",
      visibility: "public",
      changed: true,
      vectorSyncPending: false,
    });
    expect(one<any>(harness.db, "SELECT visibility, tags, vector_sync_pending FROM entries WHERE id = 'entry-1'"))
      .toMatchObject({ visibility: "public", tags: '["work"]', vector_sync_pending: 0 });
  });

  it("rewrites entry and current-passage metadata while preserving metadata and historical vectors", async () => {
    seedEntry(harness, "public");

    await setEntryVisibility("entry-1", "user-owner", "private", harness.env);

    expect(harness.getByIds).toHaveBeenCalledWith(["ev-current", "pv-current"]);
    expect(harness.upsert).toHaveBeenCalledTimes(1);
    expect((harness.upsert.mock.calls[0][0] as TestVector[]).map(vector => vector.id))
      .toEqual(["ev-current", "pv-current"]);
    expect(harness.vectors.get("ev-current")?.metadata).toMatchObject({
      owner_user_id: "user-owner",
      is_private: true,
      preserved: "metadata-ev-current",
    });
    expect(harness.vectors.get("pv-current")?.metadata).toMatchObject({
      owner_user_id: "user-owner",
      is_private: true,
      preserved: "metadata-pv-current",
    });
    expect(harness.vectors.get("pv-old")?.metadata).toMatchObject({
      is_private: false,
      preserved: "metadata-pv-old",
    });
  });

  it("snapshots each user-visible visibility transition and advances revision once", async () => {
    seedEntry(harness, "public");

    await setEntryVisibility("entry-1", "user-owner", "private", harness.env);
    expect(one<any>(
      harness.db,
      "SELECT visibility, tags, revision FROM entries WHERE id = 'entry-1'",
    )).toEqual({ visibility: "private", tags: '["work","private"]', revision: 2 });

    await setEntryVisibility("entry-1", "user-owner", "public", harness.env);
    expect(one<any>(
      harness.db,
      "SELECT visibility, tags, revision FROM entries WHERE id = 'entry-1'",
    )).toEqual({ visibility: "public", tags: '["work"]', revision: 3 });

    const snapshots = harness.db.sqlite.prepare(
      `SELECT tags, mutation_kind, revision
       FROM entry_snapshots WHERE entry_id = 'entry-1' ORDER BY rowid`,
    ).all() as { tags: string; mutation_kind: string; revision: number }[];
    expect(snapshots).toEqual([
      { tags: '["work"]', mutation_kind: "visibility", revision: 1 },
      { tags: '["work","private"]', mutation_kind: "visibility", revision: 2 },
    ]);
  });

  it("does not expose a private state through known_at before its later publication", async () => {
    seedEntry(harness, "private");
    const now = vi.spyOn(Date, "now").mockReturnValue(300);
    try {
      await setEntryVisibility("entry-1", "user-owner", "public", harness.env);

      expect(one<any>(
        harness.db,
        `SELECT visibility, recorded_at, valid_from, revision
         FROM entries WHERE id = 'entry-1'`,
      )).toEqual({ visibility: "public", recorded_at: 300, valid_from: 10, revision: 2 });
      expect(one<any>(
        harness.db,
        `SELECT visibility, recorded_at, valid_from, revision
         FROM entry_snapshots WHERE entry_id = 'entry-1'`,
      )).toEqual({ visibility: "private", recorded_at: 100, valid_from: 10, revision: 1 });

      const ownerBefore = await recallAt(harness, "user-owner", 200, 50);
      const teammateBefore = await recallAt(harness, "user-teammate", 200, 50);
      const teammateAfter = await recallAt(harness, "user-teammate", 300, 50);
      const outsideValidTime = await recallAt(harness, "user-teammate", 400, 5);

      expect(ownerBefore.matches).toEqual([
        expect.objectContaining({ id: "entry-1", visibility: "private" }),
      ]);
      expect(teammateBefore.matches).toEqual([]);
      expect(teammateAfter.matches).toEqual([
        expect.objectContaining({ id: "entry-1", visibility: "public" }),
      ]);
      expect(outsideValidTime.matches).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("treats current D1 privacy as a revocation boundary for historical public states", async () => {
    seedEntry(harness, "public");
    const now = vi.spyOn(Date, "now").mockReturnValue(300);
    try {
      await setEntryVisibility("entry-1", "user-owner", "private", harness.env);

      expect(one<any>(
        harness.db,
        `SELECT visibility, recorded_at, valid_from, revision
         FROM entries WHERE id = 'entry-1'`,
      )).toEqual({ visibility: "private", recorded_at: 300, valid_from: 10, revision: 2 });
      expect(one<any>(
        harness.db,
        `SELECT visibility, recorded_at, valid_from, revision
         FROM entry_snapshots WHERE entry_id = 'entry-1'`,
      )).toEqual({ visibility: "public", recorded_at: 100, valid_from: 10, revision: 1 });

      const ownerBefore = await recallAt(harness, "user-owner", 200, 50);
      const ownerAfter = await recallAt(harness, "user-owner", 400, 50);
      const teammateBefore = await recallAt(harness, "user-teammate", 200, 50);
      const teammateAfter = await recallAt(harness, "user-teammate", 400, 50);

      expect(ownerBefore.matches).toEqual([
        expect.objectContaining({ id: "entry-1", visibility: "public" }),
      ]);
      expect(ownerAfter.matches).toEqual([
        expect.objectContaining({ id: "entry-1", visibility: "private" }),
      ]);
      expect(teammateBefore.matches).toEqual([]);
      expect(teammateAfter.matches).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("invalidates touching edges and pending proposals without affecting unrelated records", async () => {
    seedEntry(harness, "public");
    seedRelationships(harness);

    await setEntryVisibility("entry-1", "user-owner", "private", harness.env);

    expect(one<{ count: number }>(
      harness.db,
      `SELECT COUNT(*) AS count FROM edges WHERE id = 'edge-touching'`,
    ).count).toBe(0);
    expect(one<{ count: number }>(
      harness.db,
      `SELECT COUNT(*) AS count FROM edges WHERE id = 'edge-unrelated'`,
    ).count).toBe(1);
    expect(one<any>(
      harness.db,
      `SELECT status, resolved_by, resolved_at FROM edge_proposals
       WHERE id = 'edge-proposal-touching'`,
    )).toMatchObject({ status: "rejected", resolved_by: "user-owner" });
    expect(one<any>(
      harness.db,
      `SELECT status, resolved_by FROM edge_proposals
       WHERE id = 'edge-proposal-unrelated'`,
    )).toMatchObject({ status: "pending", resolved_by: null });
    expect(one<any>(
      harness.db,
      `SELECT status, error_code FROM action_proposals
       WHERE id = 'action-proposal-touching'`,
    )).toMatchObject({ status: "stale", error_code: "visibility_changed" });
    expect(one<any>(
      harness.db,
      `SELECT status, error_code FROM action_proposals
       WHERE id = 'action-proposal-unrelated'`,
    )).toMatchObject({ status: "pending", error_code: null });
  });

  it.each([
    ["public", ["work"]],
    ["private", ["work", "private"]],
  ] as const)("treats an already-%s synchronized transition as an idempotent no-op", async (
    visibility,
    tags,
  ) => {
    seedEntry(harness, visibility, [...tags]);

    const result = await setEntryVisibility(
      "entry-1",
      "user-owner",
      visibility,
      harness.env,
    );

    expect(result).toEqual({
      entryId: "entry-1",
      visibility,
      changed: false,
      vectorSyncPending: false,
    });
    expect(harness.getByIds).not.toHaveBeenCalled();
    expect(harness.upsert).not.toHaveBeenCalled();
    expect(harness.db.executed).toEqual([]);
  });
});
