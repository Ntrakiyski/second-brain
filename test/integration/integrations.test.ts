import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencyMocks = vi.hoisted(() => ({
  commitEntryVersion: vi.fn(),
  forgetEntry: vi.fn(),
  initializeDatabase: vi.fn(),
}));

vi.mock("../../src/entry-version-service", () => ({
  commitEntryVersion: dependencyMocks.commitEntryVersion,
}));
vi.mock("../../src/lifecycle", () => ({
  forgetEntry: dependencyMocks.forgetEntry,
}));
vi.mock("../../src/db", () => ({
  initializeDatabase: dependencyMocks.initializeDatabase,
}));

import type { Env } from "../../src/types";
import {
  claimLegacyIntegration,
  deleteIntegration,
  integrationKey,
  loadIntegration,
  notionProvider,
  saveIntegration,
  type IntegrationRecord,
  type MirrorStore,
} from "../../src/integrations";
import {
  disconnectIntegration,
  isManagedMirror,
  makeMirrorStore,
  runScheduledIntegrationSync,
} from "../../src/integrations-mirror";
import { CRON_SYNC_MAX_BATCHES } from "../../src/config";

interface MemoryKv {
  kv: KVNamespace;
  values: Map<string, string>;
}

function memoryKv(): MemoryKv {
  const values = new Map<string, string>();
  return {
    values,
    kv: {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, String(value)); },
      delete: async (key: string) => { values.delete(key); },
      list: async (options: { prefix?: string } = {}) => ({
        keys: [...values.keys()]
          .filter((key) => !options.prefix || key.startsWith(options.prefix))
          .map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      }),
    } as unknown as KVNamespace,
  };
}

interface EntryRow {
  owner_user_id: string;
  source: string;
  revision: number;
  visibility: string;
  content?: string;
  tags?: string;
  valid_from?: number | null;
  valid_to?: number | null;
  epistemic_status?: string;
}

class IntegrationDb {
  readonly entries = new Map<string, EntryRow>();
  readonly committedCreates = new Map<string, string>();
  readonly committedUpdates = new Set<string>();
  eligibleUsers: { id: string }[] = [];
  schedulerSql = "";

  prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },
      first: async () => {
        if (sql.includes("SELECT ep.entry_id AS entryId")) {
          const entryId = this.committedCreates.get(String(bindings[2]));
          return entryId ? { entryId } : null;
        }
        if (sql.includes("SELECT id FROM episodes")) {
          const key = `${String(bindings[0])}:${String(bindings[2])}`;
          return this.committedUpdates.has(key) ? { id: "episode" } : null;
        }
        if (sql.includes("FROM entries WHERE id = ?")) {
          return this.entries.get(String(bindings[0])) ?? null;
        }
        return null;
      },
      all: async () => {
        this.schedulerSql = sql;
        return { results: this.eligibleUsers };
      },
      run: async () => ({ success: true, meta: { changes: 0 } }),
    };
    return statement as unknown as D1PreparedStatement;
  }
}

function envFor(kv: KVNamespace, db = new IntegrationDb()): Env {
  return {
    OAUTH_KV: kv,
    DB: db as unknown as D1Database,
    VECTORIZE: {} as VectorizeIndex,
    AI: {} as Ai,
    AUTH_TOKEN: "transport-token",
  } as Env;
}

function record(
  ownerUserId: string,
  options: {
    token?: string;
    visibility?: "private" | "public";
    itemMap?: IntegrationRecord["itemMap"];
  } = {},
): IntegrationRecord {
  return {
    provider: "notion",
    ownerUserId,
    authKind: "token",
    credentials: { token: options.token ?? `token-${ownerUserId}` },
    config: { defaultVisibility: options.visibility ?? "private" },
    status: "connected",
    workspaceName: `Workspace ${ownerUserId}`,
    lastSyncedAt: null,
    lastSyncError: null,
    itemMap: options.itemMap ?? {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function notionPage(id: string, title: string, lastEdited: string) {
  return {
    object: "page",
    id,
    last_edited_time: lastEdited,
    url: `https://notion.so/${id}`,
    archived: false,
    in_trash: false,
    properties: { title: { type: "title", title: [{ plain_text: title }] } },
  };
}

interface NotionFixture {
  pages: any[];
  blocks: Record<string, any[]>;
  error?: string;
}

function stubNotion(fixtures: Record<string, NotionFixture>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    const token = headers?.Authorization?.replace(/^Bearer\s+/, "") ?? "";
    const fixture = fixtures[token];
    if (!fixture || fixture.error) {
      return new Response(JSON.stringify({ message: fixture?.error ?? "invalid token" }), { status: 401 });
    }
    if (url.endsWith("/search")) {
      return new Response(JSON.stringify({ results: fixture.pages, has_more: false }), { status: 200 });
    }
    const block = url.match(/\/blocks\/([^/?]+)\/children/);
    if (block) {
      return new Response(JSON.stringify({ results: fixture.blocks[block[1]] ?? [], has_more: false }), { status: 200 });
    }
    if (url.endsWith("/users/me")) {
      return new Response(JSON.stringify({ bot: { workspace_name: "Workspace" } }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }));
}

function paragraph(text: string) {
  return {
    object: "block",
    id: `block-${text}`,
    type: "paragraph",
    has_children: false,
    paragraph: { rich_text: [{ plain_text: text }] },
  };
}

function successfulStore(prefix: string): MirrorStore {
  let counter = 0;
  return {
    createEntry: vi.fn(async () => `${prefix}-entry-${++counter}`),
    updateEntry: vi.fn(async () => true),
    archiveEntry: vi.fn(async () => true),
    deleteEntry: vi.fn(async () => true),
  };
}

describe("tenant-scoped integration core", () => {
  beforeEach(() => {
    dependencyMocks.commitEntryVersion.mockReset();
    dependencyMocks.forgetEntry.mockReset();
    dependencyMocks.initializeDatabase.mockReset().mockResolvedValue(undefined);
    dependencyMocks.forgetEntry.mockResolvedValue({ status: "deleted", vectorCount: 1 });
    let created = 0;
    dependencyMocks.commitEntryVersion.mockImplementation(async (input: any) => ({
      entryId: input.entryId ?? `created-${++created}`,
      episodeId: "episode",
      mutationId: input.mutationId,
      revision: input.entryId ? 2 : 1,
      created: !input.entryId,
      snapshotId: input.entryId ? "snapshot" : null,
      documentId: "document",
      sectionIds: [],
      passageIds: [],
      vectorIds: [],
      cleanupQueueId: null,
      cleanupPending: false,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists only v2 user keys and isolates the same provider between users", async () => {
    const memory = memoryKv();
    const env = envFor(memory.kv);
    await saveIntegration(env, "user-a", record("user-a"));
    await saveIntegration(env, "user-b", record("user-b"));

    expect([...memory.values.keys()].sort()).toEqual([
      "integrations:v2:user-a:notion",
      "integrations:v2:user-b:notion",
    ]);
    expect((await loadIntegration(env, "user-a", "notion"))?.ownerUserId).toBe("user-a");
    expect((await loadIntegration(env, "user-b", "notion"))?.ownerUserId).toBe("user-b");

    await deleteIntegration(env, "user-a", "notion");
    expect(await loadIntegration(env, "user-a", "notion")).toBeNull();
    expect(await loadIntegration(env, "user-b", "notion")).not.toBeNull();
  });

  it("defaults missing or invalid visibility to private and rejects owner mismatch", async () => {
    const memory = memoryKv();
    memory.values.set(integrationKey("user-a", "notion"), JSON.stringify({
      ...record("user-a"),
      config: {},
    }));
    expect((await loadIntegration(envFor(memory.kv), "user-a", "notion"))?.config.defaultVisibility)
      .toBe("private");

    await expect(saveIntegration(
      envFor(memory.kv),
      "user-b",
      record("user-a"),
    )).rejects.toThrow("owner");
  });

  it("claims a legacy record only through the explicit helper", async () => {
    const memory = memoryKv();
    memory.values.set("integrations:notion", JSON.stringify({
      ...record("legacy-user"),
      ownerUserId: undefined,
      config: {},
      itemMap: undefined,
      pageMap: { page: { entryId: "legacy-entry", lastEdited: "v1" } },
    }));
    const env = envFor(memory.kv);

    expect(await loadIntegration(env, "user-a", "notion")).toBeNull();
    const claimed = await claimLegacyIntegration(env, "user-a", "notion");
    expect(claimed).toMatchObject({
      ownerUserId: "user-a",
      config: { defaultVisibility: "private" },
      itemMap: { page: { entryId: "legacy-entry", version: "v1" } },
    });
    expect(memory.values.has("integrations:notion")).toBe(false);
    expect(memory.values.has("integrations:v2:user-a:notion")).toBe(true);
  });

  it("keeps identical external item ids isolated across users", async () => {
    const memory = memoryKv();
    const env = envFor(memory.kv);
    await saveIntegration(env, "user-a", record("user-a", { token: "token-a" }));
    await saveIntegration(env, "user-b", record("user-b", { token: "token-b" }));
    stubNotion({
      "token-a": {
        pages: [notionPage("same-page", "A", "v1")],
        blocks: { "same-page": [paragraph("private A content")] },
      },
      "token-b": {
        pages: [notionPage("same-page", "B", "v1")],
        blocks: { "same-page": [paragraph("private B content")] },
      },
    });

    const a = await notionProvider.sync(env, "user-a", successfulStore("a"));
    const b = await notionProvider.sync(env, "user-b", successfulStore("b"));
    expect(a).toMatchObject({ ok: true, created: 1 });
    expect(b).toMatchObject({ ok: true, created: 1 });
    expect((await loadIntegration(env, "user-a", "notion"))?.itemMap["same-page"].entryId)
      .toBe("a-entry-1");
    expect((await loadIntegration(env, "user-b", "notion"))?.itemMap["same-page"].entryId)
      .toBe("b-entry-1");
  });

  it("keeps Notion sync bounded and stores only redacted provider errors", async () => {
    const memory = memoryKv();
    const env = envFor(memory.kv);
    await saveIntegration(env, "user-a", record("user-a", { token: "secret-token" }));
    stubNotion({
      "secret-token": {
        pages: [],
        blocks: {},
        error: "rejected secret-token",
      },
    });
    const failed = await notionProvider.sync(env, "user-a", successfulStore("a"));
    expect(failed).toEqual({ ok: false, error: "Notion: rejected [redacted]" });
    const saved = await loadIntegration(env, "user-a", "notion");
    expect(saved?.lastSyncError).toBe("Notion: rejected [redacted]");
    expect(JSON.stringify({ status: saved?.lastSyncError })).not.toContain("secret-token");

    const pages = Array.from({ length: 7 }, (_, index) => notionPage(`p${index}`, `P${index}`, `v${index}`));
    await saveIntegration(env, "user-b", record("user-b", { token: "token-b" }));
    stubNotion({
      "token-b": {
        pages,
        blocks: Object.fromEntries(pages.map((page) => [page.id, [paragraph(page.id)]])),
      },
    });
    const bounded = await notionProvider.sync(env, "user-b", successfulStore("b"));
    expect(bounded).toMatchObject({ ok: true, created: 5, remaining: 2, total: 7 });
  });

  it("archives removed Notion pages and never invokes the hard-delete capability", async () => {
    const memory = memoryKv();
    const env = envFor(memory.kv);
    await saveIntegration(env, "user-a", record("user-a", {
      token: "token-a",
      itemMap: { archived: { entryId: "entry-archived", version: "v1" } },
    }));
    const archivedPage = notionPage("archived", "Archived", "v2");
    archivedPage.archived = true;
    stubNotion({
      "token-a": { pages: [archivedPage], blocks: {} },
    });
    const store = successfulStore("a");

    const outcome = await notionProvider.sync(env, "user-a", store);

    expect(outcome).toMatchObject({ ok: true, deleted: 1 });
    expect(store.archiveEntry).toHaveBeenCalledWith("archived", "entry-archived");
    expect(store.deleteEntry).not.toHaveBeenCalled();
    expect((await loadIntegration(env, "user-a", "notion"))?.itemMap.archived).toBeUndefined();
  });
});

describe("versioned mirror store safety", () => {
  let memory: MemoryKv;
  let db: IntegrationDb;
  let env: Env;

  beforeEach(() => {
    memory = memoryKv();
    db = new IntegrationDb();
    env = envFor(memory.kv, db);
    dependencyMocks.commitEntryVersion.mockReset().mockResolvedValue({ entryId: "entry-a" });
    dependencyMocks.forgetEntry.mockReset().mockResolvedValue({ status: "deleted", vectorCount: 1 });
    dependencyMocks.initializeDatabase.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates private versioned mirrors with canonical owner and provenance fields", async () => {
    const integration = record("user-a");
    const store = makeMirrorStore(env, "user-a", integration);
    const entryId = await store.createEntry({
      externalItemId: "page-1",
      version: "v1",
      content: "# Page\nbody",
      tags: ["notion"],
      sourceUrl: "https://notion.so/page-1",
      title: "Page",
    });

    expect(entryId).toBe("entry-a");
    expect(dependencyMocks.commitEntryVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "capture",
        actorUserId: "user-a",
        rawContent: "# Page\nbody",
        materializedContent: "# Page\nbody",
        tags: ["notion", "private"],
        source: "notion",
        sourceUrl: "https://notion.so/page-1",
        contentType: "research",
        title: "Page",
        mutationId: "integration:notion:page-1:v1",
      }),
      env,
    );
  });

  it("honors explicit public defaults without leaking private projection tags", async () => {
    const store = makeMirrorStore(env, "user-a", record("user-a", { visibility: "public" }));
    await store.createEntry({
      externalItemId: "page-1",
      version: "v1",
      content: "public",
      tags: ["notion", "private"],
    });
    expect(dependencyMocks.commitEntryVersion.mock.calls[0][0].tags).toEqual(["notion"]);
  });

  it("updates only the exact caller-owned item-map entry with a revision guard", async () => {
    const integration = record("user-a", {
      itemMap: { page: { entryId: "entry-a", version: "v1" } },
    });
    db.entries.set("entry-a", {
      owner_user_id: "user-a",
      source: "notion",
      revision: 7,
      visibility: "private",
    });
    const updated = await makeMirrorStore(env, "user-a", integration).updateEntry("entry-a", {
      externalItemId: "page",
      version: "v2",
      content: "updated",
      tags: ["notion"],
    });
    expect(updated).toBe(true);
    expect(dependencyMocks.commitEntryVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "update",
        actorUserId: "user-a",
        entryId: "entry-a",
        expectedRevision: 7,
        tags: ["notion", "private"],
      }),
      env,
    );

    await expect(makeMirrorStore(env, "user-a", integration).updateEntry("entry-a", {
      externalItemId: "not-page",
      version: "v3",
      content: "attack",
      tags: [],
    })).rejects.toThrow("item map");
  });

  it("blocks cross-user update and delete even when a map is corrupted", async () => {
    db.entries.set("entry-b", {
      owner_user_id: "user-b",
      source: "notion",
      revision: 1,
      visibility: "private",
    });
    const corrupted = record("user-a", {
      itemMap: { page: { entryId: "entry-b", version: "v1" } },
    });
    const store = makeMirrorStore(env, "user-a", corrupted);
    await expect(store.updateEntry("entry-b", {
      externalItemId: "page",
      version: "v2",
      content: "attack",
      tags: [],
    })).rejects.toThrow("owner mismatch");
    await expect(store.deleteEntry("page", "entry-b")).rejects.toThrow("owner mismatch");
    await expect(store.archiveEntry("page", "entry-b")).rejects.toThrow("owner mismatch");
    expect(dependencyMocks.commitEntryVersion).not.toHaveBeenCalled();
    expect(dependencyMocks.forgetEntry).not.toHaveBeenCalled();
  });

  it("archives an upstream-removed mirror through a versioned snapshot without hard forget", async () => {
    const integration = record("user-a", {
      itemMap: { page: { entryId: "entry-a", version: "v1" } },
    });
    db.entries.set("entry-a", {
      owner_user_id: "user-a",
      source: "notion",
      revision: 4,
      visibility: "private",
      content: "Preserved source content",
      tags: '["notion","private"]',
      valid_from: 100,
      valid_to: null,
      epistemic_status: "canonical",
    });

    expect(await makeMirrorStore(env, "user-a", integration).archiveEntry("page", "entry-a"))
      .toBe(true);
    expect(dependencyMocks.commitEntryVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "status",
        actorUserId: "user-a",
        entryId: "entry-a",
        expectedRevision: 4,
        materializedContent: "Preserved source content",
        tags: expect.arrayContaining(["notion", "private", "source-archived", "status:deprecated"]),
      }),
      env,
    );
    expect(dependencyMocks.forgetEntry).not.toHaveBeenCalled();
  });

  it("recognizes a managed mirror only by caller and exact item-map entry", async () => {
    await saveIntegration(env, "user-a", record("user-a", {
      itemMap: { page: { entryId: "entry-a", version: "v1" } },
    }));
    await saveIntegration(env, "user-b", record("user-b", {
      itemMap: { page: { entryId: "entry-b", version: "v1" } },
    }));

    expect(await isManagedMirror("entry-a", "notion", "user-a", env)).toBe(true);
    expect(await isManagedMirror("entry-b", "notion", "user-a", env)).toBe(false);
    expect(await isManagedMirror("entry-b", "notion", "user-b", env)).toBe(true);
    expect(await isManagedMirror("entry-a", "unknown", "user-a", env)).toBe(false);
  });

  it("purges and disconnects only the caller's mirrors", async () => {
    db.entries.set("entry-a", {
      owner_user_id: "user-a",
      source: "notion",
      revision: 1,
      visibility: "private",
    });
    db.entries.set("entry-b", {
      owner_user_id: "user-b",
      source: "notion",
      revision: 1,
      visibility: "private",
    });
    await saveIntegration(env, "user-a", record("user-a", {
      itemMap: { same: { entryId: "entry-a", version: "v1" } },
    }));
    await saveIntegration(env, "user-b", record("user-b", {
      itemMap: { same: { entryId: "entry-b", version: "v1" } },
    }));

    expect(await disconnectIntegration(env, "user-a", "notion", true)).toEqual({
      ok: true,
      purged: 1,
      kept: 0,
    });
    expect(dependencyMocks.forgetEntry).toHaveBeenCalledTimes(1);
    expect(dependencyMocks.forgetEntry).toHaveBeenCalledWith("entry-a", env);
    expect(await loadIntegration(env, "user-a", "notion")).toBeNull();
    expect((await loadIntegration(env, "user-b", "notion"))?.itemMap.same.entryId).toBe("entry-b");
  });
});

describe("scheduled integration tenancy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("syncs only active, non-deactivating users and preserves a global batch bound", async () => {
    const memory = memoryKv();
    const db = new IntegrationDb();
    db.eligibleUsers = [{ id: "active" }];
    const env = envFor(memory.kv, db);
    await saveIntegration(env, "active", record("active"));
    await saveIntegration(env, "inactive", record("inactive"));
    await saveIntegration(env, "deactivating", record("deactivating"));
    dependencyMocks.initializeDatabase.mockReset().mockResolvedValue(undefined);

    const sync = vi.spyOn(notionProvider, "sync").mockResolvedValue({
      ok: true,
      created: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      remaining: 1,
      total: 1,
    });
    await runScheduledIntegrationSync(env);

    expect(dependencyMocks.initializeDatabase).toHaveBeenCalledWith(env);
    expect(db.schedulerSql).toContain("u.status = 'active'");
    expect(db.schedulerSql).toContain("user_deactivations");
    expect(sync).toHaveBeenCalledTimes(CRON_SYNC_MAX_BATCHES);
    expect(new Set(sync.mock.calls.map((call) => call[1]))).toEqual(new Set(["active"]));
  });
});
