import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../src/index";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

function makeMatch(id: string, score: number, overrides: Record<string, any> = {}) {
  return { id, score, metadata: { parentId: id, isUpdate: false, ...overrides } };
}

describe("Recall v2 — relations in results (Ticket 09)", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("recall returns relations field for entries with linked edges", async () => {
    const now = Date.now();
    const SYSTEM_USER_ID = "sys-user-rel";

    db.users.push({
      id: SYSTEM_USER_ID, username: "_system", normalized_username: "_system",
      auth_key_hash: "", auth_key_prefix: "", status: "active", created_at: now,
    });

    db.entries.push(
      {
        id: "entry-a", content: "First fact", tags: "[]", source: "api",
        created_at: now, vector_ids: "[]", recall_count: 0, importance_score: 0,
        contradiction_wins: 0, contradiction_losses: 0, owner_user_id: SYSTEM_USER_ID,
        valid_from: now, valid_to: null, recorded_at: now, epistemic_status: "canonical",
      },
      {
        id: "entry-b", content: "Second fact", tags: "[]", source: "api",
        created_at: now, vector_ids: "[]", recall_count: 0, importance_score: 0,
        contradiction_wins: 0, contradiction_losses: 0, owner_user_id: SYSTEM_USER_ID,
        valid_from: now, valid_to: null, recorded_at: now, epistemic_status: "canonical",
      },
    );

    // Edge from A to B
    db.edges.push({
      source_id: "entry-a", target_id: "entry-b", type: "relates_to",
      weight: 0.8, provenance: "explicit", metadata: JSON.stringify({ confidence: 0.9 }),
      created_at: now, updated_at: now,
    });

    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({
          matches: [
            makeMatch("entry-a", 0.9),
            makeMatch("entry-b", 0.7),
          ],
        }),
      }),
    });

    const res = await worker.fetch(
      req("GET", `/recall?query=test&topK=5`),
      env, ctx
    );
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(2);

    // entry-a has a relation to entry-b
    const entryA = data.results.find((r: any) => r.id === "entry-a");
    expect(entryA.relations).toBeDefined();
    expect(entryA.relations.length).toBeGreaterThanOrEqual(1);
    expect(entryA.relations[0]).toMatchObject({
      type: "relates_to",
    });

    // entry-b has no outgoing edges — the current implementation only maps relations
    // for the source side of each edge, so entry-b has no relations field.
    const entryB = data.results.find((r: any) => r.id === "entry-b");
    expect(entryB.relations).toBeUndefined();
  });

  it("recall returns epistemic_status in results", async () => {
    const now = Date.now();
    const SYSTEM_USER_ID = "sys-user-epi";

    db.users.push({
      id: SYSTEM_USER_ID, username: "_system", normalized_username: "_system",
      auth_key_hash: "", auth_key_prefix: "", status: "active", created_at: now,
    });

    db.entries.push({
      id: "canonical-entry", content: "Canonical fact", tags: "[]", source: "api",
      created_at: now, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: SYSTEM_USER_ID,
      valid_from: now, valid_to: null, recorded_at: now, epistemic_status: "canonical",
    });

    env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({
          matches: [makeMatch("canonical-entry", 0.9)],
        }),
      }),
    });

    const res = await worker.fetch(
      req("GET", `/recall?query=test&topK=5`),
      env, ctx
    );
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].epistemic_status).toBe("canonical");
  });
});
