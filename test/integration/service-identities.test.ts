import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createServiceIdentity,
  listServiceIdentities,
  resolveServiceCredential,
  revokeServiceIdentity,
  rotateServiceCredential,
  setServiceIdentitySuspended,
} from "../../src/service-identities";
import type { Env, ServiceScope } from "../../src/types";

const schema = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");

class SqliteStatement {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.owner, this.sql, values);
  }

  async run(): Promise<any> {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values as SQLInputValue[]);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }

  async all<T = Record<string, unknown>>(): Promise<any> {
    const results = this.owner.sqlite.prepare(this.sql).all(...this.values as SQLInputValue[]) as T[];
    return { success: true, results, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const found = this.owner.sqlite.prepare(this.sql).get(...this.values as SQLInputValue[]) as Record<string, unknown> | undefined;
    if (!found) return null;
    return (column ? found[column] : found) as T;
  }
}

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(schema);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql);
  }

  async batch(statements: SqliteStatement[]): Promise<any[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: any[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}

interface Harness {
  db: SqliteD1;
  env: Env;
}

function addUser(
  db: SqliteD1,
  id: string,
  role: "admin" | "member",
  status = "active",
): void {
  db.sqlite.prepare(
    `INSERT INTO users (
       id, username, normalized_username, auth_key_hash, auth_key_prefix,
       status, created_at, role
     ) VALUES (?, ?, ?, 'hash', 'prefix', ?, 1, ?)`,
  ).run(id, id, id, status, role);
}

function makeHarness(): Harness {
  const db = new SqliteD1();
  addUser(db, "admin-active", "admin");
  addUser(db, "admin-inactive", "admin", "inactive");
  addUser(db, "member-active", "member");
  addUser(db, "owner-active", "member");
  addUser(db, "owner-inactive", "member", "inactive");
  return {
    db,
    env: {
      DB: db as unknown as D1Database,
      VECTORIZE: {} as VectorizeIndex,
      AI: {} as Ai,
      AUTH_TOKEN: "test-token",
      OAUTH_KV: {} as KVNamespace,
    } as Env,
  };
}

function one<T>(db: SqliteD1, sql: string, ...values: SQLInputValue[]): T {
  return db.sqlite.prepare(sql).get(...values) as T;
}

function mutateSecret(key: string): string {
  const last = key.at(-1);
  return `${key.slice(0, -1)}${last === "a" ? "b" : "a"}`;
}

describe("service identity credentials", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    harness.db.close();
  });

  it("allows only an active administrator to provision an identity for an active owner", async () => {
    await expect(createServiceIdentity({
      requesterUserId: "member-active",
      name: "Member service",
    }, harness.env)).rejects.toMatchObject({ code: "admin_required" });

    await expect(createServiceIdentity({
      requesterUserId: "admin-inactive",
      name: "Inactive admin service",
    }, harness.env)).rejects.toMatchObject({ code: "admin_required" });

    await expect(createServiceIdentity({
      requesterUserId: "admin-active",
      ownerUserId: "owner-inactive",
      name: "Inactive owner service",
    }, harness.env)).rejects.toMatchObject({ code: "owner_not_active" });

    const created = await createServiceIdentity({
      requesterUserId: "admin-active",
      ownerUserId: "owner-active",
      name: "Active owner service",
      now: 100,
    }, harness.env);

    expect(created.identity).toMatchObject({
      name: "Active owner service",
      ownerUserId: "owner-active",
      status: "active",
    });
  });

  it("uses private-safe default scopes and resolves the one-time key to its owner-bound actor", async () => {
    const created = await createServiceIdentity({
      requesterUserId: "admin-active",
      ownerUserId: "owner-active",
      name: "Hermes",
      now: 100,
    }, harness.env);

    expect(created.credential.key).toMatch(/^sbs_[A-Za-z0-9-]+\.[^\s.]+$/);
    expect(created.credential.scopes).toEqual([
      "memory:read",
      "memory:draft",
      "memory:propose",
      "proposal:read",
      "proposal:create",
      "audit:write",
      "run:write",
    ]);
    expect(created.credential.scopes).not.toContain("memory:execute-approved");
    expect(created.credential.scopes).not.toContain("proposal:execute-approved");

    const actor = await resolveServiceCredential(created.credential.key, harness.env);
    expect(actor).toMatchObject({
      kind: "service",
      actorId: created.identity.id,
      serviceIdentityId: created.identity.id,
      credentialId: created.credential.id,
      ownerUserId: "owner-active",
      authMethod: "service_api_key",
    });
    expect([...actor!.scopes]).toEqual(created.credential.scopes);

    const usage = one<{ last_used_at: number; use_count: number }>(
      harness.db,
      "SELECT last_used_at, use_count FROM service_credentials WHERE id = ?",
      created.credential.id,
    );
    expect(usage.last_used_at).toBeGreaterThan(0);
    expect(usage.use_count).toBe(1);

    const persisted = one<{ credential_hash: string }>(
      harness.db,
      "SELECT credential_hash FROM service_credentials WHERE id = ?",
      created.credential.id,
    );
    expect(persisted.credential_hash).not.toBe(created.credential.key);
    expect(persisted.credential_hash).not.toContain(created.credential.key.split(".")[1]);

    const listed = await listServiceIdentities("admin-active", harness.env);
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]).some(key => /hash|(^|_)key$/i.test(key))).toBe(false);
    expect(JSON.stringify(listed)).not.toContain(created.credential.key);
    expect(JSON.stringify(listed)).not.toContain(persisted.credential_hash);
  });

  it("rejects a wrong secret, expired credential, inactive owner, and revoked service", async () => {
    const created = await createServiceIdentity({
      requesterUserId: "admin-active",
      ownerUserId: "owner-active",
      name: "Failure cases",
      now: 100,
    }, harness.env);

    await expect(resolveServiceCredential(mutateSecret(created.credential.key), harness.env)).resolves.toBeNull();

    harness.db.sqlite.prepare(
      "UPDATE service_credentials SET expires_at = ? WHERE id = ?",
    ).run(Date.now() - 1, created.credential.id);
    await expect(resolveServiceCredential(created.credential.key, harness.env)).resolves.toBeNull();

    harness.db.sqlite.prepare(
      "UPDATE service_credentials SET expires_at = NULL WHERE id = ?",
    ).run(created.credential.id);
    harness.db.sqlite.prepare(
      "UPDATE users SET status = 'inactive' WHERE id = 'owner-active'",
    ).run();
    await expect(resolveServiceCredential(created.credential.key, harness.env)).resolves.toBeNull();

    harness.db.sqlite.prepare(
      "UPDATE users SET status = 'active' WHERE id = 'owner-active'",
    ).run();
    expect(await revokeServiceIdentity("admin-active", created.identity.id, harness.env)).toBe(true);
    await expect(resolveServiceCredential(created.credential.key, harness.env)).resolves.toBeNull();
    expect(await revokeServiceIdentity("admin-active", created.identity.id, harness.env)).toBe(false);
  });

  it("rotates atomically, invalidates the old key, and inherits the previous scopes", async () => {
    const scopes: ServiceScope[] = ["memory:read", "memory:draft", "audit:write"];
    const created = await createServiceIdentity({
      requesterUserId: "admin-active",
      ownerUserId: "owner-active",
      name: "Rotating service",
      scopes,
      now: 100,
    }, harness.env);

    const rotated = await rotateServiceCredential({
      requesterUserId: "admin-active",
      serviceIdentityId: created.identity.id,
      now: 200,
    }, harness.env);

    expect(rotated.id).not.toBe(created.credential.id);
    expect(rotated.key).not.toBe(created.credential.key);
    expect(rotated.scopes).toEqual(scopes);
    await expect(resolveServiceCredential(created.credential.key, harness.env)).resolves.toBeNull();
    expect(await resolveServiceCredential(rotated.key, harness.env)).toMatchObject({
      serviceIdentityId: created.identity.id,
      credentialId: rotated.id,
      ownerUserId: "owner-active",
    });

    const oldCredential = one<{ status: string; revoked_by_user_id: string }>(
      harness.db,
      "SELECT status, revoked_by_user_id FROM service_credentials WHERE id = ?",
      created.credential.id,
    );
    const newCredential = one<{ rotated_from_credential_id: string; scopes: string }>(
      harness.db,
      "SELECT rotated_from_credential_id, scopes FROM service_credentials WHERE id = ?",
      rotated.id,
    );
    expect(oldCredential).toEqual({ status: "rotated", revoked_by_user_id: "admin-active" });
    expect(newCredential.rotated_from_credential_id).toBe(created.credential.id);
    expect(JSON.parse(newCredential.scopes)).toEqual(scopes);

    const listed = await listServiceIdentities("admin-active", harness.env);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ credential_id: rotated.id, credential_status: "active" });
    expect(Object.keys(listed[0]).some(key => /hash|(^|_)key$/i.test(key))).toBe(false);
  });

  it("suspends and resumes immediately without rotating the credential, while revoke remains permanent", async () => {
    const created = await createServiceIdentity({
      requesterUserId: "admin-active",
      ownerUserId: "owner-active",
      name: "Pausable service",
      now: 100,
    }, harness.env);

    await expect(setServiceIdentitySuspended(
      "member-active",
      created.identity.id,
      true,
      harness.env,
    )).rejects.toMatchObject({ code: "admin_required" });

    await expect(setServiceIdentitySuspended(
      "admin-active",
      created.identity.id,
      true,
      harness.env,
    )).resolves.toEqual({ changed: true, status: "suspended" });
    await expect(resolveServiceCredential(created.credential.key, harness.env)).resolves.toBeNull();
    await expect(setServiceIdentitySuspended(
      "admin-active",
      created.identity.id,
      true,
      harness.env,
    )).resolves.toEqual({ changed: false, status: "suspended" });

    await expect(setServiceIdentitySuspended(
      "admin-active",
      created.identity.id,
      false,
      harness.env,
    )).resolves.toEqual({ changed: true, status: "active" });
    await expect(resolveServiceCredential(created.credential.key, harness.env)).resolves.toMatchObject({
      serviceIdentityId: created.identity.id,
    });

    expect(await revokeServiceIdentity("admin-active", created.identity.id, harness.env)).toBe(true);
    await expect(setServiceIdentitySuspended(
      "admin-active",
      created.identity.id,
      false,
      harness.env,
    )).rejects.toMatchObject({ code: "conflict" });

    const events = harness.db.sqlite.prepare(
      `SELECT event_type FROM security_events
       WHERE service_identity_id = ? ORDER BY created_at, rowid`,
    ).all(created.identity.id) as { event_type: string }[];
    expect(events.map(event => event.event_type)).toEqual([
      "service_identity.created",
      "service_identity.suspended",
      "service_identity.resumed",
      "service_identity.revoked",
    ]);
  });
});
