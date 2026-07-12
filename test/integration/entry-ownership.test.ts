import { describe, it, expect, beforeEach } from "vitest";
import worker, { _resetDbReady } from "../../src/index";
import { makeTestEnv, makeTestDb } from "../helpers/make-env";
import { req } from "../helpers/make-request";
import type { Env } from "../../src/index";
import { D1Mock } from "../helpers/d1-mock";

function makeCtx() {
  const promises: Promise<any>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<any>) => { promises.push(p); },
    } as any,
    flush: () => Promise.all(promises),
  };
}

describe("Entry Ownership", () => {
  let env: Env;
  let db: D1Mock;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
    _resetDbReady();
  });

  it("POST /capture stamps entry with authenticated user's owner_user_id", async () => {
    // Create a user
    const createRes = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, makeCtx().ctx);
    const { key } = await createRes.json() as any;

    // Capture entry as alice
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(
      req("POST", "/capture", { body: { content: "Alice's note" }, userCredentials: { username: "alice", key } }),
      env, ctx
    );
    expect(res.status).toBe(200);
    await flush();

    // Verify owner_user_id matches alice's user ID
    const aliceUser = db.users.find((u: any) => u.username === "alice");
    expect(aliceUser).toBeDefined();
    expect(db.entries[0].owner_user_id).toBe(aliceUser.id);
  });

  it("different users get different owner_user_id values", async () => {
    // Create two users
    const createAlice = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, makeCtx().ctx);
    const { key: aliceKey } = await createAlice.json() as any;
    const createBob = await worker.fetch(req("POST", "/api/users", { body: { username: "bob" } }), env, makeCtx().ctx);
    const { key: bobKey } = await createBob.json() as any;

    // Capture entries as different users
    const { ctx: ctx1, flush: flush1 } = makeCtx();
    await worker.fetch(
      req("POST", "/capture", { body: { content: "Alice's note" }, userCredentials: { username: "alice", key: aliceKey } }),
      env, ctx1
    );
    await flush1();

    const { ctx: ctx2, flush: flush2 } = makeCtx();
    await worker.fetch(
      req("POST", "/capture", { body: { content: "Bob's note" }, userCredentials: { username: "bob", key: bobKey } }),
      env, ctx2
    );
    await flush2();

    // Verify different owner_user_ids
    expect(db.entries).toHaveLength(2);
    expect(db.entries[0].owner_user_id).not.toBe(db.entries[1].owner_user_id);
    expect(db.entries[0].owner_user_id).toBe(db.users.find((u: any) => u.username === "alice").id);
    expect(db.entries[1].owner_user_id).toBe(db.users.find((u: any) => u.username === "bob").id);
  });

  it("legacy auth (bearer only) creates entries owned by system user", async () => {
    // Trigger initialization to create system user
    const { ctx, flush } = makeCtx();
    await worker.fetch(req("GET", "/list"), env, ctx);
    await flush();

    const systemUser = db.users.find((u: any) => u.username === "_system");
    expect(systemUser).toBeDefined();

    // Capture entry with legacy auth (no user headers)
    const { ctx: ctx2, flush: flush2 } = makeCtx();
    await worker.fetch(req("POST", "/capture", { body: { content: "Legacy note" } }), env, ctx2);
    await flush2();

    // Verify entry is owned by system user
    expect(db.entries[0].owner_user_id).toBe(systemUser.id);
  });

  it("POST /append preserves original owner_user_id", async () => {
    // Create a user and capture an entry
    const createRes = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, makeCtx().ctx);
    const { key } = await createRes.json() as any;

    const { ctx: ctx1, flush: flush1 } = makeCtx();
    const captureRes = await worker.fetch(
      req("POST", "/capture", { body: { content: "Original content" }, userCredentials: { username: "alice", key } }),
      env, ctx1
    );
    const { id } = await captureRes.json() as any;
    await flush1();

    const aliceUser = db.users.find((u: any) => u.username === "alice");
    expect(db.entries[0].owner_user_id).toBe(aliceUser.id);

    // Append to the entry (preserves ownership)
    const { ctx: ctx2 } = makeCtx();
    await worker.fetch(
      req("POST", "/append", { body: { id, addition: "Additional content" }, userCredentials: { username: "alice", key } }),
      env, ctx2
    );

    // Verify ownership is preserved
    expect(db.entries[0].owner_user_id).toBe(aliceUser.id);
  });

  it("POST /update preserves original owner_user_id", async () => {
    // Create a user and capture an entry
    const createRes = await worker.fetch(req("POST", "/api/users", { body: { username: "alice" } }), env, makeCtx().ctx);
    const { key } = await createRes.json() as any;

    const { ctx: ctx1, flush: flush1 } = makeCtx();
    const captureRes = await worker.fetch(
      req("POST", "/capture", { body: { content: "Original content" }, userCredentials: { username: "alice", key } }),
      env, ctx1
    );
    const { id } = await captureRes.json() as any;
    await flush1();

    const aliceUser = db.users.find((u: any) => u.username === "alice");
    expect(db.entries[0].owner_user_id).toBe(aliceUser.id);

    // Update the entry (preserves ownership)
    const { ctx: ctx2 } = makeCtx();
    await worker.fetch(
      req("POST", "/update", { body: { id, content: "Updated content" }, userCredentials: { username: "alice", key } }),
      env, ctx2
    );

    // Verify ownership is preserved
    expect(db.entries[0].owner_user_id).toBe(aliceUser.id);
  });
});
