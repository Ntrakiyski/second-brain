import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../src/testing";
import { makeTestEnv, makeTestDb } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";
import { TEST_USER_ID } from "../helpers/test-principal";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

describe("Epistemic status REST endpoint (Ticket 10)", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("POST /epistemic-status returns 400 when id is missing", async () => {
    const res = await worker.fetch(
      req("POST", "/epistemic-status", { body: { status: "reviewed" } }),
      env, ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
  });

  it("POST /epistemic-status returns 400 when status is missing", async () => {
    const res = await worker.fetch(
      req("POST", "/epistemic-status", { body: { id: "entry-1" } }),
      env, ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
  });

  it("POST /epistemic-status returns 400 for invalid status value", async () => {
    db.entries.push({
      id: "entry-1", content: "Test", tags: "[]", source: "api",
      created_at: Date.now(), vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: TEST_USER_ID,
      epistemic_status: "candidate",
    });

    const res = await worker.fetch(
      req("POST", "/epistemic-status", { body: { id: "entry-1", status: "invalid-status" } }),
      env, ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toContain("status must be one of");
  });

  it("POST /epistemic-status returns 400 for invalid transition", async () => {
    db.entries.push({
      id: "entry-2", content: "Test", tags: "[]", source: "api",
      created_at: Date.now(), vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: TEST_USER_ID,
      epistemic_status: "candidate",
    });

    // candidate → canonical is invalid (must go through reviewed)
    const res = await worker.fetch(
      req("POST", "/epistemic-status", { body: { id: "entry-2", status: "canonical" } }),
      env, ctx
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid transition");
  });

  it("POST /epistemic-status succeeds for valid transition", async () => {
    db.entries.push({
      id: "entry-3", content: "Test", tags: "[]", source: "api",
      created_at: Date.now(), vector_ids: "[]", recall_count: 0, importance_score: 0,
      contradiction_wins: 0, contradiction_losses: 0, owner_user_id: TEST_USER_ID,
      epistemic_status: "candidate",
    });

    const res = await worker.fetch(
      req("POST", "/epistemic-status", { body: { id: "entry-3", status: "reviewed" } }),
      env, ctx
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.from).toBe("candidate");
    expect(data.to).toBe("reviewed");

    // Verify the entry was updated in the DB
    const entry = db.entries.find((e: any) => e.id === "entry-3");
    expect(entry!.epistemic_status).toBe("reviewed");
  });
});
