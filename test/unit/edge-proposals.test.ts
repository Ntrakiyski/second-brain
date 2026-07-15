import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../src/index";
import { makeTestEnv, makeTestDb } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

function seedUser(db: D1Mock, id: string, username: string) {
  db.users.push({ id, username, normalized_username: username.toLowerCase(), auth_key_hash: "", auth_key_prefix: "", status: "active", created_at: 1 });
}

function seedEntry(db: D1Mock, id: string, content: string, owner_user_id = "") {
  db.entries.push({ id, content, tags: "[]", source: "api", created_at: 1000, vector_ids: "[]", importance_score: 0, owner_user_id });
}

describe("Edge Proposals", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
    seedUser(db, "user-a", "alice");
    seedUser(db, "user-b", "bob");
    seedEntry(db, "e1", "Coffee is great", "user-a");
    seedEntry(db, "e2", "Coffee is bad for you", "user-b");
  });

  describe("POST /edge-proposals", () => {
    it("creates a proposal", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "Contradiction detected" },
      }), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.proposal).toBeDefined();
      expect(data.proposal.status).toBe("pending");
      expect(data.proposal.source_id).toBe("e1");
      expect(data.proposal.target_id).toBe("e2");
    });

    it("requires auth", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "test" },
        token: null,
      }), env, ctx);
      expect(res.status).toBe(401);
    });

    it("validates required fields", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1" },
      }), env, ctx);
      expect(res.status).toBe(400);
    });

    it("deduplicates pending proposals for same (source_id, target_id, type)", async () => {
      await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "first" },
      }), env, ctx);

      const res = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "second" },
      }), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      // Should return existing proposal, not create a new one
      expect(data.proposal.reason).toBe("first");
    });

    it("allows different types for same pair", async () => {
      await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "first" },
      }), env, ctx);

      const res = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "caused_by", reason: "second" },
      }), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.proposal.type).toBe("caused_by");
    });

    it("allows new proposal after previous is resolved", async () => {
      // Create and approve first proposal
      const createRes = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "first" },
      }), env, ctx);
      const { proposal } = await createRes.json() as any;
      await worker.fetch(req("POST", `/edge-proposals/${proposal.id}/approve`), env, ctx);

      // Now create a new proposal for same pair
      const res = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "reopened" },
      }), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.proposal.reason).toBe("reopened");
    });
  });

  describe("GET /edge-proposals", () => {
    it("returns pending proposals", async () => {
      await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "test" },
      }), env, ctx);

      const res = await worker.fetch(req("GET", "/edge-proposals"), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.proposals).toHaveLength(1);
      expect(data.proposals[0].status).toBe("pending");
    });

    it("excludes resolved proposals", async () => {
      const createRes = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "test" },
      }), env, ctx);
      const { proposal } = await createRes.json() as any;
      await worker.fetch(req("POST", `/edge-proposals/${proposal.id}/approve`), env, ctx);

      const res = await worker.fetch(req("GET", "/edge-proposals"), env, ctx);
      const data = await res.json() as any;
      expect(data.proposals).toHaveLength(0);
    });

    it("requires auth", async () => {
      const res = await worker.fetch(req("GET", "/edge-proposals", { token: null }), env, ctx);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /edge-proposals/:id/approve", () => {
    it("creates edge and marks proposal approved", async () => {
      const createRes = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "contradiction" },
      }), env, ctx);
      const { proposal } = await createRes.json() as any;

      const res = await worker.fetch(req("POST", `/edge-proposals/${proposal.id}/approve`), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.proposal.status).toBe("approved");

      // Edge should exist now
      const edge = db.edges.find((e: any) => e.source_id === "e1" && e.target_id === "e2");
      expect(edge).toBeDefined();
      expect(edge.type).toBe("relates_to");
    });

    it("returns 404 for unknown proposal", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals/nonexistent/approve"), env, ctx);
      expect(res.status).toBe(404);
    });

    it("requires auth", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals/p1/approve", { token: null }), env, ctx);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /edge-proposals/:id/reject", () => {
    it("marks proposal rejected without creating edge", async () => {
      const createRes = await worker.fetch(req("POST", "/edge-proposals", {
        body: { source_id: "e1", target_id: "e2", type: "relates_to", reason: "bad" },
      }), env, ctx);
      const { proposal } = await createRes.json() as any;

      const res = await worker.fetch(req("POST", `/edge-proposals/${proposal.id}/reject`), env, ctx);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.proposal.status).toBe("rejected");

      // No edge created
      const edge = db.edges.find((e: any) => e.source_id === "e1" && e.target_id === "e2");
      expect(edge).toBeUndefined();
    });

    it("returns 404 for unknown proposal", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals/nonexistent/reject"), env, ctx);
      expect(res.status).toBe(404);
    });

    it("requires auth", async () => {
      const res = await worker.fetch(req("POST", "/edge-proposals/p1/reject", { token: null }), env, ctx);
      expect(res.status).toBe(401);
    });
  });
});
