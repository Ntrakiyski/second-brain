import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../src/testing";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import { forgetEntry, type Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";
import { TEST_USER_API_KEY, TEST_USER_ID } from "../helpers/test-principal";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

describe("POST /forget", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_USER_API_KEY}` },
        body: "{not json",
      }),
      env,
      ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
  });

  it("returns 400 when id is missing", async () => {
    const res = await worker.fetch(req("POST", "/forget", { body: {} }), env, ctx);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toBe("id is required");
  });

  it("returns 404 for non-existent id", async () => {
    const res = await worker.fetch(req("POST", "/forget", { body: { id: "no-such-id" } }), env, ctx);
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
  });

  it("deletes an existing entry and its vectors", async () => {
    const deleteByIdsMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ deleteByIds: deleteByIdsMock }),
    });
    db.entries.push({
      id: "entry-1",
      content: "Some content",
      tags: "[]",
      source: "api",
      created_at: Date.now(),
      vector_ids: '["entry-1","entry-1-update-111"]',
      owner_user_id: TEST_USER_ID,
    });

    const res = await worker.fetch(req("POST", "/forget", { body: { id: "entry-1" } }), env, ctx);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.id).toBe("entry-1");
    expect(data.deletedVectors).toBe(2);

    expect(db.entries.find((e: any) => e.id === "entry-1")).toBeUndefined();
    expect(deleteByIdsMock).toHaveBeenCalledWith(["entry-1", "entry-1-update-111"]);
  });

  it("trims whitespace from id before lookup", async () => {
    db.entries.push({
      id: "entry-1",
      content: "Some content",
      tags: "[]",
      source: "api",
      created_at: Date.now(),
      vector_ids: "[]",
      owner_user_id: TEST_USER_ID,
    });

    const res = await worker.fetch(req("POST", "/forget", { body: { id: "  entry-1  " } }), env, ctx);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBe("entry-1");
  });

  it("cascade-deletes edges touching the forgotten entry", async () => {
    db.entries.push({
      id: "entry-1", content: "Some content", tags: "[]", source: "api", created_at: Date.now(), vector_ids: "[]", owner_user_id: TEST_USER_ID,
    });
    db.edges.push(
      { id: "e1", source_id: "entry-1", target_id: "other", type: "relates_to", weight: 0.5, provenance: "inferred", metadata: "{}", created_at: 1, updated_at: 1 },
      { id: "e2", source_id: "another", target_id: "entry-1", type: "relates_to", weight: 0.5, provenance: "inferred", metadata: "{}", created_at: 1, updated_at: 1 },
      { id: "e3", source_id: "x", target_id: "y", type: "relates_to", weight: 0.5, provenance: "inferred", metadata: "{}", created_at: 1, updated_at: 1 },
    );

    const res = await worker.fetch(req("POST", "/forget", { body: { id: "entry-1" } }), env, ctx);
    expect(res.status).toBe(200);

    // Edges with entry-1 as source OR target are removed; the unrelated edge survives — no dangling edges.
    expect(db.edges.map((e: any) => e.id)).toEqual(["e3"]);
  });

  it("deletes passage vectors and every entry-owned child artifact", async () => {
    const deleteByIdsMock = vi.fn().mockResolvedValue({ mutationId: "m" });
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ deleteByIds: deleteByIdsMock }),
    });
    db.entries.push(
      { id: "entry-1", content: "Forget me", tags: "[]", source: "api", created_at: 1, vector_ids: '["entry-vector"]' },
      { id: "keep", content: "Keep me", tags: "[]", source: "api", created_at: 2, vector_ids: '["keep-vector"]' },
    );
    db.passages.push(
      { id: "passage-1", entry_id: "entry-1", episode_id: "episode-1", content: "Part one", vector_ids: '["passage-vector-1"]' },
      { id: "passage-2", entry_id: "entry-1", episode_id: "episode-1", content: "Part two", vector_ids: '["passage-vector-2","entry-vector"]' },
      { id: "passage-keep", entry_id: "keep", episode_id: "episode-keep", content: "Keep", vector_ids: '["keep-passage-vector"]' },
    );
    db.episodes.push(
      { id: "episode-1", entry_id: "entry-1", content: "Raw" },
      { id: "episode-keep", entry_id: "keep", content: "Keep raw" },
    );
    db.entry_snapshots.push(
      { id: "snapshot-1", entry_id: "entry-1", content: "Old" },
      { id: "snapshot-keep", entry_id: "keep", content: "Keep old" },
    );
    db.edges.push(
      { id: "edge-out", source_id: "entry-1", target_id: "keep" },
      { id: "edge-in", source_id: "keep", target_id: "entry-1" },
      { id: "edge-keep", source_id: "keep", target_id: "other" },
    );
    db.edgeProposals.push(
      { id: "proposal-out", source_id: "entry-1", target_id: "keep" },
      { id: "proposal-in", source_id: "keep", target_id: "entry-1" },
      { id: "proposal-keep", source_id: "keep", target_id: "other" },
    );

    const result = await forgetEntry("entry-1", env);

    expect(result).toEqual({ status: "deleted", vectorCount: 3 });
    expect(deleteByIdsMock).toHaveBeenCalledWith([
      "entry-vector",
      "passage-vector-1",
      "passage-vector-2",
    ]);
    expect(db.entries.map((row: any) => row.id)).toEqual(["keep"]);
    expect(db.passages.map((row: any) => row.id)).toEqual(["passage-keep"]);
    expect(db.episodes.map((row: any) => row.id)).toEqual(["episode-keep"]);
    expect(db.entry_snapshots.map((row: any) => row.id)).toEqual(["snapshot-keep"]);
    expect(db.edges.map((row: any) => row.id)).toEqual(["edge-keep"]);
    expect(db.edgeProposals.map((row: any) => row.id)).toEqual(["proposal-keep"]);
  });

  it("fails closed and leaves D1 intact when Vectorize delete fails", async () => {
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        deleteByIds: vi.fn().mockRejectedValue(new Error("Vectorize down")),
      }),
    });
    db.entries.push({
      id: "entry-1",
      content: "Some content",
      tags: "[]",
      source: "api",
      created_at: Date.now(),
      vector_ids: '["entry-1"]',
    });
    db.passages.push({
      id: "passage-1",
      entry_id: "entry-1",
      vector_ids: '["passage-vector-1"]',
    });
    db.episodes.push({ id: "episode-1", entry_id: "entry-1" });
    db.entry_snapshots.push({ id: "snapshot-1", entry_id: "entry-1" });
    db.edges.push({ id: "edge-1", source_id: "entry-1", target_id: "other" });
    db.edgeProposals.push({ id: "proposal-1", source_id: "entry-1", target_id: "other" });

    await expect(forgetEntry("entry-1", env)).rejects.toThrow("Vectorize down");

    expect(db.entries.map((row: any) => row.id)).toEqual(["entry-1"]);
    expect(db.passages.map((row: any) => row.id)).toEqual(["passage-1"]);
    expect(db.episodes.map((row: any) => row.id)).toEqual(["episode-1"]);
    expect(db.entry_snapshots.map((row: any) => row.id)).toEqual(["snapshot-1"]);
    expect(db.edges.map((row: any) => row.id)).toEqual(["edge-1"]);
    expect(db.edgeProposals.map((row: any) => row.id)).toEqual(["proposal-1"]);
  });

  it("fails safely before deletion when tracked vector IDs are malformed", async () => {
    const deleteByIdsMock = vi.fn();
    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ deleteByIds: deleteByIdsMock }),
    });
    db.entries.push({
      id: "entry-1",
      content: "Some content",
      tags: "[]",
      source: "api",
      created_at: Date.now(),
      vector_ids: '["entry-vector"]',
    });
    db.passages.push({
      id: "passage-1",
      entry_id: "entry-1",
      vector_ids: "not-json",
    });

    await expect(forgetEntry("entry-1", env)).rejects.toThrow(
      "malformed vector_ids for passage passage-1"
    );

    expect(deleteByIdsMock).not.toHaveBeenCalled();
    expect(db.entries.map((row: any) => row.id)).toEqual(["entry-1"]);
    expect(db.passages.map((row: any) => row.id)).toEqual(["passage-1"]);
  });
});
