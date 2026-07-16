import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../src/testing";
import { makeTestEnv, makeTestDb, makeVectorizeMock } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";

const ctx = { waitUntil: (_: Promise<any>) => { } } as any;

function makeCtx() {
  const pending: Promise<any>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<any>) => pending.push(p) } as any,
    drain: () => Promise.allSettled(pending),
  };
}

describe("POST /api/users", () => {
  let env: Env;
  beforeEach(() => { env = makeTestEnv(); });

  it("creates a user and returns username + key", async () => {
    const res = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.username).toBe("alice");
    expect(data.key).toMatch(/^sbu_[a-f0-9]+\.[a-zA-Z0-9]+$/);
  });

  it("rejects duplicate username", async () => {
    await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    const res = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    expect(res.status).toBe(409);
    const data = await res.json() as any;
    expect(data.error).toMatch(/already exists/i);
  });

  it("rejects invalid username (special characters)", async () => {
    const res = await worker.fetch(req("POST", "/api/users", { body: { username: "alice bob" } }), env, ctx);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toMatch(/alphanumeric/i);
  });

  it("rejects username that is too long", async () => {
    const res = await worker.fetch(req("POST", "/api/users", { body: { username: "a".repeat(33) } }), env, ctx);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toMatch(/32 characters/i);
  });

  it("requires auth", async () => {
    const res = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" }, token: null }), env, ctx);
    expect(res.status).toBe(401);
  });

  it("can authenticate with created user's key", async () => {
    const createRes = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    const { key } = await createRes.json() as any;

    const listRes = await worker.fetch(
      req("GET", "/list", { userCredentials: { username: "alice", key } }),
      env, ctx
    );
    expect(listRes.status).toBe(200);
  });
});

describe("GET /api/users", () => {
  let env: Env;
  beforeEach(() => { env = makeTestEnv(); });

  it("returns empty array initially", async () => {
    const res = await worker.fetch(req("GET", "/api/users"), env, ctx);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.users).toEqual([]);
  });

  it("returns active users after creation", async () => {
    await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, ctx);
    await worker.fetch(req("POST", "/api/users", { body: { username: "bob" } }), env, ctx);
    const res = await worker.fetch(req("GET", "/api/users"), env, ctx);
    const data = await res.json() as any;
    expect(data.users).toHaveLength(2);
    expect(data.users.map((u: any) => u.username).sort()).toEqual(["alice", "bob"]);
    for (const u of data.users) {
      expect(u.id).toBeDefined();
      expect(u.status).toBe("active");
    }
  });

  it("requires auth", async () => {
    const res = await worker.fetch(req("GET", "/api/users", { token: null }), env, ctx);
    expect(res.status).toBe(401);
  });
});

// ── Deactivation ─────────────────────────────────────────────────────────────

describe("POST /api/users/:id/deactivate", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  async function createUser(username: string): Promise<{ id: string; key: string }> {
    const res = await worker.fetch(req("POST", "/api/users", { body: { username } }), env, ctx);
    const data = await res.json() as any;
    // Look up the actual user ID from the database
    const userRow = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first() as any;
    return { id: userRow?.id ?? data.username, key: data.key };
  }

  it("user can deactivate themselves", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob"); // second active user so alice isn't last

    // Alice authenticates and deactivates herself
    const deactivateRes = await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    const data = await deactivateRes.json() as any;
    expect(data.ok).toBe(true);

    // Verify user is inactive
    const userRow = await env.DB.prepare("SELECT status FROM users WHERE username = ?").bind("alice").first() as any;
    expect(userRow?.status).toBe("inactive");
  });

  it("first-created user (owner) can deactivate others", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    // Alice (first created) deactivates Bob
    const deactivateRes = await worker.fetch(
      req("POST", `/api/users/${bob.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    const data = await deactivateRes.json() as any;
    expect(data.ok).toBe(true);
  });

  it("non-owner cannot deactivate other users", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    // Bob (not first created) tries to deactivate Alice
    const deactivateRes = await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "bob", key: bob.key } }),
      env, ctx,
    );
    expect(deactivateRes.status).toBe(403);
  });

  it("deactivated user's private memories are deleted", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob"); // second active user so alice isn't last

    // Create entries as Alice
    await worker.fetch(
      req("POST", "/capture", { body: { content: "Private memory", tags: ["private"] }, userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    await worker.fetch(
      req("POST", "/capture", { body: { content: "Public memory" }, userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    expect(db.entries).toHaveLength(2);

    // Deactivate Alice
    await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );

    // Private entries should be deleted, public entries retained
    const remaining = db.entries.filter(e => e.owner_user_id !== "" || !JSON.parse(e.tags ?? "[]").includes("private"));
    expect(db.entries.filter(e => JSON.parse(e.tags ?? "[]").includes("private") && e.owner_user_id === alice.id)).toHaveLength(0);
    // Public entry should remain
    expect(db.entries.some(e => e.content === "Public memory")).toBe(true);
  });

  it("deactivated user's public memories are retained", async () => {
    const alice = await createUser("alice");

    await worker.fetch(
      req("POST", "/capture", { body: { content: "Important public note" }, userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );

    await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );

    // Public entry should still exist
    expect(db.entries.some(e => e.content === "Important public note")).toBe(true);
  });

  it("deactivated user cannot authenticate", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob"); // second active user so alice isn't last

    // Deactivate
    await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );

    // Try to access a protected route
    const res = await worker.fetch(
      req("GET", "/list", { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/users excludes inactive users", async () => {
    const alice = await createUser("alice");
    await createUser("bob");

    // Deactivate Alice
    await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );

    const res = await worker.fetch(req("GET", "/api/users"), env, ctx);
    const data = await res.json() as any;
    expect(data.users).toHaveLength(1);
    expect(data.users[0].username).toBe("bob");
  });

  it("cascade deletes edges for removed private entries", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob"); // second active user so alice isn't last

    // Create two private entries and link them
    const cap1 = await worker.fetch(
      req("POST", "/capture", { body: { content: "Private A", tags: ["private"] }, userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    const cap2 = await worker.fetch(
      req("POST", "/capture", { body: { content: "Private B", tags: ["private"] }, userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );
    const id1 = (await cap1.json() as any).id;
    const id2 = (await cap2.json() as any).id;

    // Add an edge manually
    db.edges.push({ id: "test-edge", source_id: id1, target_id: id2, type: "relates_to", weight: 0.8, provenance: "inferred", metadata: "{}", created_at: 1, updated_at: 1 });
    expect(db.edges).toHaveLength(1);

    // Deactivate
    await worker.fetch(
      req("POST", `/api/users/${alice.id}/deactivate`, { userCredentials: { username: "alice", key: alice.key } }),
      env, ctx,
    );

    // Edges should be cascade-deleted
    expect(db.edges).toHaveLength(0);
  });
});
