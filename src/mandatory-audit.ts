/** Fail-closed audit envelope for every governed mutation. */

import type { ActorContext, Env } from "./types";
import type { OperatorPolicyDecision } from "./operator-policy";
import { sha256Hex, sqlChanges, stableJson } from "./governance-utils";

export interface MandatoryAuditRequest {
  actor: ActorContext;
  subjectUserId: string;
  operation: string;
  decision: OperatorPolicyDecision;
  correlationId?: string | null;
  proposalId?: string | null;
  targetIds?: readonly string[];
  /** Caller-owned, intentionally redacted metadata. Never pass raw content. */
  redactedRequest?: Record<string, unknown> | null;
  now?: number;
}

export interface MandatoryAuditReceipt {
  runId: string;
  requestedAt: number;
}

type TerminalAuditOutcome = "succeeded" | "failed" | "indeterminate";

interface PreparedCompletion {
  outcome: TerminalAuditOutcome;
  completedAt: number;
  outputSummary: string | null;
  outputHash: string | null;
  failureName: string | null;
  errorCode: string | null;
}

interface ReconciliationRow {
  run_id: string;
  outcome: TerminalAuditOutcome;
  redacted_result_summary: string | null;
  result_hash: string | null;
  failure_name: string | null;
  error_code: string | null;
  attempts: number;
  ready_at: number | null;
}

export interface MandatoryAuditReconciliationResult {
  reservedRecovered: number;
  completed: number;
  retried: number;
  deadLettered: number;
}

const DEFAULT_RECONCILIATION_LIMIT = 25;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_RESERVED_STALE_AFTER_MS = 15 * 60 * 1000;

export class MandatoryAuditError extends Error {
  constructor(
    readonly stage: "requested" | "succeeded" | "failed",
    message: string,
    readonly cause?: unknown,
    readonly mutationError?: unknown,
  ) {
    super(message);
    this.name = "MandatoryAuditError";
  }
}

function actorFields(actor: ActorContext): {
  serviceIdentityId: string | null;
  credentialId: string | null;
} {
  return actor.kind === "service"
    ? { serviceIdentityId: actor.serviceIdentityId, credentialId: actor.credentialId }
    : { serviceIdentityId: null, credentialId: null };
}

async function insertRequested(
  env: Pick<Env, "DB">,
  input: MandatoryAuditRequest,
): Promise<MandatoryAuditReceipt> {
  const runId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const now = input.now ?? Date.now();
  const requestSummary = input.redactedRequest ? stableJson(input.redactedRequest).slice(0, 500) : null;
  const requestHash = requestSummary === null ? null : await sha256Hex(requestSummary);
  const requestedScopes = JSON.stringify(input.decision.requiredScopes);
  const grantedScopes = JSON.stringify(input.decision.grantedScopes);
  const targetIds = JSON.stringify(input.targetIds ?? []);
  const fields = actorFields(input.actor);

  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO agent_runs (
           id, user_id, started_at, completed_at, tool_count,
           actor_kind, actor_id, service_identity_id, credential_id,
           auth_method, autonomy_profile, policy_version, correlation_id,
           status, policy_decision, requested_scopes, granted_scopes,
           decision_reason, proposal_id, target_ids,
           redacted_request_summary, request_hash, requested_at
         ) VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?,
                   'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        runId,
        input.subjectUserId,
        now,
        input.actor.kind,
        input.actor.actorId,
        fields.serviceIdentityId,
        fields.credentialId,
        input.actor.authMethod,
        input.decision.autonomyProfile,
        input.decision.policyVersion,
        input.correlationId ?? null,
        input.decision.effect,
        requestedScopes,
        grantedScopes,
        input.decision.reason,
        input.proposalId ?? null,
        targetIds,
        requestSummary,
        requestHash,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO agent_events (
           id, run_id, sequence, event_type, tool_name,
           actor_kind, actor_id, service_identity_id, credential_id,
           auth_method, autonomy_profile, policy_version, correlation_id,
           status, policy_decision, requested_scopes, granted_scopes,
           decision_reason, proposal_id, target_ids,
           input_summary, redacted_input_summary, input_hash, created_at
         ) VALUES (?, ?, 1, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        eventId,
        runId,
        input.operation,
        input.actor.kind,
        input.actor.actorId,
        fields.serviceIdentityId,
        fields.credentialId,
        input.actor.authMethod,
        input.decision.autonomyProfile,
        input.decision.policyVersion,
        input.correlationId ?? null,
        input.decision.effect,
        requestedScopes,
        grantedScopes,
        input.decision.reason,
        input.proposalId ?? null,
        targetIds,
        requestSummary,
        requestSummary,
        requestHash,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO audit_completion_reconciliation (
           run_id, outcome, redacted_result_summary, result_hash,
           failure_name, error_code, status, attempts, last_error,
           created_at, updated_at, ready_at, completed_at
         ) VALUES (?, NULL, NULL, NULL, NULL, NULL, 'reserved', 0, NULL,
                   ?, ?, NULL, NULL)`,
      ).bind(runId, now, now),
    ]);
    if (
      sqlChanges(results[0]) !== 1
      || sqlChanges(results[1]) !== 1
      || sqlChanges(results[2]) !== 1
    ) {
      throw new Error("Requested audit batch did not persist every required record.");
    }
  } catch (cause) {
    throw new MandatoryAuditError("requested", "Required requested audit record could not be persisted; mutation was not run.", cause);
  }
  return { runId, requestedAt: now };
}

async function prepareCompletion(
  input: MandatoryAuditRequest,
  outcome: "succeeded" | "failed",
  details: { redactedResult?: Record<string, unknown> | null; error?: unknown; errorCode?: string | null },
): Promise<PreparedCompletion> {
  const outputSummary = details.redactedResult ? stableJson(details.redactedResult).slice(0, 500) : null;
  const outputHash = outputSummary === null ? null : await sha256Hex(outputSummary);
  // Error messages can contain provider payload fragments. Persist only the
  // class/name; detailed failures belong in trusted runtime logs.
  const failureName = details.error
    ? (details.error instanceof Error ? details.error.name : "GovernedMutationError")
    : null;
  return {
    outcome,
    completedAt: input.now ?? Date.now(),
    outputSummary,
    outputHash,
    failureName,
    errorCode: details.errorCode ?? (outcome === "failed" ? "governed_mutation_failed" : null),
  };
}

async function stageCompletionReconciliation(
  env: Pick<Env, "DB">,
  receipt: MandatoryAuditReceipt,
  completion: PreparedCompletion,
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE audit_completion_reconciliation
     SET outcome = ?, redacted_result_summary = ?, result_hash = ?,
         failure_name = ?, error_code = ?, status = 'ready',
         updated_at = ?, ready_at = ?
     WHERE run_id = ? AND status = 'reserved'`,
  ).bind(
    completion.outcome,
    completion.outputSummary,
    completion.outputHash,
    completion.failureName,
    completion.errorCode,
    completion.completedAt,
    completion.completedAt,
    receipt.runId,
  ).run();
  if (sqlChanges(result) !== 1) {
    throw new Error("Audit completion reconciliation reservation was not staged.");
  }
}

async function markReconciliationCompleted(
  env: Pick<Env, "DB">,
  receipt: MandatoryAuditReceipt,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE audit_completion_reconciliation
     SET status = 'completed', updated_at = ?, completed_at = ?, last_error = NULL
     WHERE run_id = ? AND status <> 'completed'`,
  ).bind(now, now, receipt.runId).run();
}

async function terminalizeRun(
  env: Pick<Env, "DB">,
  runId: string,
  completion: PreparedCompletion,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE agent_runs
     SET status = ?, completed_at = ?, redacted_result_summary = ?,
         result_hash = ?, error_code = ?,
         succeeded_at = CASE WHEN ? = 'succeeded' THEN ? ELSE succeeded_at END,
         failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END
     WHERE id = ? AND status = 'requested'`,
  ).bind(
    completion.outcome,
    completion.completedAt,
    completion.outputSummary,
    completion.outputHash,
    completion.errorCode,
    completion.outcome,
    completion.completedAt,
    completion.outcome,
    completion.completedAt,
    runId,
  ).run();
}

async function insertCompletion(
  env: Pick<Env, "DB">,
  input: MandatoryAuditRequest,
  receipt: MandatoryAuditReceipt,
  completion: PreparedCompletion,
  mutationError?: unknown,
): Promise<void> {
  const outcome = completion.outcome as "succeeded" | "failed";
  const now = completion.completedAt;
  const eventId = crypto.randomUUID();
  const fields = actorFields(input.actor);
  const requestedScopes = JSON.stringify(input.decision.requiredScopes);
  const grantedScopes = JSON.stringify(input.decision.grantedScopes);
  const targetIds = JSON.stringify(input.targetIds ?? []);

  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE agent_runs
         SET completed_at = ?, status = ?,
             redacted_result_summary = ?, result_hash = ?, error_code = ?,
             succeeded_at = CASE WHEN ? = 'succeeded' THEN ? ELSE succeeded_at END,
             failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END
         WHERE id = ? AND status = 'requested'`,
      ).bind(
        now,
        outcome,
        completion.outputSummary,
        completion.outputHash,
        completion.errorCode,
        outcome,
        now,
        outcome,
        now,
        receipt.runId,
      ),
      env.DB.prepare(
        `INSERT INTO agent_events (
           id, run_id, sequence, event_type, tool_name,
           actor_kind, actor_id, service_identity_id, credential_id,
           auth_method, autonomy_profile, policy_version, correlation_id,
           status, policy_decision, requested_scopes, granted_scopes,
           decision_reason, proposal_id, target_ids,
           output_summary, redacted_output_summary, output_hash,
           error, error_code, created_at
         )
         SELECT ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      ).bind(
        eventId,
        receipt.runId,
        outcome,
        input.operation,
        input.actor.kind,
        input.actor.actorId,
        fields.serviceIdentityId,
        fields.credentialId,
        input.actor.authMethod,
        input.decision.autonomyProfile,
        input.decision.policyVersion,
        input.correlationId ?? null,
        outcome,
        input.decision.effect,
        requestedScopes,
        grantedScopes,
        input.decision.reason,
        input.proposalId ?? null,
        targetIds,
        completion.outputSummary,
        completion.outputSummary,
        completion.outputHash,
        completion.failureName,
        completion.errorCode,
        now,
      ),
    ]);
    if (sqlChanges(results[0]) !== 1 || sqlChanges(results[1]) !== 1) {
      throw new Error(`${outcome} audit batch did not persist both records.`);
    }
  } catch (cause) {
    // The mutation has already returned. A separate, deliberately minimal
    // projection prevents the run from remaining `requested` when only the
    // terminal event batch failed. The pre-created reconciliation reservation
    // remains durable and lets the scheduled reconciler restore event parity.
    try {
      await terminalizeRun(env, receipt.runId, completion);
    } catch {
      // The durable reservation is still authoritative. A stale reservation is
      // reconciled as indeterminate instead of guessing that a mutation failed.
    }
    throw new MandatoryAuditError(outcome, `Required ${outcome} audit record could not be persisted.`, cause, mutationError);
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value!)));
}

async function recoverReservedRows(
  env: Pick<Env, "DB">,
  now: number,
  staleAfterMs: number,
  limit: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT reconciliation.run_id, reconciliation.created_at,
            run.status AS run_status, run.completed_at,
            run.redacted_result_summary, run.result_hash, run.error_code
     FROM audit_completion_reconciliation AS reconciliation
     LEFT JOIN agent_runs AS run ON run.id = reconciliation.run_id
     WHERE reconciliation.status = 'reserved'
     ORDER BY reconciliation.created_at, reconciliation.run_id
     LIMIT ?`,
  ).bind(limit).all<{
    run_id: string;
    created_at: number;
    run_status: string | null;
    completed_at: number | null;
    redacted_result_summary: string | null;
    result_hash: string | null;
    error_code: string | null;
  }>();

  let recovered = 0;
  for (const row of result.results) {
    const terminal = row.run_status === "succeeded" || row.run_status === "failed" || row.run_status === "indeterminate";
    if (!terminal && row.created_at > now - staleAfterMs) continue;
    const outcome: TerminalAuditOutcome = terminal
      ? row.run_status as TerminalAuditOutcome
      : "indeterminate";
    const completedAt = row.completed_at ?? now;
    const failureName = outcome === "indeterminate" ? "AuditOutcomeUnconfirmed" : null;
    const errorCode = outcome === "indeterminate"
      ? "audit_outcome_unconfirmed"
      : row.error_code;
    const update = await env.DB.prepare(
      `UPDATE audit_completion_reconciliation
       SET outcome = ?, redacted_result_summary = ?, result_hash = ?,
           failure_name = ?, error_code = ?, status = 'ready',
           updated_at = ?, ready_at = ?
       WHERE run_id = ? AND status = 'reserved'`,
    ).bind(
      outcome,
      row.redacted_result_summary,
      row.result_hash,
      failureName,
      errorCode,
      now,
      completedAt,
      row.run_id,
    ).run();
    recovered += sqlChanges(update);
  }
  return recovered;
}

async function insertReconciledTerminalEvent(
  env: Pick<Env, "DB">,
  row: ReconciliationRow,
  now: number,
): Promise<void> {
  const completedAt = row.ready_at ?? now;
  const completion: PreparedCompletion = {
    outcome: row.outcome,
    completedAt,
    outputSummary: row.redacted_result_summary,
    outputHash: row.result_hash,
    failureName: row.failure_name,
    errorCode: row.error_code,
  };
  await terminalizeRun(env, row.run_id, completion);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_events (
       id, run_id, sequence, event_type, tool_name,
       actor_kind, actor_id, service_identity_id, credential_id,
       auth_method, autonomy_profile, policy_version, correlation_id,
       status, policy_decision, requested_scopes, granted_scopes,
       decision_reason, proposal_id, target_ids,
       output_summary, redacted_output_summary, output_hash,
       error, error_code, created_at
     )
     SELECT ?, requested.run_id, 2, ?, requested.tool_name,
            requested.actor_kind, requested.actor_id,
            requested.service_identity_id, requested.credential_id,
            requested.auth_method, requested.autonomy_profile,
            requested.policy_version, requested.correlation_id,
            ?, requested.policy_decision, requested.requested_scopes,
            requested.granted_scopes, requested.decision_reason,
            requested.proposal_id, requested.target_ids,
            ?, ?, ?, ?, ?, ?
     FROM agent_events AS requested
     WHERE requested.run_id = ? AND requested.sequence = 1
       AND NOT EXISTS (
         SELECT 1 FROM agent_events AS terminal
         WHERE terminal.run_id = requested.run_id AND terminal.sequence = 2
       )
     ORDER BY requested.created_at, requested.id
     LIMIT 1`,
  ).bind(
    `audit-terminal:${row.run_id}`,
    row.outcome,
    row.outcome,
    row.redacted_result_summary,
    row.redacted_result_summary,
    row.result_hash,
    row.failure_name,
    row.error_code,
    completedAt,
    row.run_id,
  ).run();

  const terminal = await env.DB.prepare(
    `SELECT 1 AS present FROM agent_runs AS run
     WHERE run.id = ? AND run.status IN ('succeeded', 'failed', 'indeterminate')
       AND EXISTS (
         SELECT 1 FROM agent_events AS event
         WHERE event.run_id = run.id AND event.sequence = 2
       )`,
  ).bind(row.run_id).first<{ present: number }>();
  if (!terminal) throw new Error("Reconciled audit terminal projection is incomplete.");

  await env.DB.prepare(
    `UPDATE audit_completion_reconciliation
     SET status = 'completed', completed_at = ?, updated_at = ?, last_error = NULL
     WHERE run_id = ? AND status = 'ready'`,
  ).bind(now, now, row.run_id).run();
}

/**
 * Reconcile terminal audit projections after a post-mutation audit failure.
 * Work is bounded, idempotent, and stores only already-redacted projections.
 */
export async function reconcileMandatoryAuditCompletions(
  env: Pick<Env, "DB">,
  options: {
    now?: number;
    limit?: number;
    maxAttempts?: number;
    reservedStaleAfterMs?: number;
  } = {},
): Promise<MandatoryAuditReconciliationResult> {
  const now = options.now ?? Date.now();
  const limit = clampInteger(options.limit, DEFAULT_RECONCILIATION_LIMIT, 1, 100);
  const maxAttempts = clampInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 20);
  const staleAfterMs = clampInteger(
    options.reservedStaleAfterMs,
    DEFAULT_RESERVED_STALE_AFTER_MS,
    1_000,
    24 * 60 * 60 * 1000,
  );
  const summary: MandatoryAuditReconciliationResult = {
    reservedRecovered: await recoverReservedRows(env, now, staleAfterMs, limit),
    completed: 0,
    retried: 0,
    deadLettered: 0,
  };

  const rows = await env.DB.prepare(
    `SELECT run_id, outcome, redacted_result_summary, result_hash,
            failure_name, error_code, attempts, ready_at
     FROM audit_completion_reconciliation
     WHERE status = 'ready' AND outcome IS NOT NULL
     ORDER BY COALESCE(ready_at, updated_at), run_id
     LIMIT ?`,
  ).bind(limit).all<ReconciliationRow>();

  for (const row of rows.results) {
    try {
      await insertReconciledTerminalEvent(env, row, now);
      summary.completed += 1;
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const deadLetter = attempts >= maxAttempts;
      const failureName = error instanceof Error ? error.name : "AuditReconciliationError";
      await env.DB.prepare(
        `UPDATE audit_completion_reconciliation
         SET attempts = ?, last_error = ?, updated_at = ?, status = ?
         WHERE run_id = ? AND status = 'ready'`,
      ).bind(
        attempts,
        failureName,
        now,
        deadLetter ? "dead_letter" : "ready",
        row.run_id,
      ).run();
      if (deadLetter) summary.deadLettered += 1;
      else summary.retried += 1;
    }
  }
  return summary;
}

/**
 * Persist request evidence first, run the mutation only after it succeeds, then
 * persist the outcome. Raw request/result values never enter this API.
 */
export async function withMandatoryAudit<T>(
  env: Pick<Env, "DB">,
  input: MandatoryAuditRequest,
  mutation: () => Promise<T>,
  summarizeResult: (result: T) => Record<string, unknown> | null = () => null,
): Promise<T> {
  const receipt = await insertRequested(env, input);
  try {
    const result = await mutation();
    let redactedResult: Record<string, unknown> | null = null;
    try {
      redactedResult = summarizeResult(result);
    } catch {
      // A projection callback must never turn a completed mutation into a raw
      // data leak or an incorrectly failed run.
    }
    const completion = await prepareCompletion(input, "succeeded", { redactedResult });
    try {
      await stageCompletionReconciliation(env, receipt, completion);
    } catch {
      // insertCompletion is still authoritative; if it also fails, the durable
      // reservation is recovered from the terminal run or becomes indeterminate.
    }
    await insertCompletion(env, input, receipt, completion);
    try {
      await markReconciliationCompleted(env, receipt, completion.completedAt);
    } catch {
      // Scheduled reconciliation observes the already-terminal run/event pair.
    }
    return result;
  } catch (error) {
    if (error instanceof MandatoryAuditError && error.stage === "succeeded") throw error;
    const completion = await prepareCompletion(input, "failed", { error });
    try {
      await stageCompletionReconciliation(env, receipt, completion);
    } catch {
      // See the succeeded path: the pre-action reservation is still durable.
    }
    await insertCompletion(env, input, receipt, completion, error);
    try {
      await markReconciliationCompleted(env, receipt, completion.completedAt);
    } catch {
      // Scheduled reconciliation observes the already-terminal run/event pair.
    }
    throw error;
  }
}
