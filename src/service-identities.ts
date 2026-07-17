/** Service identity provisioning, suspension, credential rotation, revocation, and auth. */

import { AUTH_PEPPER, hmacKey } from "./auth";
import {
  SERVICE_SCOPES,
  type Env,
  type ServiceActorContext,
  type ServiceScope,
} from "./types";

const AUTONOMY_PROFILES = ["observe", "draft", "propose", "execute-approved"] as const;
type AutonomyProfile = (typeof AUTONOMY_PROFILES)[number];

export class ServiceIdentityError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "admin_required"
      | "owner_not_active"
      | "not_found"
      | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ServiceIdentityError";
  }
}

interface ServiceIdentityRow {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  status: string;
  default_autonomy_profile: string;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

interface ServiceCredentialRow {
  id: string;
  service_identity_id: string;
  credential_hash: string;
  credential_prefix: string;
  scopes: string;
  status: string;
  expires_at: number | null;
  created_at: number;
}

function securityEvent(
  env: Pick<Env, "DB">,
  input: {
    eventType: string;
    requesterUserId: string;
    serviceIdentityId: string;
    credentialId?: string | null;
    reason: string;
    metadata?: Record<string, unknown>;
    now: number;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO security_events (
       id, event_type, actor_kind, actor_id, service_identity_id,
       credential_id, auth_method, reason, metadata, created_at
     ) VALUES (?, ?, 'human', ?, ?, ?, 'personal_api_key', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.eventType,
    input.requesterUserId,
    input.serviceIdentityId,
    input.credentialId ?? null,
    input.reason,
    JSON.stringify(input.metadata ?? {}),
    input.now,
  );
}

export interface ProvisionedServiceCredential {
  id: string;
  key: string;
  prefix: string;
  scopes: readonly ServiceScope[];
  expiresAt: number | null;
}

export interface ProvisionedServiceIdentity {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  status: string;
  autonomyProfile: string;
  createdAt: number;
}

function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(byte => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

function normalizeScopes(value: readonly string[] | undefined): ServiceScope[] {
  const requested = value ?? [
    "memory:read",
    "memory:draft",
    "memory:propose",
    "proposal:read",
    "proposal:create",
    "audit:write",
    "run:write",
  ];
  const allowed = new Set<string>(SERVICE_SCOPES);
  if (!Array.isArray(requested) || requested.some(scope => !allowed.has(scope))) {
    throw new ServiceIdentityError("invalid_input", "One or more service scopes are invalid");
  }
  return [...new Set(requested)] as ServiceScope[];
}

function normalizeProfile(value: string | undefined): AutonomyProfile {
  const profile = value ?? "propose";
  if (!(AUTONOMY_PROFILES as readonly string[]).includes(profile)) {
    throw new ServiceIdentityError("invalid_input", "Invalid autonomy profile");
  }
  return profile as AutonomyProfile;
}

async function requireAdmin(env: Env, userId: string): Promise<void> {
  const user = await env.DB.prepare(
    `SELECT role, status FROM users WHERE id = ?`,
  ).bind(userId).first<{ role: string; status: string }>();
  if (!user || user.status !== "active" || user.role !== "admin") {
    throw new ServiceIdentityError("admin_required", "An active administrator is required");
  }
}

async function requireActiveOwner(env: Env, userId: string): Promise<void> {
  const owner = await env.DB.prepare(
    `SELECT id FROM users WHERE id = ? AND status = 'active'`,
  ).bind(userId).first<{ id: string }>();
  if (!owner) throw new ServiceIdentityError("owner_not_active", "Service owner must be active");
}

async function newCredential(
  serviceIdentityId: string,
  createdByUserId: string,
  scopes: readonly ServiceScope[],
  expiresAt: number | null,
  rotatedFromId: string | null,
  now: number,
): Promise<{ row: ServiceCredentialRow; provisioned: ProvisionedServiceCredential }> {
  const id = crypto.randomUUID();
  const secret = randomSecret();
  const key = `sbs_${id}.${secret}`;
  const prefix = key.slice(0, 20);
  const hash = await hmacKey(secret, AUTH_PEPPER);
  return {
    row: {
      id,
      service_identity_id: serviceIdentityId,
      credential_hash: hash,
      credential_prefix: prefix,
      scopes: JSON.stringify(scopes),
      status: "active",
      expires_at: expiresAt,
      created_at: now,
    },
    provisioned: { id, key, prefix, scopes, expiresAt },
  };
}

export async function createServiceIdentity(
  input: {
    requesterUserId: string;
    ownerUserId?: string;
    name: string;
    description?: string | null;
    scopes?: readonly string[];
    autonomyProfile?: string;
    expiresAt?: number | null;
    now?: number;
  },
  env: Env,
): Promise<{ identity: ProvisionedServiceIdentity; credential: ProvisionedServiceCredential }> {
  await requireAdmin(env, input.requesterUserId);
  const ownerUserId = input.ownerUserId?.trim() || input.requesterUserId;
  await requireActiveOwner(env, ownerUserId);
  const name = input.name?.trim();
  if (!name || name.length > 80) {
    throw new ServiceIdentityError("invalid_input", "Service name is required and must be at most 80 characters");
  }
  const scopes = normalizeScopes(input.scopes);
  const profile = normalizeProfile(input.autonomyProfile);
  const now = input.now ?? Date.now();
  const expiresAt = input.expiresAt == null ? null : Number(input.expiresAt);
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    throw new ServiceIdentityError("invalid_input", "Credential expiry must be in the future");
  }
  const id = crypto.randomUUID();
  const credential = await newCredential(id, input.requesterUserId, scopes, expiresAt, null, now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO service_identities (
           id, name, description, owner_user_id, status,
           default_autonomy_profile, created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(
        id,
        name,
        input.description?.trim() || null,
        ownerUserId,
        profile,
        input.requesterUserId,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO service_credentials (
           id, service_identity_id, credential_hash, credential_prefix, scopes,
           status, expires_at, rotated_from_credential_id,
           created_by_user_id, created_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(
        credential.row.id,
        id,
        credential.row.credential_hash,
        credential.row.credential_prefix,
        credential.row.scopes,
        expiresAt,
        null,
        input.requesterUserId,
        now,
      ),
      securityEvent(env, {
        eventType: "service_identity.created",
        requesterUserId: input.requesterUserId,
        serviceIdentityId: id,
        credentialId: credential.row.id,
        reason: "Administrator provisioned a service identity",
        metadata: { owner_user_id: ownerUserId, autonomy_profile: profile, scopes },
        now,
      }),
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw new ServiceIdentityError("conflict", "A service identity with this name already exists");
    }
    throw error;
  }
  return {
    identity: {
      id,
      name,
      description: input.description?.trim() || null,
      ownerUserId,
      status: "active",
      autonomyProfile: profile,
      createdAt: now,
    },
    credential: credential.provisioned,
  };
}

async function loadServiceForAdmin(
  env: Env,
  requesterUserId: string,
  serviceIdentityId: string,
): Promise<ServiceIdentityRow> {
  await requireAdmin(env, requesterUserId);
  const identity = await env.DB.prepare(
    `SELECT id, name, description, owner_user_id, status,
            default_autonomy_profile, created_by_user_id, created_at,
            updated_at, revoked_at
     FROM service_identities WHERE id = ?`,
  ).bind(serviceIdentityId).first<ServiceIdentityRow>();
  if (!identity) throw new ServiceIdentityError("not_found", "Service identity not found");
  return identity;
}

export async function rotateServiceCredential(
  input: {
    requesterUserId: string;
    serviceIdentityId: string;
    scopes?: readonly string[];
    expiresAt?: number | null;
    now?: number;
  },
  env: Env,
): Promise<ProvisionedServiceCredential> {
  const identity = await loadServiceForAdmin(env, input.requesterUserId, input.serviceIdentityId);
  if (identity.status !== "active") {
    throw new ServiceIdentityError("not_found", "Active service identity not found");
  }
  const previous = await env.DB.prepare(
    `SELECT id, scopes FROM service_credentials
     WHERE service_identity_id = ? AND status = 'active'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).bind(identity.id).first<{ id: string; scopes: string }>();
  let inheritedScopes: string[] | undefined;
  if (!input.scopes && previous) {
    try { inheritedScopes = JSON.parse(previous.scopes); } catch { inheritedScopes = undefined; }
  }
  const scopes = normalizeScopes(input.scopes ?? inheritedScopes);
  const now = input.now ?? Date.now();
  const expiresAt = input.expiresAt == null ? null : Number(input.expiresAt);
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    throw new ServiceIdentityError("invalid_input", "Credential expiry must be in the future");
  }
  const credential = await newCredential(identity.id, input.requesterUserId, scopes, expiresAt, previous?.id ?? null, now);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE service_credentials
       SET status = 'rotated', revoked_at = ?, revoked_by_user_id = ?
       WHERE service_identity_id = ? AND status = 'active'`,
    ).bind(now, input.requesterUserId, identity.id),
    env.DB.prepare(
      `INSERT INTO service_credentials (
         id, service_identity_id, credential_hash, credential_prefix, scopes,
         status, expires_at, rotated_from_credential_id,
         created_by_user_id, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(
      credential.row.id,
      identity.id,
      credential.row.credential_hash,
      credential.row.credential_prefix,
      credential.row.scopes,
      expiresAt,
      previous?.id ?? null,
      input.requesterUserId,
      now,
    ),
    env.DB.prepare(
      `UPDATE service_identities SET updated_at = ? WHERE id = ? AND status = 'active'`,
    ).bind(now, identity.id),
    securityEvent(env, {
      eventType: "service_credential.rotated",
      requesterUserId: input.requesterUserId,
      serviceIdentityId: identity.id,
      credentialId: credential.row.id,
      reason: "Administrator rotated a service credential",
      metadata: { rotated_from_credential_id: previous?.id ?? null, scopes },
      now,
    }),
  ]);
  return credential.provisioned;
}

export async function setServiceIdentitySuspended(
  requesterUserId: string,
  serviceIdentityId: string,
  suspended: boolean,
  env: Env,
): Promise<{ changed: boolean; status: "active" | "suspended" }> {
  const identity = await loadServiceForAdmin(env, requesterUserId, serviceIdentityId);
  if (identity.status === "revoked") {
    throw new ServiceIdentityError("conflict", "A revoked service identity cannot be resumed or suspended");
  }
  if (identity.status !== "active" && identity.status !== "suspended") {
    throw new ServiceIdentityError("conflict", "Service identity has an invalid lifecycle state");
  }
  const target = suspended ? "suspended" : "active";
  if (identity.status === target) return { changed: false, status: target };

  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE service_identities
       SET status = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
    ).bind(target, now, serviceIdentityId, identity.status),
    securityEvent(env, {
      eventType: suspended ? "service_identity.suspended" : "service_identity.resumed",
      requesterUserId,
      serviceIdentityId,
      reason: suspended
        ? "Administrator suspended a service identity"
        : "Administrator resumed a service identity",
      metadata: { previous_status: identity.status, status: target },
      now,
    }),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    throw new ServiceIdentityError("conflict", "Service identity changed concurrently");
  }
  return { changed: true, status: target };
}

export async function revokeServiceIdentity(
  requesterUserId: string,
  serviceIdentityId: string,
  env: Env,
): Promise<boolean> {
  const identity = await loadServiceForAdmin(env, requesterUserId, serviceIdentityId);
  if (identity.status === "revoked") return false;
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE service_credentials
       SET status = 'revoked', revoked_at = ?, revoked_by_user_id = ?
       WHERE service_identity_id = ? AND status <> 'revoked'`,
    ).bind(now, requesterUserId, serviceIdentityId),
    env.DB.prepare(
      `UPDATE service_identities
       SET status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE id = ? AND status <> 'revoked'`,
    ).bind(now, now, serviceIdentityId),
    securityEvent(env, {
      eventType: "service_identity.revoked",
      requesterUserId,
      serviceIdentityId,
      reason: "Administrator permanently revoked a service identity",
      now,
    }),
  ]);
  return Number(results[1]?.meta?.changes ?? 0) === 1;
}

export async function listServiceIdentities(
  requesterUserId: string,
  env: Env,
): Promise<Record<string, unknown>[]> {
  await requireAdmin(env, requesterUserId);
  const { results } = await env.DB.prepare(
    `SELECT si.id, si.name, si.description, si.owner_user_id, si.status,
            si.default_autonomy_profile, si.created_at, si.updated_at,
            sc.id AS credential_id, sc.credential_prefix, sc.scopes,
            sc.status AS credential_status, sc.expires_at, sc.last_used_at,
            sc.use_count
     FROM service_identities si
     LEFT JOIN service_credentials sc
       ON sc.service_identity_id = si.id AND sc.status = 'active'
     ORDER BY si.created_at DESC, si.id DESC`,
  ).all();
  return results as Record<string, unknown>[];
}

function parseServiceKey(value: string): { credentialId: string; secret: string } | null {
  const match = value.match(/^sbs_([A-Za-z0-9-]{8,128})\.([^\s.]+)$/);
  return match ? { credentialId: match[1], secret: match[2] } : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function resolveServiceCredential(
  apiKey: string,
  env: Env,
): Promise<ServiceActorContext | null> {
  const parsed = parseServiceKey(apiKey);
  if (!parsed) return null;
  const row = await env.DB.prepare(
    `SELECT sc.id, sc.credential_hash, sc.scopes, sc.status AS credential_status,
            sc.expires_at, si.id AS service_identity_id,
            si.owner_user_id, si.status AS service_status, u.status AS owner_status
     FROM service_credentials sc
     JOIN service_identities si ON si.id = sc.service_identity_id
     JOIN users u ON u.id = si.owner_user_id
     WHERE sc.id = ?`,
  ).bind(parsed.credentialId).first<Record<string, any>>();
  if (!row || row.credential_status !== "active" || row.service_status !== "active" || row.owner_status !== "active") {
    return null;
  }
  if (row.expires_at !== null && Number(row.expires_at) <= Date.now()) return null;
  const candidateHash = await hmacKey(parsed.secret, AUTH_PEPPER);
  if (!constantTimeEqual(candidateHash, String(row.credential_hash))) return null;
  let scopes: ServiceScope[];
  try {
    scopes = normalizeScopes(JSON.parse(row.scopes));
  } catch {
    return null;
  }
  await env.DB.prepare(
    `UPDATE service_credentials
     SET last_used_at = ?, use_count = use_count + 1
     WHERE id = ? AND status = 'active'`,
  ).bind(Date.now(), parsed.credentialId).run();
  return {
    kind: "service",
    actorId: String(row.service_identity_id),
    serviceIdentityId: String(row.service_identity_id),
    credentialId: String(row.id),
    ownerUserId: String(row.owner_user_id),
    authMethod: "service_api_key",
    scopes: new Set(scopes),
  };
}
