/**
 * Explicit retention reinforcement.
 *
 * Recall is deliberately read-only. This command is the only direct path that
 * records a human owner's explicit signal that a memory should remain salient.
 * Each invocation is one reinforcement; callers must not retry automatically.
 * Derived ranking metadata changes in place and does not create a knowledge
 * episode or snapshot.
 */

import type { Env } from "./types";

export interface ReinforcementState {
  entryId: string;
  recallCount: number;
  lastRecalledAt: number;
  retentionScore: number;
}

interface ReinforcementRow {
  id: string;
  recall_count: number;
  last_recalled_at: number;
  retention_score: number;
}

export async function reinforceOwnedEntry(
  entryId: string,
  ownerUserId: string,
  env: Env,
  now = Date.now(),
): Promise<ReinforcementState | null> {
  const id = entryId.trim();
  const ownerId = ownerUserId.trim();
  if (!id || !ownerId || !Number.isSafeInteger(now) || now < 0) return null;

  const row = await env.DB.prepare(
    `UPDATE entries
     SET recall_count = COALESCE(recall_count, 0) + 1,
         last_recalled_at = ?,
         retention_score = 1.0
     WHERE id = ? AND owner_user_id = ?
     RETURNING id, recall_count, last_recalled_at, retention_score`,
  ).bind(now, id, ownerId).first<ReinforcementRow>();

  if (!row) return null;
  return {
    entryId: row.id,
    recallCount: Number(row.recall_count),
    lastRecalledAt: Number(row.last_recalled_at),
    retentionScore: Number(row.retention_score),
  };
}
