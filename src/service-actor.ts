/** Defense-in-depth validation for a service ActorContext created by auth. */

import { SERVICE_SCOPES, type Env, type ServiceActorContext, type ServiceScope } from "./types";
import { parseStringArray } from "./governance-utils";

interface ServiceActorRow {
  service_status: string;
  owner_user_id: string;
  owner_status: string;
  default_autonomy_profile: string;
  credential_status: string;
  scopes: string;
  expires_at: number | null;
}

export interface VerifiedServiceActor {
  actor: ServiceActorContext;
  ownerUserId: string;
  autonomyProfile: string;
}

export class ServiceActorValidationError extends Error {
  constructor(readonly code: "invalid_actor" | "inactive_service" | "inactive_credential" | "expired_credential" | "scope_escalation", message: string) {
    super(message);
    this.name = "ServiceActorValidationError";
  }
}

export async function verifyServiceActor(
  env: Pick<Env, "DB">,
  actor: ServiceActorContext,
  now = Date.now(),
): Promise<VerifiedServiceActor> {
  if (!actor.serviceIdentityId || !actor.credentialId || actor.actorId !== actor.serviceIdentityId) {
    throw new ServiceActorValidationError("invalid_actor", "Service actor identity is inconsistent.");
  }
  const row = await env.DB.prepare(
    `SELECT si.status AS service_status, si.owner_user_id, u.status AS owner_status,
            si.default_autonomy_profile, sc.status AS credential_status,
            sc.scopes, sc.expires_at
     FROM service_identities si
     JOIN service_credentials sc ON sc.service_identity_id = si.id
     JOIN users u ON u.id = si.owner_user_id
     WHERE si.id = ? AND sc.id = ?`,
  ).bind(actor.serviceIdentityId, actor.credentialId).first<ServiceActorRow>();
  if (!row) throw new ServiceActorValidationError("invalid_actor", "Service identity or credential was not found.");
  if (actor.ownerUserId !== row.owner_user_id) {
    throw new ServiceActorValidationError("invalid_actor", "Service actor owner does not match the persisted identity owner.");
  }
  if (row.service_status !== "active") {
    throw new ServiceActorValidationError("inactive_service", "Service identity is not active.");
  }
  if (row.owner_status !== "active") {
    throw new ServiceActorValidationError("inactive_service", "Service identity owner is not active.");
  }
  if (row.credential_status !== "active") {
    throw new ServiceActorValidationError("inactive_credential", "Service credential is not active.");
  }
  if (row.expires_at !== null && row.expires_at <= now) {
    throw new ServiceActorValidationError("expired_credential", "Service credential has expired.");
  }

  const allowed = new Set<string>(SERVICE_SCOPES);
  const persistedScopes = new Set<ServiceScope>(
    parseStringArray(row.scopes).filter((scope): scope is ServiceScope => allowed.has(scope)),
  );
  const escalated = [...actor.scopes].filter((scope) => !persistedScopes.has(scope));
  if (escalated.length > 0) {
    throw new ServiceActorValidationError("scope_escalation", `Actor claimed ungranted scope: ${escalated.join(", ")}`);
  }

  return {
    // Preserve request/auth attenuation. Persisted scopes are an upper bound,
    // never a reason to silently add capability to this ActorContext.
    actor: { ...actor, scopes: new Set(actor.scopes) },
    ownerUserId: row.owner_user_id,
    autonomyProfile: row.default_autonomy_profile,
  };
}
