import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../src/testing";
import { makeTestDb, makeTestEnv, makeVectorizeMock } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";
import { TEST_USER_ID } from "../helpers/test-principal";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

function seedEntry(db: D1Mock, overrides: Partial<ReturnType<typeof makeEntry>> = {}) {
  const entry = makeEntry(overrides);
  db.entries.push(entry);
  return entry;
}

function makeEntry(overrides: Partial<{
  id: string; content: string; tags: string; source: string;
  created_at: number; vector_ids: string; recall_count: number; importance_score: number;
  owner_user_id: string;
}> = {}) {
  return {
    id: "entry-abc",
    content: "Original content",
    tags: '["work"]',
    source: "api",
    created_at: Date.now(),
    vector_ids: '["entry-abc"]',
    recall_count: 0,
    importance_score: 3,
    owner_user_id: TEST_USER_ID,
    ...overrides,
  };
}

describe("POST /update", () => {
  let db: D1Mock;
  let env: Env;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 without auth", async () => {
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "x", content: "new" }, token: null }),
      env, ctx
    );
    expect(res.status).toBe(401);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("returns 400 when id is missing", async () => {
    const res = await worker.fetch(
      req("POST", "/update", { body: { content: "new content" } }),
      env, ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toMatch(/id/);
  });

  it("returns 400 when content is missing", async () => {
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc" } }),
      env, ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toMatch(/content/);
  });

  it("returns 400 when content is blank whitespace", async () => {
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "   " } }),
      env, ctx
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when entry does not exist", async () => {
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "nonexistent", content: "new content" } }),
      env, ctx
    );
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/nonexistent/);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("updates D1 content and returns ok:true with id", async () => {
    seedEntry(db);
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated content" } }),
      env, ctx
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.id).toBe("entry-abc");
    expect(db.entries[0].content).toBe("Updated content");
  });

  it("preserves existing tags and source after update", async () => {
    seedEntry(db, { tags: '["work","important"]', source: "claude" });
    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "New content" } }),
      env, ctx
    );
    const tags = JSON.parse(db.entries[0].tags);
    expect(tags).toContain("work");
    expect(tags).toContain("important");
    expect(db.entries[0].source).toBe("claude");
  });

  // ── Hashtag merge ───────────────────────────────────────────────────────────

  it("merges new #hashtag from content into tags and strips it from stored content", async () => {
    seedEntry(db, { tags: '["work"]' });
    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated content #newtag" } }),
      env, ctx
    );
    expect(db.entries[0].content).toBe("Updated content");
    const tags = JSON.parse(db.entries[0].tags);
    expect(tags).toContain("work");
    expect(tags).toContain("newtag");
  });

  it("does not duplicate a tag already present when the same #tag appears in content", async () => {
    seedEntry(db, { tags: '["work"]' });
    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated content #work" } }),
      env, ctx
    );
    expect(db.entries[0].content).toBe("Updated content");
    const tags = JSON.parse(db.entries[0].tags);
    expect(tags.filter((t: string) => t === "work")).toHaveLength(1);
  });

  it("calls Vectorize upsert (re-embed) with new content", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ upsert: upsertMock }),
    });
    seedEntry(db);
    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Brand new content" } }),
      env, ctx
    );
    expect(upsertMock).toHaveBeenCalledOnce();
    const insertedVectors = upsertMock.mock.calls[0][0] as any[];
    expect(insertedVectors[0].id).toBe("entry-abc");
  });

  // ── Vector orphan prevention ────────────────────────────────────────────────

  it("deletes only stale vectors, preserving the re-embedded (reused) id", async () => {
    // Entry previously had 2 chunks. The short update re-embeds to a single
    // chunk keyed by the entry id ("entry-abc"), which must NOT be deleted —
    // only the now-orphaned "entry-abc-chunk-1" should be removed.
    const deleteByIdsMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ deleteByIds: deleteByIdsMock }),
    });
    seedEntry(db, { vector_ids: '["entry-abc","entry-abc-chunk-1"]' });

    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated" } }),
      env, ctx
    );

    expect(deleteByIdsMock).toHaveBeenCalledOnce();
    expect(deleteByIdsMock.mock.calls[0][0]).toEqual(["entry-abc-chunk-1"]);
  });

  it("does NOT delete the re-embedded single-chunk vector (id-reuse regression)", async () => {
    // Single-chunk entry: vector id == entry id. The re-embed reuses that id,
    // so there is nothing stale — deleting it would make the entry unsearchable.
    const deleteByIdsMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ deleteByIds: deleteByIdsMock }),
    });
    seedEntry(db, { vector_ids: '["entry-abc"]' });

    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated" } }),
      env, ctx
    );

    expect(deleteByIdsMock).not.toHaveBeenCalled();
  });

  it("does not call deleteByIds when vector_ids is empty", async () => {
    const deleteByIdsMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ deleteByIds: deleteByIdsMock }),
    });
    seedEntry(db, { vector_ids: "[]" });

    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated" } }),
      env, ctx
    );

    expect(deleteByIdsMock).not.toHaveBeenCalled();
  });

  // ── Non-fatal error handling ────────────────────────────────────────────────

  it("fails closed without changing content or deleting old vectors when Vectorize upsert throws", async () => {
    const deleteByIdsMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        upsert: vi.fn().mockRejectedValue(new Error("Vectorize down")),
        deleteByIds: deleteByIdsMock,
      }),
    });
    seedEntry(db, { vector_ids: '["entry-abc","entry-abc-chunk-1"]' });
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated content" } }),
      env, ctx
    );
    expect(res.status).toBe(503);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(db.entries[0].content).toBe("Original content");
    expect(db.entries[0].tags).toBe('["work"]');
    expect(db.entries[0].vector_ids).toBe('["entry-abc","entry-abc-chunk-1"]');
    expect(deleteByIdsMock).not.toHaveBeenCalled();
  });

  it("returns ok:true even when deleteByIds throws", async () => {
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        deleteByIds: vi.fn().mockRejectedValue(new Error("Delete failed")),
      }),
    });
    seedEntry(db, { vector_ids: '["entry-abc"]' });
    const res = await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Updated content" } }),
      env, ctx
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
  });

  // ── Safe ordering ───────────────────────────────────────────────────────────

  it("reads vector_ids before D1 content update (safe ordering)", async () => {
    // Seed entry with known vector_ids
    seedEntry(db, { vector_ids: '["old-vec-1","old-vec-2"]' });

    const callOrder: string[] = [];
    const deleteByIdsMock = vi.fn().mockImplementation(async (ids: string[]) => {
      callOrder.push(`delete:${ids.join(",")}`);
      return { mutationId: "m" };
    });
    const upsertMock = vi.fn().mockImplementation(async () => {
      callOrder.push("upsert");
      return { mutationId: "m" };
    });

    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ upsert: upsertMock, deleteByIds: deleteByIdsMock }),
    });

    await worker.fetch(
      req("POST", "/update", { body: { id: "entry-abc", content: "Replaced content" } }),
      env, ctx
    );

    // upsert must happen before delete — new vectors before old ones removed
    const insertIdx = callOrder.indexOf("upsert");
    const deleteIdx = callOrder.findIndex(s => s.startsWith("delete:"));
    expect(insertIdx).toBeLessThan(deleteIdx);
    expect(callOrder[deleteIdx]).toContain("old-vec-1");
    expect(callOrder[deleteIdx]).toContain("old-vec-2");
  });
});
