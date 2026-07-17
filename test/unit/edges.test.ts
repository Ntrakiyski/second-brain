import { describe, it, expect, beforeEach } from "vitest";
import {
  createEdge,
  deleteEdge,
  expandGraph,
  getEdgeHistory,
  inferEdgesOnWrite,
  isValidEdgeType,
  isSymmetric,
  restoreEdgeVersion,
} from "../../src/testing";
import { makeTestEnv, makeTestDb } from "../helpers/make-env";
import type { Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";

function edge(source_id: string, target_id: string, weight = 0.5, type = "relates_to") {
  return { id: `${source_id}-${target_id}`, source_id, target_id, type, weight, provenance: "inferred", metadata: "{}", created_at: 1, updated_at: 1 };
}

function publicEntry(id: string, owner_user_id = "u1") {
  return {
    id,
    content: id,
    tags: "[]",
    source: "api",
    created_at: 1,
    vector_ids: "[]",
    owner_user_id,
    visibility: "public",
  };
}

describe("edge-type registry", () => {
  it("validates known edge types and rejects unknown ones", () => {
    expect(isValidEdgeType("relates_to")).toBe(true);
    expect(isValidEdgeType("supersedes")).toBe(true);
    expect(isValidEdgeType("bogus")).toBe(false);
  });

  it("treats relates_to as symmetric and supersedes as directed", () => {
    expect(isSymmetric("relates_to")).toBe(true);
    expect(isSymmetric("supersedes")).toBe(false);
  });
});

describe("createEdge", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    db.entries.push(...["a", "b", "alpha", "zeta", "new", "old"].map(id => publicEntry(id)));
    env = makeTestEnv(db);
  });

  it("rejects a self-link and writes nothing", async () => {
    const result = await createEdge("a", "a", "relates_to", {}, env);
    expect(result).toBeNull();
    expect(db.edges).toHaveLength(0);
  });

  it("rejects an unknown edge type and writes nothing", async () => {
    const result = await createEdge("a", "b", "bogus", {}, env);
    expect(result).toBeNull();
    expect(db.edges).toHaveLength(0);
  });

  it("rejects a dangling edge when either endpoint does not exist", async () => {
    const result = await createEdge("a", "missing", "relates_to", {}, env);
    expect(result).toBeNull();
    expect(db.edges).toHaveLength(0);
  });

  it("orders symmetric edges smaller-id-first so A→B and B→A collapse to one row", async () => {
    await createEdge("zeta", "alpha", "relates_to", {}, env);
    expect(db.edges).toHaveLength(1);
    expect(db.edges[0].source_id).toBe("alpha");
    expect(db.edges[0].target_id).toBe("zeta");

    // Reverse direction is the same logical edge — must not create a second row.
    await createEdge("alpha", "zeta", "relates_to", {}, env);
    expect(db.edges).toHaveLength(1);
  });

  it("preserves direction for directed edge types", async () => {
    await createEdge("new", "old", "supersedes", {}, env);
    expect(db.edges).toHaveLength(1);
    expect(db.edges[0].source_id).toBe("new");
    expect(db.edges[0].target_id).toBe("old");
  });

  it("is idempotent and keeps the higher weight on re-link", async () => {
    await createEdge("a", "b", "relates_to", { weight: 0.4 }, env);
    await createEdge("a", "b", "relates_to", { weight: 0.9 }, env);
    expect(db.edges).toHaveLength(1);
    expect(db.edges[0].weight).toBe(0.9);

    // A weaker re-link must not lower the stored weight.
    await createEdge("a", "b", "relates_to", { weight: 0.2 }, env);
    expect(db.edges).toHaveLength(1);
    expect(db.edges[0].weight).toBe(0.9);
  });

  it("stores provenance and metadata", async () => {
    await createEdge("a", "b", "relates_to", { provenance: "explicit", metadata: { note: "hi" } }, env);
    expect(db.edges[0].provenance).toBe("explicit");
    expect(JSON.parse(db.edges[0].metadata)).toEqual({ note: "hi", confidence: 1.0 });
    expect(db.edges[0].confidence).toBe(1.0);
  });

  it("defaults confidence to 1.0 for explicit provenance", async () => {
    await createEdge("a", "b", "relates_to", { provenance: "explicit" }, env);
    expect(JSON.parse(db.edges[0].metadata).confidence).toBe(1.0);
  });

  it("defaults confidence to 1.0 for system provenance", async () => {
    await createEdge("a", "b", "supersedes", { provenance: "system" }, env);
    expect(JSON.parse(db.edges[0].metadata).confidence).toBe(1.0);
  });

  it("defaults confidence to weight for inferred provenance", async () => {
    await createEdge("a", "b", "relates_to", { provenance: "inferred", weight: 0.8 }, env);
    expect(JSON.parse(db.edges[0].metadata).confidence).toBe(0.8);
  });

  it("uses explicit confidence when provided, overriding provenance default", async () => {
    await createEdge("a", "b", "relates_to", { provenance: "inferred", weight: 0.8, confidence: 0.3 }, env);
    expect(JSON.parse(db.edges[0].metadata).confidence).toBe(0.3);
    expect(db.edges[0].confidence).toBe(0.3);
  });

  it("upgrades persisted confidence and provenance when an explicit link confirms an inferred one", async () => {
    await createEdge("a", "b", "relates_to", { provenance: "inferred", weight: 0.8, confidence: 0.3 }, env);
    await createEdge("a", "b", "relates_to", { provenance: "explicit", weight: 1.0 }, env);
    expect(db.edges).toHaveLength(1);
    expect(db.edges[0].confidence).toBe(1.0);
    expect(db.edges[0].provenance).toBe("explicit");
  });

  it("keeps a reversible edge ledger across update, delete, and restore", async () => {
    const created = await createEdge("a", "b", "relates_to", {
      provenance: "explicit",
      weight: 0.4,
      actorKind: "human",
      actorId: "u1",
      mutationKind: "explicit-link",
      mutationId: "m1",
    }, env);
    expect(created?.revision).toBe(1);

    const updated = await createEdge("a", "b", "relates_to", {
      provenance: "explicit",
      weight: 0.9,
      actorKind: "human",
      actorId: "u1",
      mutationKind: "explicit-link",
      mutationId: "m2",
    }, env);
    expect(updated?.revision).toBe(2);
    expect(db.edge_versions.map((row: any) => row.revision)).toEqual([1, 2]);

    await deleteEdge("a", "b", "relates_to", env, {
      actorKind: "human",
      actorId: "u1",
      mutationKind: "explicit-remove",
      mutationId: "m3",
    });
    expect(db.edges).toHaveLength(0);
    expect(db.edge_versions.map((row: any) => [row.revision, row.is_deleted])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 1],
    ]);

    const history = await getEdgeHistory(created!.id, "u1", env);
    expect(history?.map((row) => [row.revision, row.is_deleted])).toEqual([
      [4, 1],
      [3, 0],
      [2, 0],
      [1, 0],
    ]);

    const restored = await restoreEdgeVersion(created!.id, 1, "u1", env);
    expect(restored).toMatchObject({
      id: created!.id,
      source_id: "a",
      target_id: "b",
      type: "relates_to",
      revision: 5,
    });
    expect(db.edges[0].weight).toBe(0.4);
    expect(db.edge_versions.at(-1)).toMatchObject({
      edge_id: created!.id,
      revision: 5,
      is_deleted: 0,
      mutation_kind: "restore",
      actor_kind: "human",
      actor_id: "u1",
    });
  });
});

describe("expandGraph", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    db.entries.push(...["a", "b", "c"].map(id => publicEntry(id)));
    env = makeTestEnv(db);
  });

  it("returns nothing at hop 0", async () => {
    db.edges.push(edge("a", "b"));
    expect(await expandGraph(["a"], { hops: 0 }, env)).toEqual([]);
  });

  it("finds 1-hop neighbors regardless of edge direction", async () => {
    db.edges.push(edge("a", "b", 0.6), edge("c", "a", 0.7)); // a as source, then a as target
    const out = await expandGraph(["a"], { hops: 1 }, env);
    expect(out.map(n => n.id).sort()).toEqual(["b", "c"]);
    expect(out.every(n => n.hop === 1)).toBe(true);
  });

  it("never returns a seed node", async () => {
    db.edges.push(edge("a", "b"));
    const out = await expandGraph(["a", "b"], { hops: 1 }, env);
    expect(out).toHaveLength(0);
  });

  it("skips status:deprecated neighbors by default", async () => {
    db.entries.find((entry: any) => entry.id === "b").tags = JSON.stringify(["status:deprecated"]);
    db.edges.push(edge("a", "b", 0.9), edge("a", "c", 0.8));
    const out = await expandGraph(["a"], { hops: 1 }, env);
    expect(out.map(n => n.id)).toEqual(["c"]);
  });

  it("reaches 2-hop nodes when hops allows", async () => {
    db.edges.push(edge("a", "b"), edge("b", "c"));
    const out = await expandGraph(["a"], { hops: 2 }, env);
    const byId = Object.fromEntries(out.map(n => [n.id, n.hop]));
    expect(byId).toEqual({ b: 1, c: 2 });
  });

  it("skips other users' private entries when userId provided", async () => {
    db.entries.push(
      { id: "priv-other", content: "Other private", tags: JSON.stringify(["private"]), source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u2", visibility: "private" },
      { id: "pub", content: "Public note", tags: "[]", source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "public" },
    );
    db.edges.push(edge("a", "priv-other", 0.9), edge("a", "pub", 0.8));
    const out = await expandGraph(["a"], { hops: 1 }, env, "u1");
    expect(out.map(n => n.id)).toEqual(["pub"]);
  });

  it("includes own private entries when userId provided", async () => {
    const seed = db.entries.find((entry: any) => entry.id === "a");
    seed.tags = JSON.stringify(["private"]);
    seed.visibility = "private";
    db.entries.push(
      { id: "mine", content: "My private", tags: JSON.stringify(["private"]), source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "private" },
    );
    db.edges.push(edge("a", "mine", 0.9));
    const out = await expandGraph(["a"], { hops: 1 }, env, "u1");
    expect(out.map(n => n.id)).toEqual(["mine"]);
  });
});

describe("inferEdgesOnWrite", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    db.entries.push(...["new", "strong", "loose", "weak", "a", "b", "c", "d", "e"].map(id => publicEntry(id)));
    env = makeTestEnv(db);
  });

  it("auto-links only genuinely-related neighbors, not loose keyword-overlap ones", async () => {
    await inferEdgesOnWrite("new", [
      { id: "strong", score: 0.84 }, // clearly related — link
      { id: "loose", score: 0.66 },  // shares a keyword but not really related — must NOT link
      { id: "weak", score: 0.4 },    // unrelated
    ], env);
    expect(db.edges).toHaveLength(1);
    const linked = db.edges.flatMap((e: any) => [e.source_id, e.target_id]).filter((id: string) => id !== "new");
    expect(linked).toEqual(["strong"]);
    expect(db.edges[0].type).toBe("relates_to");
    expect(db.edges[0].provenance).toBe("inferred");
  });

  it("never links the new entry to itself", async () => {
    await inferEdgesOnWrite("new", [{ id: "new", score: 0.99 }, { id: "a", score: 0.8 }], env);
    expect(db.edges).toHaveLength(1);
    expect([db.edges[0].source_id, db.edges[0].target_id].sort()).toEqual(["a", "new"]);
  });

  it("caps at the top 3 strongest neighbors", async () => {
    await inferEdgesOnWrite("new", [
      { id: "a", score: 0.9 }, { id: "b", score: 0.85 }, { id: "c", score: 0.8 },
      { id: "d", score: 0.75 }, { id: "e", score: 0.7 },
    ], env);
    expect(db.edges).toHaveLength(3);
    const linked = db.edges.flatMap((e: any) => [e.source_id, e.target_id]).filter((id: string) => id !== "new");
    expect(linked.sort()).toEqual(["a", "b", "c"]);
  });

  it("uses the similarity score as the edge weight", async () => {
    await inferEdgesOnWrite("new", [{ id: "a", score: 0.82 }], env);
    expect(db.edges[0].weight).toBeCloseTo(0.82);
  });

  it("writes nothing when there are no qualifying neighbors", async () => {
    await inferEdgesOnWrite("new", [{ id: "a", score: 0.3 }], env);
    expect(db.edges).toHaveLength(0);
  });
});

describe("createEdge visibility", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("rejects edge between private entries of different owners", async () => {
    db.entries.push(
      { id: "a", content: "A private", tags: '["private"]', source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "private" },
      { id: "b", content: "B private", tags: '["private"]', source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u2", visibility: "private" },
    );
    const result = await createEdge("a", "b", "relates_to", {}, env);
    expect(result).toBeNull();
    expect(db.edges).toHaveLength(0);
  });

  it("allows edge between public entries of different owners", async () => {
    db.entries.push(
      { id: "a", content: "A public", tags: "[]", source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "public" },
      { id: "b", content: "B public", tags: "[]", source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u2", visibility: "public" },
    );
    const result = await createEdge("a", "b", "relates_to", {}, env);
    expect(result).not.toBeNull();
    expect(db.edges).toHaveLength(1);
  });

  it("allows edge between entries of the same owner (both private)", async () => {
    db.entries.push(
      { id: "a", content: "A private", tags: '["private"]', source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "private" },
      { id: "b", content: "B private", tags: '["private"]', source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "private" },
    );
    const result = await createEdge("a", "b", "relates_to", {}, env);
    expect(result).not.toBeNull();
    expect(db.edges).toHaveLength(1);
  });

  it("rejects an edge across the private/public boundary even for the same owner", async () => {
    db.entries.push(
      { id: "a", content: "A private", tags: '["private"]', source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "private" },
      { id: "b", content: "B public", tags: "[]", source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "public" },
    );
    const result = await createEdge("a", "b", "relates_to", {}, env);
    expect(result).toBeNull();
    expect(db.edges).toHaveLength(0);
  });

  it("rejects edge from private to public of different owner", async () => {
    db.entries.push(
      { id: "a", content: "A private", tags: '["private"]', source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u1", visibility: "private" },
      { id: "b", content: "B public", tags: "[]", source: "api", created_at: 1, vector_ids: "[]", owner_user_id: "u2", visibility: "public" },
    );
    const result = await createEdge("a", "b", "relates_to", {}, env);
    expect(result).toBeNull();
    expect(db.edges).toHaveLength(0);
  });
});
