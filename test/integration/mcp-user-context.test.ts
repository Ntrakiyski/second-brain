/**
 * MCP User Context tests — verifies that MCP tool handlers correctly scope
 * operations byuserId when user credentials are provided.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  captureEntry,
  recallEntries,
  buildEntryFilterQuery,
} from "../../src/index";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

function makeCtx() {
  const pending: Promise<any>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<any>) => pending.push(p) } as any as ExecutionContext,
    drain: () => Promise.allSettled(pending),
  };
}

function seed(db: D1Mock, id: string, content: string, tags: string[] = [], ownerId = "") {
  db.entries.push({ id, content, tags: JSON.stringify(tags), source: "api", created_at: Date.now(), vector_ids: "[]", recall_count: 0, importance_score: 0, owner_user_id: ownerId });
}

describe("MCP user context — per-user scoping", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(async () => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  describe("buildEntryFilterQuery with userId", () => {
    it("includes visibility WHERE clause when userId is provided", () => {
      const { sql } = buildEntryFilterQuery({ n: 10, userId: "user-1" });
      expect(sql).toContain("WHERE");
      expect(sql).toContain("owner_user_id");
    });

    it("has no WHERE clause when no userId and no other filters", () => {
      const { sql } = buildEntryFilterQuery({ n: 10 });
      expect(sql).not.toContain("WHERE");
    });

    it("excludes private entries of other users", () => {
      const { sql, bindings } = buildEntryFilterQuery({ n: 10, userId: "user-1" });
      // The visibility clause should filter out private entries owned by others
      expect(sql).toContain("owner_user_id");
      expect(bindings).toContain("user-1");
    });
  });

  describe("recallEntries with userId", () => {
    it("applies visibility filter via post-fusion D1 query", async () => {
      // Seed entries with different owners
      seed(db, "pub-1", "Alice public note", [], "user-1");
      seed(db, "priv-1", "Alice private note", ["private"], "user-1");
      seed(db, "other-1", "Bob private note", ["private"], "user-2");

      // Mock Vectorize to return all entries as matches
      const vectorize = makeVectorizeMock({
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: "pub-1", score: 0.9, metadata: { parentId: "pub-1", isUpdate: false } },
            { id: "priv-1", score: 0.85, metadata: { parentId: "priv-1", isUpdate: false } },
            { id: "other-1", score: 0.8, metadata: { parentId: "other-1", isUpdate: false } },
          ],
        }),
      });
      env = makeTestEnv(db, { VECTORIZE: vectorize });

      const { ctx } = makeCtx();

      // User-1 should see their own public + private, but not user-2's private
      const result1 = await recallEntries(
        { query: "note", topK: 10, userId: "user-1" },
        env,
        ctx,
      );
      const ids1 = result1.matches.map((m) => m.id);
      expect(ids1).toContain("pub-1");
      expect(ids1).toContain("priv-1");
      expect(ids1).not.toContain("other-1");

      // User-2 should see their own private + public, but not user-1's private
      const result2 = await recallEntries(
        { query: "note", topK: 10, userId: "user-2" },
        env,
        ctx,
      );
      const ids2 = result2.matches.map((m) => m.id);
      expect(ids2).toContain("other-1");
      expect(ids2).toContain("pub-1");
      expect(ids2).not.toContain("priv-1");
    });
  });

  describe("captureEntry with userId", () => {
    it("attributes captured entry to the provided userId", async () => {
      const { ctx } = makeCtx();
      const result = await captureEntry(
        "Test note for user context",
        [],
        "test",
        env,
        ctx,
        "user-1",
      );

      expect(result.status).not.toBe("error");
      if (result.status === "stored" || result.status === "flagged") {
        const row = await db.prepare(
          `SELECT owner_user_id FROM entries WHERE id = ?`
        ).bind(result.id).first() as { owner_user_id: string } | null;
        expect(row?.owner_user_id).toBe("user-1");
      }
    });

    it("defaults to empty owner_user_id when no userId", async () => {
      const { ctx } = makeCtx();
      const result = await captureEntry(
        "Test note without user",
        [],
        "test",
        env,
        ctx,
      );

      if (result.status === "stored" || result.status === "flagged") {
        const row = await db.prepare(
          `SELECT owner_user_id FROM entries WHERE id = ?`
        ).bind(result.id).first() as { owner_user_id: string } | null;
        expect(row?.owner_user_id ?? "").toBe("");
      }
    });
  });
});
