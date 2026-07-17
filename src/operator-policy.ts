/**
 * Pure, action-aware policy for humans and replaceable service operators.
 *
 * This module deliberately has no Env, D1, Vectorize, or model capability.
 * It can decide what an authenticated actor may request, but cannot perform it.
 */

import type {
  ActionType,
  ActorContext,
  PolicyDecisionEffect,
  ServiceScope,
} from "./types";
import { ACTION_TYPES } from "./types";

export const OPERATOR_POLICY_VERSION = "operator-governance-v1";
export const NIGHTLY_CONTRADICTION_SYSTEM_ID = "_nightly-contradiction-scan";

export type GovernedOperation =
  | "memory.read"
  | "proposal.read"
  | ActionType
  | "entry.forget"
  | "edge.unlink"
  | "proposal.create"
  | "proposal.approve"
  | "proposal.reject"
  | "proposal.execute";

export interface DirectCaptureConstraints {
  visibility: "private" | "public";
  lifecycleStatus: "draft" | "canonical" | "deprecated";
  epistemicStatus: "candidate" | "reviewed" | "canonical" | "qualified" | "stale" | "superseded" | "retracted";
  mayMerge?: boolean;
  mayAutoDeprecate?: boolean;
}

export interface OperatorPolicyRequest {
  actor: ActorContext;
  operation: GovernedOperation;
  /** Action enclosed by proposal.create/proposal.execute. */
  proposedAction?: ActionType;
  directCapture?: DirectCaptureConstraints;
  autonomyProfile?: string;
}

export interface OperatorPolicyDecision {
  effect: PolicyDecisionEffect;
  operation: GovernedOperation;
  actionType: ActionType | null;
  requiredScopes: readonly ServiceScope[];
  grantedScopes: readonly ServiceScope[];
  reasonCode: string;
  reason: string;
  autonomyProfile: string;
  policyVersion: string;
}

const DIRECT_DRAFT_SCOPES = ["memory:draft", "audit:write", "run:write"] as const satisfies readonly ServiceScope[];
const PROPOSE_SCOPES = ["memory:propose", "proposal:create", "audit:write", "run:write"] as const satisfies readonly ServiceScope[];
const EXECUTE_SCOPES = ["memory:execute-approved", "proposal:execute-approved", "audit:write", "run:write"] as const satisfies readonly ServiceScope[];
const ACTION_TYPE_SET = new Set<string>(ACTION_TYPES);
const AUTONOMY_PROFILE_RANK = {
  observe: 0,
  draft: 1,
  propose: 2,
  "execute-approved": 3,
} as const;
type ServiceAutonomyProfile = keyof typeof AUTONOMY_PROFILE_RANK;

function decide(
  request: OperatorPolicyRequest,
  effect: PolicyDecisionEffect,
  reasonCode: string,
  reason: string,
  requiredScopes: readonly ServiceScope[] = [],
): OperatorPolicyDecision {
  return {
    effect,
    operation: request.operation,
    actionType: request.proposedAction
      ?? (ACTION_TYPE_SET.has(request.operation) ? request.operation as ActionType : null),
    requiredScopes,
    grantedScopes: [...request.actor.scopes],
    reasonCode,
    reason,
    autonomyProfile: request.autonomyProfile
      ?? (request.actor.kind === "service" ? "observe" : request.actor.kind === "human" ? "human-reviewed" : "system"),
    policyVersion: OPERATOR_POLICY_VERSION,
  };
}

function requireScopes(
  request: OperatorPolicyRequest,
  scopes: readonly ServiceScope[],
  effect: PolicyDecisionEffect,
  reasonCode: string,
  reason: string,
): OperatorPolicyDecision {
  const missing = scopes.filter((scope) => !request.actor.scopes.has(scope));
  if (missing.length > 0) {
    return decide(
      request,
      "deny",
      "missing_scope",
      `Missing required service scope${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      scopes,
    );
  }
  return decide(request, effect, reasonCode, reason, scopes);
}

function requireAutonomyProfile(
  request: OperatorPolicyRequest,
  minimum: ServiceAutonomyProfile,
): OperatorPolicyDecision | null {
  const profile = request.autonomyProfile ?? "observe";
  if (!(profile in AUTONOMY_PROFILE_RANK)) {
    return decide(
      request,
      "deny",
      "invalid_autonomy_profile",
      `Unknown service autonomy profile: ${profile}`,
    );
  }
  if (AUTONOMY_PROFILE_RANK[profile as ServiceAutonomyProfile] < AUTONOMY_PROFILE_RANK[minimum]) {
    return decide(
      request,
      "deny",
      "autonomy_profile_insufficient",
      `The ${profile} autonomy profile does not permit this operation; ${minimum} or higher is required.`,
    );
  }
  return null;
}

/** Decide policy without receiving or exposing any storage/runtime capability. */
export function decideOperatorAction(request: OperatorPolicyRequest): OperatorPolicyDecision {
  const { actor, operation } = request;

  if (actor.kind === "human") {
    return decide(request, "allow", "human_authenticated", "Authenticated humans may perform this governed action.");
  }

  if (actor.kind === "system") {
    if (actor.systemId === NIGHTLY_CONTRADICTION_SYSTEM_ID) {
      if (operation === "proposal.create" && request.proposedAction === "edge.publish") {
        return requireScopes(
          request,
          ["proposal:create", "audit:write", "run:write"],
          "allow",
          "nightly_contradiction_proposal",
          "The nightly contradiction scanner may only create a human-reviewable edge proposal.",
        );
      }
      if (operation === "proposal.approve" || operation === "proposal.reject" || operation === "proposal.execute") {
        return decide(
          request,
          "deny",
          "nightly_scanner_review_forbidden",
          "The nightly contradiction scanner may never review or execute proposals.",
        );
      }
      return decide(
        request,
        "deny",
        "nightly_scanner_scope_forbidden",
        "The nightly contradiction scanner is limited to contradiction edge proposals.",
      );
    }
    if (operation === "memory.read") {
      return requireScopes(request, ["memory:read"], "allow", "system_read", "System identity has explicit read scope.");
    }
    if (operation === "proposal.execute") {
      return requireScopes(request, EXECUTE_SCOPES, "allow", "approved_executor", "System identity may execute a human-approved proposal.");
    }
    return decide(request, "deny", "system_default_deny", "System identities are denied unless an operation is explicitly whitelisted.");
  }

  const serviceProfile = request.autonomyProfile ?? "observe";
  if (!(serviceProfile in AUTONOMY_PROFILE_RANK)) {
    return decide(
      request,
      "deny",
      "invalid_autonomy_profile",
      `Unknown service autonomy profile: ${serviceProfile}`,
    );
  }

  if (operation === "memory.read") {
    return requireScopes(request, ["memory:read", "audit:write", "run:write"], "allow", "service_read", "Service identity has explicit read and audit scopes.");
  }

  if (operation === "proposal.read") {
    return requireScopes(request, ["proposal:read", "audit:write", "run:write"], "allow", "service_proposal_read", "Service identity has explicit proposal read and audit scopes.");
  }

  if (operation === "proposal.approve" || operation === "proposal.reject") {
    return decide(request, "deny", "human_review_required", "Only a human may approve or reject a proposal.");
  }

  if (operation === "entry.forget" || operation === "edge.unlink") {
    return decide(request, "deny", "service_destructive_action_forbidden", "Service identities may never forget memory or unlink knowledge.");
  }

  if (operation === "proposal.execute") {
    const profileDenied = requireAutonomyProfile(request, "execute-approved");
    if (profileDenied) return profileDenied;
    return requireScopes(request, EXECUTE_SCOPES, "allow", "approved_executor", "Service identity may execute a human-approved proposal.");
  }

  if (operation === "proposal.create") {
    if (!request.proposedAction) {
      return decide(request, "deny", "proposal_action_required", "A proposal must name a whitelisted action.");
    }
    const profileDenied = requireAutonomyProfile(request, "propose");
    if (profileDenied) return profileDenied;
    return requireScopes(request, PROPOSE_SCOPES, "allow", "service_proposal", "Service identity may create a human-reviewable proposal.");
  }

  if (operation === "entry.create") {
    const constraints = request.directCapture;
    const safe = constraints?.visibility === "private"
      && constraints.lifecycleStatus === "draft"
      && constraints.epistemicStatus === "candidate"
      && constraints.mayMerge !== true
      && constraints.mayAutoDeprecate !== true;
    if (!safe) {
      const profileDenied = requireAutonomyProfile(request, "propose");
      if (profileDenied) return profileDenied;
      return requireScopes(
        request,
        PROPOSE_SCOPES,
        "proposal_required",
        "unsafe_direct_capture",
        "A service may write directly only as a private draft candidate without merge or auto-deprecation.",
      );
    }
    const profileDenied = requireAutonomyProfile(request, "draft");
    if (profileDenied) return profileDenied;
    return requireScopes(request, DIRECT_DRAFT_SCOPES, "allow", "safe_private_draft", "Private draft candidate capture is the only direct service write.");
  }

  // All other whitelisted writes are representable as proposals, never direct
  // service mutations. Missing proposal scopes turns this into a hard deny.
  const profileDenied = requireAutonomyProfile(request, "propose");
  if (profileDenied) return profileDenied;
  return requireScopes(
    request,
    PROPOSE_SCOPES,
    "proposal_required",
    "human_approval_required",
    "This service action requires a proposal and explicit human approval.",
  );
}

export class OperatorPolicyError extends Error {
  constructor(readonly decision: OperatorPolicyDecision) {
    super(decision.reason);
    this.name = "OperatorPolicyError";
  }
}

export function requireAllowedDecision(decision: OperatorPolicyDecision): void {
  if (decision.effect !== "allow") throw new OperatorPolicyError(decision);
}
