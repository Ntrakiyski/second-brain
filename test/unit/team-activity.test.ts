import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../src/testing";
import { makeTestEnv, makeTestDb } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/testing";
import { D1Mock } from "../helpers/d1-mock";

const ctx = { waitUntil: (_: Promise<any>) => {} } as any;

function seedUser(db: D1Mock, id: string, username: string) {
  db.users.push({ id, username, normalized_username: username.toLowerCase(), auth_key_hash: "", auth_key_prefix: "", status: "active", created_at: 1 });
}

function seedEntry(db: D1Mock, id: string, content: string, tags: string[] = [], owner_user_id = "", created_at = 1000) {
  db.entries.push({ id, content, tags: JSON.stringify(tags), source: "api", created_at, vector_ids: "[]", importance_score: 0, owner_user_id });
}

describe("GET /team-activity", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
    seedUser(db, "user-a", "alice");
    seedUser(db, "user-b", "bob");
  });

  it("requires auth", async () => {
    const res = await worker.fetch(req("GET", "/team-activity", { token: null }), env, ctx);
    expect(res.status).toBe(401);
  });

  it("returns recent public entries from all users", async () => {
    seedEntry(db, "a1", "Alice public", [], "user-a", 1000);
    seedEntry(db, "b1", "Bob public", [], "user-b", 2000);

    const res = await worker.fetch(req("GET", "/team-activity"), env, ctx);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.entries).toHaveLength(2);
    // newest first
    expect(data.entries[0].id).toBe("b1");
    expect(data.entries[1].id).toBe("a1");
  });

  it("excludes other users' private entries", async () => {
    seedEntry(db, "a1", "Alice public", [], "user-a", 1000);
    seedEntry(db, "a2", "Alice private", ["private"], "user-a", 2000);
    seedEntry(db, "b1", "Bob public", [], "user-b", 3000);

    const res = await worker.fetch(req("GET", "/team-activity"), env, ctx);
    const data = await res.json() as any;
    expect(data.entries).toHaveLength(2);
    expect(data.entries.map((e: any) => e.id)).not.toContain("a2");
  });

  it("includes owner_username for each entry", async () => {
    seedEntry(db, "a1", "Alice post", [], "user-a", 1000);

    const res = await worker.fetch(req("GET", "/team-activity"), env, ctx);
    const data = await res.json() as any;
    expect(data.entries[0].owner_username).toBe("alice");
  });

  it("filters by user when ?user= is provided", async () => {
    seedEntry(db, "a1", "Alice post", [], "user-a", 1000);
    seedEntry(db, "b1", "Bob post", [], "user-b", 2000);

    const res = await worker.fetch(req("GET", "/team-activity?user=alice"), env, ctx);
    const data = await res.json() as any;
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].id).toBe("a1");
  });

  it("respects ?limit= parameter", async () => {
    for (let i = 0; i < 10; i++) seedEntry(db, `e${i}`, `Memory ${i}`, [], "user-a", 1000 + i);

    const res = await worker.fetch(req("GET", "/team-activity?limit=3"), env, ctx);
    const data = await res.json() as any;
    expect(data.entries).toHaveLength(3);
  });

  it("caps limit at 50", async () => {
    for (let i = 0; i < 60; i++) seedEntry(db, `e${i}`, `Memory ${i}`, [], "user-a", 1000 + i);

    const res = await worker.fetch(req("GET", "/team-activity?limit=100"), env, ctx);
    const data = await res.json() as any;
    expect(data.entries).toHaveLength(50);
  });

  it("supports cursor-based pagination via created_at", async () => {
    for (let i = 0; i < 5; i++) seedEntry(db, `e${i}`, `Memory ${i}`, [], "user-a", 1000 + i * 100);

    const res1 = await worker.fetch(req("GET", "/team-activity?limit=2"), env, ctx);
    const data1 = await res1.json() as any;
    expect(data1.entries).toHaveLength(2);
    const lastCreated = data1.entries[1].created_at;

    const res2 = await worker.fetch(req("GET", `/team-activity?limit=2&after=${lastCreated}`), env, ctx);
    const data2 = await res2.json() as any;
    expect(data2.entries).toHaveLength(2);
    // All entries in page 2 should be older than the last entry in page 1
    expect(data2.entries.every((e: any) => e.created_at <= lastCreated)).toBe(true);
  });
});
