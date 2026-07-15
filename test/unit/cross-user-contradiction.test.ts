import { describe, it, expect, vi } from "vitest";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";

const OWNER_A = "user-a";
const OWNER_B = "user-b";

function insertEntry(db: any, id: string, content: string, tags: string[], ownerId: string) {
  db.entries.push({
    id,
    content,
    tags: JSON.stringify(tags),
    source: "test",
    created_at: Date.now(),
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

describe("S05 — recall cross-user contradiction detection", () => {
  it("creates edge_proposals when recall surfaces a cross-user match with similarity ≥ 0.85", async () => {
    const db = makeTestDb();
    insertEntry(db, "caller-entry", "I work at Acme Corp", ["work"], OWNER_A);
    insertEntry(db, "other-entry", "I work at Acme Corp now", ["work"], OWNER_B);

    let queryCount = 0;
    const queryMock = vi.fn().mockImplementation(async () => {
      queryCount++;
      if (queryCount === 1) {
        // First query: initial dense recall — returns both entries
        return {
          matches: [
            { id: "v-caller-entry", score: 0.95, metadata: { parentId: "caller-entry", owner_user_id: OWNER_A } },
            { id: "v-other-entry", score: 0.92, metadata: { parentId: "other-entry", owner_user_id: OWNER_B } },
          ],
        };
      }
      // Second query: cross-user match lookup — caller's entry similar to other's content
      return {
        matches: [
          { id: "v-caller-entry", score: 0.90, metadata: { parentId: "caller-entry", owner_user_id: OWNER_A } },
        ],
      };
    });

    const { recallEntries } = await import("../../src/recall");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ query: queryMock }),
    });

    const result = await recallEntries(
      { query: "where do I work", topK: 5, userId: OWNER_A },
      env,
      { waitUntil: vi.fn() } as any,
    );

    console.log("matches count:", result.matches.length);
    console.log("matches:", result.matches.map(m => m.id));
    console.log("proposed_edges:", JSON.stringify(result.proposed_edges));
    console.log("queryMock calls:", queryMock.mock.calls.length);

    expect(result.proposed_edges.length).toBe(1);
    expect(result.proposed_edges[0]).toMatchObject({
      source_id: "caller-entry",
      target_id: "other-entry",
      type: "contradicts",
    });
    expect(result.proposed_edges[0].reason).toContain("similarity");

    // Verify proposal was written to D1
    const proposal = db.edgeProposals.find((p: any) =>
      p.source_id === "caller-entry" && p.target_id === "other-entry"
    );
    expect(proposal).toBeDefined();
    expect(proposal.status).toBe("pending");
  });

  it("returns empty proposed_edges when no userId is provided", async () => {
    const db = makeTestDb();
    insertEntry(db, "e1", "Some content", [], OWNER_A);

    const { recallEntries } = await import("../../src/recall");
    const env = makeTestEnv(db);

    const result = await recallEntries(
      { query: "some content", topK: 5 },
      env,
      { waitUntil: vi.fn() } as any,
    );

    expect(result.proposed_edges).toEqual([]);
  });

  it("does not create proposal when similarity is below 0.85 threshold", async () => {
    const db = makeTestDb();
    insertEntry(db, "caller-entry", "I work at Acme Corp", ["work"], OWNER_A);
    insertEntry(db, "other-entry", "I work at Acme Corp", ["work"], OWNER_B);

    let queryCount = 0;
    const queryMock = vi.fn().mockImplementation(async () => {
      queryCount++;
      if (queryCount === 1) {
        return {
          matches: [
            { id: "v-caller-entry", score: 0.9, metadata: { parentId: "caller-entry", owner_user_id: OWNER_A } },
            { id: "v-other-entry", score: 0.8, metadata: { parentId: "other-entry", owner_user_id: OWNER_B } },
          ],
        };
      }
      return {
        matches: [
          { id: "v-caller-entry", score: 0.80, metadata: { parentId: "caller-entry", owner_user_id: OWNER_A } },
        ],
      };
    });

    const { recallEntries } = await import("../../src/recall");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ query: queryMock }),
    });

    const result = await recallEntries(
      { query: "where do I work", topK: 5, userId: OWNER_A },
      env,
      { waitUntil: vi.fn() } as any,
    );

    expect(result.proposed_edges).toEqual([]);
  });

  it("does not create duplicate proposal when one already exists", async () => {
    const db = makeTestDb();
    insertEntry(db, "caller-entry", "I work at Acme Corp", ["work"], OWNER_A);
    insertEntry(db, "other-entry", "I work at Acme Corp now", ["work"], OWNER_B);

    // Pre-insert existing proposal
    db.edgeProposals.push({
      id: "existing-proposal",
      source_id: "caller-entry",
      target_id: "other-entry",
      type: "contradicts",
      reason: "existing",
      proposed_by: OWNER_A,
      status: "pending",
      created_at: Date.now(),
    });

    let queryCount = 0;
    const queryMock = vi.fn().mockImplementation(async () => {
      queryCount++;
      if (queryCount === 1) {
        return {
          matches: [
            { id: "v-caller-entry", score: 0.95, metadata: { parentId: "caller-entry", owner_user_id: OWNER_A } },
            { id: "v-other-entry", score: 0.92, metadata: { parentId: "other-entry", owner_user_id: OWNER_B } },
          ],
        };
      }
      return {
        matches: [
          { id: "v-caller-entry", score: 0.90, metadata: { parentId: "caller-entry", owner_user_id: OWNER_A } },
        ],
      };
    });

    const { recallEntries } = await import("../../src/recall");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ query: queryMock }),
    });

    const result = await recallEntries(
      { query: "where do I work", topK: 5, userId: OWNER_A },
      env,
      { waitUntil: vi.fn() } as any,
    );

    expect(result.proposed_edges).toEqual([]);
    const proposals = db.edgeProposals.filter((p: any) =>
      p.source_id === "caller-entry" && p.target_id === "other-entry"
    );
    expect(proposals.length).toBe(1);
  });

  it("does not create proposal when match is from same user", async () => {
    const db = makeTestDb();
    insertEntry(db, "entry1", "I work at Acme Corp", ["work"], OWNER_A);
    insertEntry(db, "entry2", "I work at Acme Corp now", ["work"], OWNER_A);

    let queryCount = 0;
    const queryMock = vi.fn().mockImplementation(async () => {
      queryCount++;
      if (queryCount === 1) {
        return {
          matches: [
            { id: "v-entry1", score: 0.95, metadata: { parentId: "entry1", owner_user_id: OWNER_A } },
            { id: "v-entry2", score: 0.92, metadata: { parentId: "entry2", owner_user_id: OWNER_A } },
          ],
        };
      }
      return {
        matches: [
          { id: "v-entry1", score: 0.90, metadata: { parentId: "entry1", owner_user_id: OWNER_A } },
        ],
      };
    });

    const { recallEntries } = await import("../../src/recall");
    const env = makeTestEnv(db, {
      VECTORIZE: makeVectorizeMock({ query: queryMock }),
    });

    const result = await recallEntries(
      { query: "where do I work", topK: 5, userId: OWNER_A },
      env,
      { waitUntil: vi.fn() } as any,
    );

    expect(result.proposed_edges).toEqual([]);
  });
});
