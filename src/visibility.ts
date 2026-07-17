/** Governed entry visibility transitions with fail-closed vector synchronization. */

import type { Env } from "./types";
import { VECTORIZE_GET_BY_IDS_BATCH } from "./config";

export type EntryVisibility = "private" | "public";

export class VisibilityTransitionError extends Error {
  constructor(
    readonly code: "not_found" | "not_owner" | "invalid_state" | "vector_sync_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VisibilityTransitionError";
  }
}

interface VisibilityEntryRow {
  id: string;
  owner_user_id: string;
  visibility: string;
  tags: string;
  vector_ids: string;
  current_episode_id: string | null;
  vector_sync_pending: number;
  revision: number;
}

function parseStringArray(raw: unknown, field: string): string[] {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
      throw new Error(`${field} is not a string array`);
    }
    return value;
  } catch (cause) {
    throw new VisibilityTransitionError("invalid_state", `Entry ${field} is malformed`, cause);
  }
}

function projectVisibilityTag(tags: string[], visibility: EntryVisibility): string[] {
  const projected = [...new Set(tags.filter(tag => tag !== "private"))];
  if (visibility === "private") projected.push("private");
  return projected;
}

async function currentVectorIds(row: VisibilityEntryRow, env: Env): Promise<string[]> {
  const ids = parseStringArray(row.vector_ids, "vector_ids");
  const passageQuery = row.current_episode_id
    ? env.DB.prepare(
        `SELECT vector_ids FROM passages WHERE entry_id = ? AND episode_id = ?`,
      ).bind(row.id, row.current_episode_id)
    : env.DB.prepare(
        `SELECT vector_ids FROM passages WHERE entry_id = ?`,
      ).bind(row.id);
  const { results } = await passageQuery.all<{ vector_ids: string }>();
  for (const passage of results) {
    ids.push(...parseStringArray(passage.vector_ids, "passage vector_ids"));
  }
  return [...new Set(ids.filter(id => typeof id === "string" && id.length > 0))];
}

async function synchronizeVectorVisibility(
  row: VisibilityEntryRow,
  visibility: EntryVisibility,
  env: Env,
): Promise<void> {
  const ids = await currentVectorIds(row, env);
  if (!ids.length) return;

  try {
    for (let offset = 0; offset < ids.length; offset += VECTORIZE_GET_BY_IDS_BATCH) {
      const batchIds = ids.slice(offset, offset + VECTORIZE_GET_BY_IDS_BATCH);
      const vectors = await env.VECTORIZE.getByIds(batchIds);
      const byId = new Map(vectors.map(vector => [vector.id, vector]));
      if (batchIds.some(id => !byId.has(id))) {
        throw new Error("One or more authoritative vectors are missing");
      }
      await env.VECTORIZE.upsert(batchIds.map(id => {
        const vector = byId.get(id)!;
        return {
          id: vector.id,
          values: vector.values,
          metadata: {
            ...(vector.metadata ?? {}),
            owner_user_id: row.owner_user_id,
            is_private: visibility === "private",
          },
        };
      }));
    }
  } catch (cause) {
    throw new VisibilityTransitionError(
      "vector_sync_failed",
      "Entry remains fail-closed while vector visibility synchronization is retried",
      cause,
    );
  }
}

function invalidateRelationshipStatements(
  entryId: string,
  actorUserId: string,
  now: number,
  env: Env,
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `DELETE FROM edges WHERE source_id = ? OR target_id = ?`,
    ).bind(entryId, entryId),
    env.DB.prepare(
      `UPDATE edge_proposals
       SET status = 'rejected', resolved_at = ?, resolved_by = ?
       WHERE status = 'pending' AND (source_id = ? OR target_id = ?)`,
    ).bind(now, actorUserId, entryId, entryId),
    env.DB.prepare(
      `UPDATE action_proposals
       SET status = 'stale', stale_at = ?, updated_at = ?,
           error_code = 'visibility_changed',
           error_message = 'Target visibility changed before execution'
       WHERE status IN ('pending', 'executing')
         AND CASE
           WHEN json_valid(target_ids) THEN EXISTS (
             SELECT 1 FROM json_each(action_proposals.target_ids)
             WHERE json_each.value = ?
           )
           ELSE 0
         END`,
    ).bind(now, now, entryId),
  ];
}

function visibilitySnapshotStatement(
  entryId: string,
  actorUserId: string,
  expectedRevision: number,
  expectedVisibility: EntryVisibility,
  now: number,
  env: Env,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO entry_snapshots (
       id, entry_id, content, tags, source, created_at, episode_id,
       mutation_id, mutation_kind, recorded_at, valid_from, valid_to,
       epistemic_status, revision, visibility
     )
     SELECT ?, id, content, tags, source, ?, current_episode_id,
            ?, 'visibility', recorded_at, valid_from, valid_to,
            epistemic_status, revision, visibility
     FROM entries
     WHERE id = ? AND owner_user_id = ? AND revision = ? AND visibility = ?`,
  ).bind(
    crypto.randomUUID(),
    now,
    crypto.randomUUID(),
    entryId,
    actorUserId,
    expectedRevision,
    expectedVisibility,
  );
}

export interface VisibilityTransitionResult {
  entryId: string;
  visibility: EntryVisibility;
  changed: boolean;
  vectorSyncPending: boolean;
}

/**
 * Change an owned entry's visibility without creating an authorization gap.
 *
 * Public -> private commits D1 first, so candidate vectors can never grant
 * access while their metadata is being rewritten. Private -> public rewrites
 * vectors first while D1 still denies team access, then publishes atomically.
 */
export async function setEntryVisibility(
  entryId: string,
  actorUserId: string,
  target: EntryVisibility,
  env: Env,
): Promise<VisibilityTransitionResult> {
  if (!entryId || !actorUserId || (target !== "private" && target !== "public")) {
    throw new VisibilityTransitionError("invalid_state", "Invalid visibility transition input");
  }

  let row = await env.DB.prepare(
    `SELECT id, owner_user_id, visibility, tags, vector_ids,
            current_episode_id, vector_sync_pending, revision
     FROM entries WHERE id = ?`,
  ).bind(entryId).first<VisibilityEntryRow>();
  if (!row) throw new VisibilityTransitionError("not_found", "Memory not found");
  if (row.owner_user_id !== actorUserId) {
    throw new VisibilityTransitionError("not_owner", "Only the owner can change visibility");
  }
  if (row.visibility !== "private" && row.visibility !== "public") {
    throw new VisibilityTransitionError("invalid_state", "Entry visibility is malformed");
  }

  const tags = parseStringArray(row.tags, "tags");
  const projectedTags = JSON.stringify(projectVisibilityTag(tags, target));
  const alreadyTarget = row.visibility === target;
  if (alreadyTarget && Number(row.vector_sync_pending) === 0 && row.tags === projectedTags) {
    return { entryId, visibility: target, changed: false, vectorSyncPending: false };
  }

  const now = Date.now();
  if (target === "private" && !alreadyTarget) {
    const [, privatized] = await env.DB.batch([
      visibilitySnapshotStatement(
        entryId,
        actorUserId,
        row.revision,
        "public",
        now,
        env,
      ),
      env.DB.prepare(
        `UPDATE entries
         SET visibility = 'private', tags = ?, vector_sync_pending = 1,
             revision = revision + 1, recorded_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND visibility = 'public'
           AND revision = ?`,
      ).bind(projectedTags, now, now, entryId, actorUserId, row.revision),
      ...invalidateRelationshipStatements(entryId, actorUserId, now, env),
    ]);
    if ((privatized.meta.changes ?? 0) !== 1) {
      throw new VisibilityTransitionError("invalid_state", "Visibility changed concurrently");
    }
    row = {
      ...row,
      visibility: "private",
      tags: projectedTags,
      vector_sync_pending: 1,
      revision: row.revision + 1,
    };
  } else if (target === "public" && !alreadyTarget) {
    const pending = await env.DB.prepare(
      `UPDATE entries SET vector_sync_pending = 1, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND visibility = 'private'`,
    ).bind(now, entryId, actorUserId).run();
    if ((pending.meta.changes ?? 0) !== 1) {
      throw new VisibilityTransitionError("invalid_state", "Visibility changed concurrently");
    }
    row = { ...row, vector_sync_pending: 1 };
  } else if (Number(row.vector_sync_pending) === 0) {
    const pending = await env.DB.prepare(
      `UPDATE entries SET vector_sync_pending = 1, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND visibility = ? AND revision = ?`,
    ).bind(now, entryId, actorUserId, target, row.revision).run();
    if ((pending.meta.changes ?? 0) !== 1) {
      throw new VisibilityTransitionError("invalid_state", "Visibility changed concurrently");
    }
    row = { ...row, vector_sync_pending: 1 };
  }

  await synchronizeVectorVisibility(row, target, env);

  const transitionRecordedAt = Date.now();
  const needsFinalSnapshot = !alreadyTarget || row.tags !== projectedTags;
  const finalStatements: D1PreparedStatement[] = [];
  if (needsFinalSnapshot && !(target === "private" && !alreadyTarget)) {
    finalStatements.push(visibilitySnapshotStatement(
      entryId,
      actorUserId,
      row.revision,
      row.visibility as EntryVisibility,
      transitionRecordedAt,
      env,
    ));
  }
  const updateIndex = finalStatements.length;
  finalStatements.push(env.DB.prepare(
      `UPDATE entries
       SET visibility = ?, tags = ?, vector_sync_pending = 0,
           revision = revision + ?,
           recorded_at = CASE WHEN ? = 1 THEN ? ELSE recorded_at END,
           updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND vector_sync_pending = 1
         AND visibility = ? AND revision = ?`,
    ).bind(
      target,
      projectedTags,
      needsFinalSnapshot && !(target === "private" && !alreadyTarget) ? 1 : 0,
      needsFinalSnapshot && !(target === "private" && !alreadyTarget) ? 1 : 0,
      transitionRecordedAt,
      transitionRecordedAt,
      entryId,
      actorUserId,
      row.visibility,
      row.revision,
    ));
  if (target === "public" && !alreadyTarget) {
    finalStatements.push(...invalidateRelationshipStatements(entryId, actorUserId, now, env));
  }
  const finalResults = await env.DB.batch(finalStatements);
  const updated = finalResults[updateIndex];
  if ((updated.meta.changes ?? 0) !== 1) {
    throw new VisibilityTransitionError("invalid_state", "Visibility changed concurrently");
  }

  return { entryId, visibility: target, changed: !alreadyTarget, vectorSyncPending: false };
}
