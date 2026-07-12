/**
 * Per-user compression tests — verifies that compression correctly scopes
 * entries by user ownership and visibility.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { compressTag, compressionEligibilitySql } from "../../src/index";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

function makeSseStream(response: string) {
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(`data: {"response":${JSON.stringify(response)}}\n\n`));
      c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

function makeDigestAI(digestText = "Compressed digest text") {
  return {
    run: vi.fn().mockImplementation(async (_model: string, opts: any) => {
      if (_model === "@cf/baai/bge-small-en-v1.5")
        return { data: [new Array(384).fill(0.1)] };
      if (opts?.stream)
        return makeSseStream(digestText);
      return { response: "3" };
    }),
  } as unknown as Ai;
}

function makeCtx() {
  const pending: Promise<any>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<any>) => pending.push(p) } as any as ExecutionContext,
    drain: () => Promise.allSettled(pending),
  };
}

function seed(db: D1Mock, id: string, content: string, tags: string[] = [], ownerId = "", opts: { importance?: number; recall?: number; created_at?: number } = {}) {
  db.entries.push({
    id,
    content,
    tags: JSON.stringify(tags),
    source: "api",
    created_at: opts.created_at ?? Date.now() - 100000,
    vector_ids: "[]",
    recall_count: opts.recall ?? 0,
    importance_score: opts.importance ?? 0,
    owner_user_id: ownerId,
  });
}

describe("Per-user compression", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db, { AI: makeDigestAI() });
  });

  describe("compressionEligibilitySql with ownerUserId", () => {
    it("adds owner_user_id filter when ownerUserId is provided", () => {
      const sql = compressionEligibilitySql("", "user-1");
      expect(sql).toContain("owner_user_id");
      expect(sql).toContain("?");
    });

    it("does not add owner_user_id filter when no ownerUserId", () => {
      const sql = compressionEligibilitySql("");
      expect(sql).not.toContain("owner_user_id");
    });

    it("allows public entries from other users", () => {
      const sql = compressionEligibilitySql("", "user-1");
      // Should filter: (owner_user_id = ?) OR (tags NOT LIKE '%"private"%')
      expect(sql).toContain("tags NOT LIKE");
      expect(sql).toContain("private");
    });
  });

  describe("compressTag with userId", () => {
    it("only compresses entries visible to the user", async () => {
      // Seed 15 entries tagged "project" owned by user-1
      for (let i = 0; i < 15; i++) {
        seed(db, `u1-${i}`, `User 1 note ${i}`, ["project"], "user-1");
      }
      // Seed 10 entries tagged "project" owned by user-2 (private)
      for (let i = 0; i < 10; i++) {
        seed(db, `u2-${i}`, `User 2 private note ${i}`, ["project", "private"], "user-2");
      }

      const { ctx } = makeCtx();
      const result = await compressTag("project", env, ctx, "user-1");

      // Should only compress user-1's 15 entries, not user-2's 10
      expect(result.entriesUsed).toBe(15);
      expect(result.synthesizedId).toBeTruthy();
    });

    it("includes public entries from other users as context", async () => {
      // Seed 12 entries tagged "project" owned by user-1
      for (let i = 0; i < 12; i++) {
        seed(db, `u1-${i}`, `User 1 note ${i}`, ["project"], "user-1");
      }
      // Seed 5 public entries from user-2 (should be included)
      for (let i = 0; i < 5; i++) {
        seed(db, `u2-pub-${i}`, `User 2 public note ${i}`, ["project"], "user-2");
      }

      const { ctx } = makeCtx();
      const result = await compressTag("project", env, ctx, "user-1");

      // Should include user-1's 12 + user-2's 5 public = 17 entries
      expect(result.entriesUsed).toBe(17);
    });

    it("excludes private entries from other users", async () => {
      // Seed 12 entries tagged "project" owned by user-1
      for (let i = 0; i < 12; i++) {
        seed(db, `u1-${i}`, `User 1 note ${i}`, ["project"], "user-1");
      }
      // Seed 10 private entries from user-2 (should be excluded)
      for (let i = 0; i < 10; i++) {
        seed(db, `u2-priv-${i}`, `User 2 private note ${i}`, ["project", "private"], "user-2");
      }

      const { ctx } = makeCtx();
      const result = await compressTag("project", env, ctx, "user-1");

      // Should only compress user-1's 12 entries
      expect(result.entriesUsed).toBe(12);
    });

    it("compresses without userId (backward compat)", async () => {
      // Seed 15 entries tagged "project" with no owner
      for (let i = 0; i < 15; i++) {
        seed(db, `entry-${i}`, `Note ${i}`, ["project"]);
      }

      const { ctx } = makeCtx();
      const result = await compressTag("project", env, ctx);

      expect(result.entriesUsed).toBe(15);
      expect(result.synthesizedId).toBeTruthy();
    });
  });
});
