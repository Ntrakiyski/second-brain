import { describe, it, expect, vi } from "vitest";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";

const OWNER_A = "user-a";
const OWNER_B = "user-b";

function insertEntry(db: any, id: string, content: string, tags: string[], ownerId: string, createdAt?: number) {
  db.entries.push({
    id,
    content,
    tags: JSON.stringify(tags),
    source: "test",
    created_at: createdAt ?? Date.now(),
    vector_ids: `["v-${id}"]`,
    recall_count: 0,
    importance_score: 0,
    contradiction_wins: 0,
    contradiction_losses: 0,
    owner_user_id: ownerId,
    last_recalled_at: null,
    valid_from: null,
    recorded_at: null,
    valid_to: null,
    epistemic_status: "canonical",
  });
}

describe("S06 — nightly cross-user contradiction detection", () => {
  it("creates proposals when entries from different users are highly similar", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-a", "I moved to Berlin last week", ["location"], OWNER_A);
    insertEntry(db, "entry-b", "I moved to Berlin last week", ["location"], OWNER_B);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const query = vi.fn().mockResolvedValue({
      matches: [
        { id: "v-entry-b", score: 0.92, metadata: { parentId: "entry-b", owner_user_id: OWNER_B } },
      ],
    });
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query,
      }),
    });

    const result = await detectCrossUserContradictions(env);

    // Both public entries get scanned
    expect(result.scanned).toBe(2);
    expect(result.proposals).toBeGreaterThanOrEqual(1);

    const proposal = db.edgeProposals.find((p: any) =>
      p.source_id === "entry-b" && p.target_id === "entry-a" && p.type === "contradicts"
    );
    expect(proposal).toBeDefined();
    expect(proposal.status).toBe("pending");
    expect(proposal.proposed_by).toBe("_nightly_scan");
    expect(proposal.reason).toContain("similarity");
    for (const [, options] of query.mock.calls) {
      expect(options).toMatchObject({ filter: { is_private: { $eq: false } } });
      expect(options).not.toHaveProperty("metadataFilter");
    }
  });

  it("does not create proposals when similarity is below threshold", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-a", "I live in Berlin", ["location"], OWNER_A);
    insertEntry(db, "entry-b", "I visited Berlin once", ["travel"], OWNER_B);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: "v-entry-b", score: 0.6, metadata: { parentId: "entry-b", owner_user_id: OWNER_B } },
          ],
        }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    expect(result.scanned).toBe(2);
    expect(result.proposals).toBe(0);
  });

  it("does not create proposal when match is from same user", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-a", "I moved to Berlin", ["location"], OWNER_A);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: "v-entry-a", score: 0.95, metadata: { parentId: "entry-a", owner_user_id: OWNER_A } },
          ],
        }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    expect(result.scanned).toBe(1);
    expect(result.proposals).toBe(0);
  });

  it("does not duplicate existing proposals", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-a", "I moved to Berlin", ["location"], OWNER_A);
    insertEntry(db, "entry-b", "I moved to Berlin", ["location"], OWNER_B);

    // Pre-insert existing proposal
    db.edgeProposals.push({
      id: "existing-proposal",
      source_id: "entry-b",
      target_id: "entry-a",
      type: "contradicts",
      reason: "already exists",
      proposed_by: "_nightly_scan",
      status: "pending",
      created_at: Date.now(),
    });

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: "v-entry-b", score: 0.92, metadata: { parentId: "entry-b", owner_user_id: OWNER_B } },
          ],
        }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    expect(result.scanned).toBe(2);
    expect(result.proposals).toBe(0);

    const proposals = db.edgeProposals.filter((p: any) =>
      p.source_id === "entry-b" && p.target_id === "entry-a"
    );
    expect(proposals.length).toBe(1);
  });

  it("skips entries that are too old (>7 days)", async () => {
    const db = makeTestDb();
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    insertEntry(db, "entry-old", "I moved to Berlin", ["location"], OWNER_A, eightDaysAgo);
    insertEntry(db, "entry-new", "I moved to Berlin", ["location"], OWNER_B);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({ matches: [] }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    // Only the new entry is scanned (old one is filtered out by 7-day window)
    expect(result.scanned).toBe(1);
    expect(result.proposals).toBe(0);
  });

  it("skips private entries", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-private", "I moved to Berlin", ["private"], OWNER_A);
    insertEntry(db, "entry-public", "I moved to Berlin", ["location"], OWNER_B);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({ matches: [] }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    // Only the public entry is scanned (private one is filtered out)
    expect(result.scanned).toBe(1);
    expect(result.proposals).toBe(0);
  });

  it("uses D1 ownership instead of hostile vector metadata", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-a", "I moved to Berlin", ["location"], OWNER_A);
    insertEntry(db, "entry-b", "I moved away from Berlin", ["location"], OWNER_B);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({ matches: [
          // The payload lies that entry-b belongs to the source owner. D1 says
          // it belongs to OWNER_B, so it remains a valid cross-user candidate.
          { id: "v-entry-b", score: 0.93, metadata: { parentId: "entry-b", owner_user_id: OWNER_A, is_private: false } },
        ] }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    expect(result.proposals).toBeGreaterThanOrEqual(1);
    expect(db.edgeProposals.some((proposal: any) =>
      proposal.source_id === "entry-b" && proposal.target_id === "entry-a"
    )).toBe(true);
  });

  it("rejects a D1-private match even when vector metadata claims it is public", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry-a", "I moved to Berlin", ["location"], OWNER_A);
    insertEntry(db, "entry-private", "I moved away from Berlin", ["private"], OWNER_B);

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({
        query: vi.fn().mockResolvedValue({ matches: [
          { id: "v-entry-private", score: 0.99, metadata: { parentId: "entry-private", owner_user_id: OWNER_B, is_private: false } },
        ] }),
      }),
    });

    const result = await detectCrossUserContradictions(env);

    expect(result.scanned).toBe(1);
    expect(result.proposals).toBe(0);
  });

  it("fails closed for a recent source whose tags are not an array", async () => {
    const db = makeTestDb();
    insertEntry(db, "malformed", "Do not inspect", ["location"], OWNER_A);
    db.entries[0].tags = JSON.stringify("location");
    const query = vi.fn().mockResolvedValue({ matches: [] });

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db, { VECTORIZE: makeVectorizeMock({ query }) });
    const result = await detectCrossUserContradictions(env);

    expect(result).toEqual({ scanned: 0, proposals: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns zero when no entries exist", async () => {
    const db = makeTestDb();

    const { detectCrossUserContradictions } = await import("../../src/lifecycle");
    const env = makeTestEnv(db);

    const result = await detectCrossUserContradictions(env);

    expect(result.scanned).toBe(0);
    expect(result.proposals).toBe(0);
  });
});
