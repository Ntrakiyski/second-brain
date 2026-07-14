import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectStaleness } from "../../src/index";
import { makeTestEnv, makeTestDb } from "../helpers/make-env";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

describe("Staleness detection (Ticket 06)", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("marks entries as stale when valid_to is set", async () => {
    const now = Date.now();
    db.entries.push({
      id: "expired-1", content: "Expired fact", tags: "[]", source: "api",
      created_at: now - 200000, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
      valid_from: now - 200000, valid_to: now - 100000, recorded_at: now - 200000,
      epistemic_status: "canonical",
    });
    db.entries.push({
      id: "active-1", content: "Active fact", tags: "[]", source: "api",
      created_at: now - 200000, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
      valid_from: now - 200000, valid_to: null, recorded_at: now - 200000,
      epistemic_status: "canonical",
    });

    await detectStaleness(env);

    const expired = db.entries.find((e: any) => e.id === "expired-1");
    const active = db.entries.find((e: any) => e.id === "active-1");
    expect(expired!.epistemic_status).toBe("stale");
    expect(active!.epistemic_status).toBe("canonical");
  });

  it("marks entries as stale when incoming edge confidence is low", async () => {
    const now = Date.now();
    db.entries.push({
      id: "low-conf-entry", content: "Low confidence", tags: "[]", source: "api",
      created_at: now - 200000, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
      valid_from: now - 200000, valid_to: null, recorded_at: now - 200000,
      epistemic_status: "canonical",
    });
    // Edge pointing TO this entry with low confidence
    db.edges.push({
      source_id: "source-1", target_id: "low-conf-entry", type: "relates_to",
      weight: 0.3, provenance: "inferred", metadata: JSON.stringify({ confidence: 0.3 }),
      created_at: now, updated_at: now,
    });

    await detectStaleness(env);

    const entry = db.entries.find((e: any) => e.id === "low-conf-entry");
    expect(entry!.epistemic_status).toBe("stale");
  });

  it("does not mark already-stale entries again", async () => {
    const now = Date.now();
    db.entries.push({
      id: "already-stale", content: "Already stale", tags: "[]", source: "api",
      created_at: now - 200000, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
      valid_from: now - 200000, valid_to: now - 100000, recorded_at: now - 200000,
      epistemic_status: "stale",
    });

    await detectStaleness(env);

    const entry = db.entries.find((e: any) => e.id === "already-stale");
    expect(entry!.epistemic_status).toBe("stale");
  });

  it("does not mark entries with high-confidence incoming edges as stale", async () => {
    const now = Date.now();
    db.entries.push({
      id: "high-conf-entry", content: "High confidence", tags: "[]", source: "api",
      created_at: now - 200000, vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: "",
      valid_from: now - 200000, valid_to: null, recorded_at: now - 200000,
      epistemic_status: "canonical",
    });
    db.edges.push({
      source_id: "source-2", target_id: "high-conf-entry", type: "relates_to",
      weight: 0.8, provenance: "inferred", metadata: JSON.stringify({ confidence: 0.8 }),
      created_at: now, updated_at: now,
    });

    await detectStaleness(env);

    const entry = db.entries.find((e: any) => e.id === "high-conf-entry");
    expect(entry!.epistemic_status).toBe("canonical");
  });
});
