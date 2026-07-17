/**
 * Provider-agnostic integration contracts and tenant-scoped KV persistence.
 *
 * Integration credentials and mirror maps are private user data. Normal code
 * can only address a record with an explicit user id and provider id; there is
 * no deployment-global fallback key.
 */

export interface IntegrationEnv {
  OAUTH_KV: KVNamespace;
}

export type IntegrationVisibility = "private" | "public";

export interface IntegrationConfig {
  defaultVisibility: IntegrationVisibility;
  [key: string]: unknown;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  validateToken(token: string): Promise<string>;
  sync(env: IntegrationEnv, userId: string, store: MirrorStore): Promise<SyncOutcome>;
}

export type SyncOutcome =
  | {
      ok: true;
      created: number;
      updated: number;
      deleted: number;
      failed: number;
      remaining: number;
      total: number;
    }
  | { ok: false; error: string };

export interface ItemMapEntry {
  entryId: string;
  version: string;
}

export interface IntegrationRecord {
  provider: string;
  ownerUserId: string;
  authKind: "token";
  credentials: { token: string };
  config: IntegrationConfig;
  status: "connected" | "error";
  workspaceName: string | null;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  itemMap: Record<string, ItemMapEntry>;
  createdAt: number;
  updatedAt: number;
}

export interface MirrorEntryVersion {
  externalItemId: string;
  version: string;
  content: string;
  tags: string[];
  sourceUrl?: string | null;
  title?: string;
}

export interface MirrorStore {
  createEntry(input: MirrorEntryVersion): Promise<string>;
  updateEntry(entryId: string, input: MirrorEntryVersion): Promise<boolean>;
  /** Non-destructive source removal used by unattended sync. */
  archiveEntry(externalItemId: string, entryId: string): Promise<boolean>;
  /** Human-requested compliance purge used only by explicit disconnect+purge. */
  deleteEntry(externalItemId: string, entryId: string): Promise<boolean>;
}

const INTEGRATIONS_KEY_PREFIX = "integrations:v2:";
const LEGACY_INTEGRATIONS_KEY_PREFIX = "integrations:";

function requireKeyPart(label: string, value: unknown): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.includes(":")) throw new Error(`${label} cannot contain ':'`);
  return normalized;
}

export function integrationKey(userId: string, provider: string): string {
  return `${INTEGRATIONS_KEY_PREFIX}${requireKeyPart("userId", userId)}:${requireKeyPart("provider", provider)}`;
}

function normalizeItemMap(value: unknown): Record<string, ItemMapEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([externalId, raw]) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const candidate = raw as Record<string, unknown>;
      if (typeof candidate.entryId !== "string" || !candidate.entryId) return [];
      const version = typeof candidate.version === "string"
        ? candidate.version
        : typeof candidate.lastEdited === "string"
          ? candidate.lastEdited
          : "";
      return [[externalId, { entryId: candidate.entryId, version }]];
    }),
  );
}

function normalizeConfig(value: unknown): IntegrationConfig {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  return {
    ...config,
    defaultVisibility: config.defaultVisibility === "public" ? "public" : "private",
  };
}

function normalizeRecord(
  value: unknown,
  userId: string,
  provider: string,
  allowOwnerless: boolean,
): IntegrationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, any>;
  if (raw.provider !== provider) return null;
  if (!allowOwnerless && raw.ownerUserId !== userId) return null;
  if (allowOwnerless && raw.ownerUserId && raw.ownerUserId !== userId) return null;
  if (raw.authKind !== "token" || typeof raw.credentials?.token !== "string") return null;

  return {
    provider,
    ownerUserId: userId,
    authKind: "token",
    credentials: { token: raw.credentials.token },
    config: normalizeConfig(raw.config),
    status: raw.status === "connected" ? "connected" : "error",
    workspaceName: typeof raw.workspaceName === "string" ? raw.workspaceName : null,
    lastSyncedAt: typeof raw.lastSyncedAt === "number" ? raw.lastSyncedAt : null,
    lastSyncError: typeof raw.lastSyncError === "string" ? raw.lastSyncError : null,
    itemMap: normalizeItemMap(raw.itemMap ?? raw.pageMap),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

export async function loadIntegration(
  env: IntegrationEnv,
  userId: string,
  provider: string,
): Promise<IntegrationRecord | null> {
  const raw = await env.OAUTH_KV.get(integrationKey(userId, provider));
  if (!raw) return null;
  try {
    return normalizeRecord(JSON.parse(raw), userId, provider, false);
  } catch {
    return null;
  }
}

export async function saveIntegration(
  env: IntegrationEnv,
  userId: string,
  record: IntegrationRecord,
): Promise<void> {
  requireKeyPart("userId", userId);
  requireKeyPart("provider", record.provider);
  if (record.ownerUserId !== userId) {
    throw new Error("Integration owner does not match the requested user");
  }
  const normalized = normalizeRecord(record, userId, record.provider, false);
  if (!normalized) throw new Error("Integration record is invalid");
  await env.OAUTH_KV.put(
    integrationKey(userId, record.provider),
    JSON.stringify(normalized),
  );
}

export async function deleteIntegration(
  env: IntegrationEnv,
  userId: string,
  provider: string,
): Promise<void> {
  await env.OAUTH_KV.delete(integrationKey(userId, provider));
}

/**
 * Explicit one-time ownership claim for a pre-v2 deployment-global record.
 * Normal loads never inspect legacy keys. The legacy blob is removed only
 * after the user-scoped copy has been stored successfully.
 */
export async function claimLegacyIntegration(
  env: IntegrationEnv,
  userId: string,
  provider: string,
): Promise<IntegrationRecord | null> {
  requireKeyPart("userId", userId);
  const normalizedProvider = requireKeyPart("provider", provider);
  if (await loadIntegration(env, userId, normalizedProvider)) {
    throw new Error("User already has an integration record for this provider");
  }
  const legacyKey = `${LEGACY_INTEGRATIONS_KEY_PREFIX}${normalizedProvider}`;
  const raw = await env.OAUTH_KV.get(legacyKey);
  if (!raw) return null;
  let record: IntegrationRecord | null;
  try {
    record = normalizeRecord(JSON.parse(raw), userId, normalizedProvider, true);
  } catch {
    record = null;
  }
  if (!record) return null;
  await saveIntegration(env, userId, record);
  await env.OAUTH_KV.delete(legacyKey);
  return record;
}

export function integrationStatus(
  provider: Pick<IntegrationProvider, "id" | "name">,
  record: IntegrationRecord | null,
) {
  return {
    provider: provider.id,
    name: provider.name,
    connected: record !== null,
    status: record?.status ?? null,
    workspaceName: record?.workspaceName ?? null,
    lastSyncedAt: record?.lastSyncedAt ?? null,
    lastSyncError: record?.lastSyncError ?? null,
    itemCount: record ? Object.keys(record.itemMap).length : 0,
  };
}

/** Keep provider/status errors bounded and strip credentials before storage. */
export function redactIntegrationError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message.slice(0, 500);
}
