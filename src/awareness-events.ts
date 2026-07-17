/**
 * Durable, recipient-scoped awareness for public cross-user memory overlap.
 *
 * Vector similarity is only a candidate signal. Every event insert and every
 * read re-authorizes both endpoints against D1, which is the visibility source
 * of truth. A staged reconciliation intent makes the derived notification
 * retryable without weakening the durability of the captured memory.
 */

import type {
  AwarenessDelivery,
  AwarenessEvent,
  AwarenessEventEndpoint,
  Env,
} from "./types";

interface ReconciliationRow {
  id: string;
  new_entry_id: string;
  matched_entry_id: string;
  similarity: number;
  status: string;
}

interface EndpointState {
  new_owner_user_id: string;
  matched_owner_user_id: string;
}

interface AwarenessRow {
  id: string;
  event_type: "cross_user_overlap";
  recipient_user_id: string;
  trigger_entry_id: string;
  similarity: number;
  created_at: number;
  read_at: number | null;
  entry_a_id: string;
  entry_a_content: string;
  entry_a_created_at: number;
  entry_a_owner_user_id: string;
  entry_a_owner_username: string;
  entry_b_id: string;
  entry_b_content: string;
  entry_b_created_at: number;
  entry_b_owner_user_id: string;
  entry_b_owner_username: string;
}

function uuid(): string {
  return crypto.randomUUID();
}

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function endpoint(
  id: string,
  ownerUserId: string,
  ownerUsername: string,
  content: string,
  createdAt: number,
): AwarenessEventEndpoint {
  return { entryId: id, ownerUserId, ownerUsername, content, createdAt };
}

function mapEvent(row: AwarenessRow): AwarenessEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    recipientUserId: row.recipient_user_id,
    triggerEntryId: row.trigger_entry_id,
    similarity: Number(row.similarity),
    endpoints: [
      endpoint(
        row.entry_a_id,
        row.entry_a_owner_user_id,
        row.entry_a_owner_username,
        row.entry_a_content,
        Number(row.entry_a_created_at),
      ),
      endpoint(
        row.entry_b_id,
        row.entry_b_owner_user_id,
        row.entry_b_owner_username,
        row.entry_b_content,
        Number(row.entry_b_created_at),
      ),
    ],
    createdAt: Number(row.created_at),
    readAt: row.read_at === null ? null : Number(row.read_at),
  };
}

/**
 * Persist retry state before the new memory is committed. The INSERT validates
 * that the matched endpoint is still public and both proposed recipients are
 * active. If the capture later fails, the intent is discarded; a missed
 * cleanup is also safe because reconciliation discards missing endpoints.
 */
export async function stageOverlapAwarenessIntent(
  env: Env,
  input: {
    newEntryId: string;
    newOwnerUserId: string;
    matchedEntryId: string;
    matchedOwnerUserId: string;
    similarity: number;
    newEntryIsPublic: boolean;
    now?: number;
  },
): Promise<string | null> {
  if (!input.newEntryIsPublic || input.newOwnerUserId === input.matchedOwnerUserId) return null;
  if (!Number.isFinite(input.similarity) || input.similarity < 0 || input.similarity > 1) return null;

  const id = uuid();
  const now = input.now ?? Date.now();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO overlap_awareness_reconciliation (
       id, new_entry_id, matched_entry_id, expected_new_owner_user_id,
       expected_matched_owner_user_id, similarity, status, attempts,
       created_at, updated_at
     )
     SELECT ?, ?, matched.id, new_owner.id, matched.owner_user_id, ?,
       'pending', 0, ?, ?
     FROM entries AS matched
     JOIN users AS matched_owner
       ON matched_owner.id = matched.owner_user_id
      AND matched_owner.status = 'active'
     JOIN users AS new_owner
       ON new_owner.id = ?
      AND new_owner.status = 'active'
     WHERE matched.id = ?
       AND matched.owner_user_id = ?
       AND matched.visibility = 'public'
       AND matched.owner_user_id <> new_owner.id`,
  ).bind(
    id,
    input.newEntryId,
    input.similarity,
    now,
    now,
    input.newOwnerUserId,
    input.matchedEntryId,
    input.matchedOwnerUserId,
  ).run();

  if (changes(result) === 1) return id;
  const existing = await env.DB.prepare(
    `SELECT id FROM overlap_awareness_reconciliation
     WHERE new_entry_id = ? AND matched_entry_id = ?`,
  ).bind(input.newEntryId, input.matchedEntryId).first<{ id: string }>();
  return existing?.id ?? null;
}

export async function discardOverlapAwarenessIntent(
  env: Env,
  reconciliationId: string,
  reason = "capture_failed",
  now = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE overlap_awareness_reconciliation
     SET status = 'discarded', last_error = ?, updated_at = ?, completed_at = ?
     WHERE id = ? AND status IN ('pending', 'failed')`,
  ).bind(reason.slice(0, 500), now, now, reconciliationId).run();
}

async function loadEndpointState(env: Env, reconciliationId: string): Promise<EndpointState | null> {
  return env.DB.prepare(
    `SELECT new_entry.owner_user_id AS new_owner_user_id,
            matched_entry.owner_user_id AS matched_owner_user_id
     FROM overlap_awareness_reconciliation AS reconciliation
     JOIN entries AS new_entry ON new_entry.id = reconciliation.new_entry_id
     JOIN entries AS matched_entry ON matched_entry.id = reconciliation.matched_entry_id
     JOIN users AS new_owner
       ON new_owner.id = new_entry.owner_user_id AND new_owner.status = 'active'
     JOIN users AS matched_owner
       ON matched_owner.id = matched_entry.owner_user_id AND matched_owner.status = 'active'
     WHERE reconciliation.id = ?
       AND new_entry.visibility = 'public'
       AND matched_entry.visibility = 'public'
       AND new_entry.owner_user_id <> matched_entry.owner_user_id`,
  ).bind(reconciliationId).first<EndpointState>();
}

async function markIntent(
  env: Env,
  reconciliationId: string,
  status: "completed" | "discarded",
  now: number,
  lastError: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE overlap_awareness_reconciliation
     SET status = ?, last_error = ?, updated_at = ?, completed_at = ?
     WHERE id = ? AND status IN ('pending', 'failed', ?)`,
  ).bind(status, lastError, now, now, reconciliationId, status).run();
}

/**
 * Create both recipient rows atomically and idempotently. The INSERT ... SELECT
 * predicates recheck both endpoint visibilities and both user statuses in the
 * same D1 batch that writes the events.
 */
export async function reconcileOverlapAwarenessIntent(
  env: Env,
  reconciliationId: string,
  now = Date.now(),
): Promise<AwarenessDelivery> {
  const reconciliation = await env.DB.prepare(
    `SELECT id, new_entry_id, matched_entry_id, similarity, status
     FROM overlap_awareness_reconciliation WHERE id = ?`,
  ).bind(reconciliationId).first<ReconciliationRow>();

  if (!reconciliation) return { status: "not_applicable", eventCount: 0 };
  if (reconciliation.status === "discarded") {
    return { status: "discarded", eventCount: 0, reconciliationId };
  }

  const [entryAId, entryBId] = reconciliation.new_entry_id < reconciliation.matched_entry_id
    ? [reconciliation.new_entry_id, reconciliation.matched_entry_id]
    : [reconciliation.matched_entry_id, reconciliation.new_entry_id];

  const insertFor = (recipient: "new" | "matched") => env.DB.prepare(
    `INSERT OR IGNORE INTO awareness_events (
       id, event_type, recipient_user_id, entry_a_id, entry_b_id,
       trigger_entry_id, similarity, created_at, read_at
     )
     SELECT ?, 'cross_user_overlap', ${recipient === "new" ? "new_entry.owner_user_id" : "matched_entry.owner_user_id"},
       ?, ?, reconciliation.new_entry_id, reconciliation.similarity, ?, NULL
     FROM overlap_awareness_reconciliation AS reconciliation
     JOIN entries AS new_entry ON new_entry.id = reconciliation.new_entry_id
     JOIN entries AS matched_entry ON matched_entry.id = reconciliation.matched_entry_id
     JOIN users AS new_owner
       ON new_owner.id = new_entry.owner_user_id AND new_owner.status = 'active'
     JOIN users AS matched_owner
       ON matched_owner.id = matched_entry.owner_user_id AND matched_owner.status = 'active'
     WHERE reconciliation.id = ?
       AND reconciliation.status IN ('pending', 'failed', 'completed')
       AND new_entry.visibility = 'public'
       AND matched_entry.visibility = 'public'
       AND new_entry.owner_user_id <> matched_entry.owner_user_id`,
  ).bind(uuid(), entryAId, entryBId, now, reconciliationId);

  try {
    await env.DB.batch([insertFor("new"), insertFor("matched")]);

    const current = await loadEndpointState(env, reconciliationId);
    if (!current) {
      await markIntent(env, reconciliationId, "discarded", now, "endpoint_not_public_or_owner_inactive");
      return { status: "discarded", eventCount: 0, reconciliationId };
    }

    const countRow = await env.DB.prepare(
      `SELECT COUNT(DISTINCT recipient_user_id) AS count
       FROM awareness_events
       WHERE event_type = 'cross_user_overlap'
         AND entry_a_id = ? AND entry_b_id = ?
         AND recipient_user_id IN (?, ?)`,
    ).bind(
      entryAId,
      entryBId,
      current.new_owner_user_id,
      current.matched_owner_user_id,
    ).first<{ count: number }>();

    if (Number(countRow?.count ?? 0) !== 2) {
      throw new Error("Both overlap-awareness recipients were not persisted");
    }

    await markIntent(env, reconciliationId, "completed", now);
    return { status: "ready", eventCount: 2, reconciliationId };
  } catch (error) {
    try {
      await env.DB.prepare(
        `UPDATE overlap_awareness_reconciliation
         SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')`,
      ).bind(errorMessage(error), now, reconciliationId).run();
    } catch (markError) {
      console.error("Could not record overlap-awareness reconciliation failure", markError);
    }
    return { status: "pending_reconciliation", eventCount: 0, reconciliationId };
  }
}

export async function reconcilePendingOverlapAwareness(
  env: Env,
  limit = 50,
): Promise<{ processed: number; ready: number; discarded: number; pending: number }> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await env.DB.prepare(
    `SELECT id FROM overlap_awareness_reconciliation
     WHERE status IN ('pending', 'failed')
     ORDER BY updated_at ASC, id ASC LIMIT ?`,
  ).bind(boundedLimit).all<{ id: string }>();

  let ready = 0;
  let discarded = 0;
  let pending = 0;
  for (const row of result.results) {
    const delivery = await reconcileOverlapAwarenessIntent(env, row.id);
    if (delivery.status === "ready") ready++;
    else if (delivery.status === "discarded" || delivery.status === "not_applicable") discarded++;
    else pending++;
  }
  return { processed: result.results.length, ready, discarded, pending };
}

const VISIBLE_EVENT_SELECT = `
  SELECT awareness.id, awareness.event_type, awareness.recipient_user_id,
    awareness.trigger_entry_id, awareness.similarity, awareness.created_at,
    awareness.read_at,
    entry_a.id AS entry_a_id, entry_a.content AS entry_a_content,
    entry_a.created_at AS entry_a_created_at,
    entry_a.owner_user_id AS entry_a_owner_user_id,
    owner_a.username AS entry_a_owner_username,
    entry_b.id AS entry_b_id, entry_b.content AS entry_b_content,
    entry_b.created_at AS entry_b_created_at,
    entry_b.owner_user_id AS entry_b_owner_user_id,
    owner_b.username AS entry_b_owner_username
  FROM awareness_events AS awareness
  JOIN users AS recipient
    ON recipient.id = awareness.recipient_user_id AND recipient.status = 'active'
  JOIN entries AS entry_a
    ON entry_a.id = awareness.entry_a_id AND entry_a.visibility = 'public'
  JOIN entries AS entry_b
    ON entry_b.id = awareness.entry_b_id AND entry_b.visibility = 'public'
  JOIN users AS owner_a
    ON owner_a.id = entry_a.owner_user_id AND owner_a.status = 'active'
  JOIN users AS owner_b
    ON owner_b.id = entry_b.owner_user_id AND owner_b.status = 'active'
  WHERE awareness.recipient_user_id = ?
    AND entry_a.owner_user_id <> entry_b.owner_user_id
    AND (entry_a.owner_user_id = awareness.recipient_user_id
      OR entry_b.owner_user_id = awareness.recipient_user_id)`;

export async function listAwarenessEvents(
  env: Env,
  recipientUserId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<AwarenessEvent[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const unreadSql = options.unreadOnly ? " AND awareness.read_at IS NULL" : "";
  const result = await env.DB.prepare(
    `${VISIBLE_EVENT_SELECT}${unreadSql}
     ORDER BY awareness.created_at DESC, awareness.id DESC LIMIT ?`,
  ).bind(recipientUserId, limit).all<AwarenessRow>();
  return result.results.map(mapEvent);
}

async function getVisibleAwarenessEvent(
  env: Env,
  recipientUserId: string,
  eventId: string,
): Promise<AwarenessEvent | null> {
  const row = await env.DB.prepare(
    `${VISIBLE_EVENT_SELECT} AND awareness.id = ? LIMIT 1`,
  ).bind(recipientUserId, eventId).first<AwarenessRow>();
  return row ? mapEvent(row) : null;
}

/** Mark-read is recipient-only and visibility-checked at mutation and response. */
export async function markAwarenessEventRead(
  env: Env,
  recipientUserId: string,
  eventId: string,
  now = Date.now(),
): Promise<AwarenessEvent | null> {
  await env.DB.prepare(
    `UPDATE awareness_events AS awareness
     SET read_at = COALESCE(read_at, ?)
     WHERE awareness.id = ?
       AND awareness.recipient_user_id = ?
       AND EXISTS (
         SELECT 1
         FROM entries AS entry_a
         JOIN entries AS entry_b ON entry_b.id = awareness.entry_b_id
         JOIN users AS owner_a
           ON owner_a.id = entry_a.owner_user_id AND owner_a.status = 'active'
         JOIN users AS owner_b
           ON owner_b.id = entry_b.owner_user_id AND owner_b.status = 'active'
         WHERE entry_a.id = awareness.entry_a_id
           AND entry_a.visibility = 'public'
           AND entry_b.visibility = 'public'
           AND entry_a.owner_user_id <> entry_b.owner_user_id
           AND (entry_a.owner_user_id = awareness.recipient_user_id
             OR entry_b.owner_user_id = awareness.recipient_user_id)
       )`,
  ).bind(now, eventId, recipientUserId).run();

  return getVisibleAwarenessEvent(env, recipientUserId, eventId);
}
