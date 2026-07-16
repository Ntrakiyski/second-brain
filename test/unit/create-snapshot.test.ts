import { describe, it, expect, beforeEach } from "vitest";
import { createSnapshot } from "../../src/testing";
import { makeTestDb, makeTestEnv } from "../helpers/make-env";
import type { Env } from "../../src/types";
import { D1Mock } from "../helpers/d1-mock";

describe("createSnapshot()", () => {
  let db: D1Mock;
  let env: Env;

  beforeEach(() => {
    db = makeTestDb();
    env = makeTestEnv(db);
  });

  it("creates a snapshot from existing entry", async () => {
    const entryId = "snap-test-1";
    await db.prepare(
      `INSERT INTO entries (id, content, tags, source, vector_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(entryId, "Hello world", '["tag1"]', "api", "[]", Date.now()).run();

    const snapshotId = await createSnapshot(env, entryId);

    expect(snapshotId).toBeTruthy();
    const snap = await db.prepare(`SELECT * FROM entry_snapshots WHERE id = ?`).bind(snapshotId!).first() as any;
    expect(snap).toBeTruthy();
    expect(snap.entry_id).toBe(entryId);
    expect(snap.content).toBe("Hello world");
    expect(snap.tags).toBe('["tag1"]');
    expect(snap.source).toBe("api");
    expect(snap.created_at).toBeTruthy();
  });

  it("returns null when entry does not exist", async () => {
    const result = await createSnapshot(env, "nonexistent-id");
    expect(result).toBeNull();
  });

  it("uses default source when entry has no source", async () => {
    const entryId = "snap-test-no-source";
    await db.prepare(
      `INSERT INTO entries (id, content, tags, source, vector_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(entryId, "Content", "[]", null, "[]", Date.now()).run();

    const snapshotId = await createSnapshot(env, entryId);
    expect(snapshotId).toBeTruthy();

    const snap = await db.prepare(`SELECT source FROM entry_snapshots WHERE id = ?`).bind(snapshotId!).first() as any;
    expect(snap.source).toBe("api");
  });

  it("uses default tags when entry has no tags", async () => {
    const entryId = "snap-test-no-tags";
    await db.prepare(
      `INSERT INTO entries (id, content, tags, source, vector_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(entryId, "Content", null, "api", "[]", Date.now()).run();

    const snapshotId = await createSnapshot(env, entryId);
    const snap = await db.prepare(`SELECT tags FROM entry_snapshots WHERE id = ?`).bind(snapshotId!).first() as any;
    expect(snap.tags).toBe("[]");
  });

  it("multiple snapshots for same entry have unique IDs", async () => {
    const entryId = "snap-test-multi";
    await db.prepare(
      `INSERT INTO entries (id, content, tags, source, vector_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(entryId, "Content", "[]", "api", "[]", Date.now()).run();

    const id1 = await createSnapshot(env, entryId);
    const id2 = await createSnapshot(env, entryId);

    expect(id1).not.toBe(id2);
    const { results } = await db.prepare(`SELECT id FROM entry_snapshots WHERE entry_id = ?`).bind(entryId).all();
    expect(results.length).toBe(2);
  });
});
