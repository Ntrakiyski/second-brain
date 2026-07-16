/**
 * Ingest — Entry storage, dedup/merge writes, and vector lifecycle
 *
 * Input:    raw content, tags, source, owner user id
 * Output:   CaptureResult (blocked | stored | flagged | contradiction | merged | replaced)
 *           plus side-effects: D1 rows, Vectorize vectors, graph edges
 *
 * Logic:
 *   1. captureEntry — the main write path: deduplicate, merge/replace, or insert
 *   2. storeEntry — chunk + embed + insert vectors + persist vector_ids
 *   3. appendToEntry — incremental append (single vector or full re-embed)
 *   4. scheduleClassifyAndTag — async importance/kind classification after write
 *   5. reindexAllVectors — bulk migration helper to add ownership metadata
 */

import type { Env } from "./types";
import { chunkText, embed } from "./helpers";
import { CHUNK_MAX_CHARS } from "./config";
import { classifyEntry, extractHashtags } from "./classification";
import { checkDuplicateAndContradiction } from "./duplicates";
import { getStatus, withKind, withStatus } from "./tags";
import { createEdge, inferEdgesOnWrite, neighborsFromVectorQuery } from "./graph";
import { deprecateEntry } from "./lifecycle";

// ─── Store entry (full embed + chunk) ────────────────────────────────────────
// Returns the list of vector IDs inserted so forget() can clean up exactly.

// Build and upsert an entry's complete vector set without changing D1. Update
// paths use this staging primitive so a failed embed/write cannot destroy the
// last known-good content/vector references. Upsert is required because stable
// entry/chunk ids must replace prior vectors during edits and re-indexing.
export async function stageEntryVectors(
  env: Env,
  id: string,
  content: string,
  tags: string[],
  source: string,
  now: number,
  ownerUserId?: string,
  isPrivate?: boolean
): Promise<string[]> {
  const chunks = chunkText(content);

  const vectors = await Promise.all(
    chunks.map(async (chunk, i) => {
      const metadata: Record<string, any> = {
        content: chunk,
        parentId: id,
        chunkIndex: i,
        totalChunks: chunks.length,
        tags,
        source,
        created_at: now,
        owner_user_id: ownerUserId ?? "",
        is_private: isPrivate ?? false,
      };

      tags.forEach(t => {
        metadata[`tag_${t}`] = true;
      });

      return {
        id: chunks.length === 1 ? id : `${id}-chunk-${i}`,
        values: await embed(chunk, env),
        metadata,
      };
    })
  );

  await env.VECTORIZE.upsert(vectors);
  return vectors.map(v => v.id);
}

export async function storeEntry(
  env: Env,
  id: string,
  content: string,
  tags: string[],
  source: string,
  now: number,
  ownerUserId?: string,
  isPrivate?: boolean
): Promise<string[]> {
  const vectorIds = await stageEntryVectors(
    env, id, content, tags, source, now, ownerUserId, isPrivate,
  );

  // Persist exact vector IDs so forget() can clean up without guessing
  await env.DB.prepare(
    `UPDATE entries SET vector_ids = ? WHERE id = ?`
  ).bind(JSON.stringify(vectorIds), id).run();

  return vectorIds;
}

// Delete vectors that are no longer referenced after a re-embed. Ids reused by
// the new embedding must survive: single-chunk entries are keyed by the entry
// id, so the re-embedded vector reuses the old id. Deleting the full old set
// would remove the vector we just inserted, leaving the entry unsearchable.
export async function deleteStaleVectors(env: Env, oldIds: string[], newIds: string[]): Promise<void> {
  const stale = oldIds.filter(v => !newIds.includes(v));
  if (stale.length) await env.VECTORIZE.deleteByIds(stale);
}

// Re-index all vectors with ownership metadata. Called from POST /vectorize-pending?reindex=true
// or as a standalone migration step after adding owner_user_id/is_private to vector metadata.
export async function reindexAllVectors(env: Env): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Find all entries that have vectors
  const { results: entries } = await env.DB.prepare(
    `SELECT id, content, tags, source, created_at, vector_ids, owner_user_id FROM entries WHERE vector_ids != '[]'`
  ).all() as { results: Record<string, any>[] };

  for (const entry of entries) {
    const id = entry.id as string;
    const oldVectorIds: string[] = JSON.parse(entry.vector_ids as string ?? "[]");
    const tags: string[] = JSON.parse(entry.tags as string ?? "[]");
    const ownerUserId = (entry as any).owner_user_id as string ?? "";
    const isPrivate = tags.includes("private");

    try {
      // Upsert first so a failed re-embed leaves the last known-good vectors
      // intact. Delete only ids that the new chunk layout no longer references.
      const newVectorIds = await storeEntry(
        env, id, entry.content as string, tags, entry.source as string,
        entry.created_at as number, ownerUserId || undefined, isPrivate
      );
      await deleteStaleVectors(env, oldVectorIds, newVectorIds);
      processed++;
    } catch (e) {
      console.error(`Re-index failed for entry ${id} (non-fatal):`, e);
      failed++;
    }
  }

  return { processed, failed };
}

// ─── Snapshot helper ─────────────────────────────────────────────────────────
// Creates an entry_snapshots row (backup before destructive mutation).
// Reads content/tags/source from the entry, inserts snapshot, returns the ID.
// Fire-and-forget: caller should .catch() the returned promise.

export async function createSnapshot(env: Env, entryId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT content, tags, source FROM entries WHERE id = ?`).bind(entryId).first() as Record<string, any> | null;
  if (!row) return null;
  const snapshotId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO entry_snapshots (id, entry_id, content, tags, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(snapshotId, entryId, row.content, row.tags ?? "[]", row.source ?? "api", Date.now()).run();
  return snapshotId;
}

// ─── Append to existing entry ─────────────────────────────────────────────────
// For short appends (combined content ≤ CHUNK_MAX_CHARS): adds only the new
// addition as a single new Vectorize vector pointing to the parent ID.
// For large appends (combined content > CHUNK_MAX_CHARS): falls back to a full
// re-embed of the combined content using the same safe 3-step pattern as update
// (insert new → delete old), so Vectorize always holds properly chunked vectors.

export async function appendToEntry(
  env: Env,
  id: string,
  existingContent: string,
  addition: string,
  tags: string[],
  source: string,
  ownerUserId?: string,
  ctx?: ExecutionContext
): Promise<void> {
  // Snapshot: backup before destructive append — fire-and-forget (non-fatal)
  if (ctx) {
    ctx.waitUntil(createSnapshot(env, id).catch(e => console.error("Snapshot creation failed (non-fatal):", e)));
  }

  // Read existing vector_ids upfront — needed by both paths
  const row = await env.DB.prepare(
    `SELECT vector_ids FROM entries WHERE id = ?`
  ).bind(id).first() as Record<string, any> | null;

  const existingVectorIds: string[] = JSON.parse(row?.vector_ids ?? "[]");

  const timestamp = new Date().toLocaleDateString();
  const separator = `\n\n[Update ${timestamp}]: `;
  const newContent = existingContent + separator + addition;

  if (newContent.length > CHUNK_MAX_CHARS) {
    // ── Full re-embed path ───────────────────────────────────────────────────
    // Combined content is too large for a single vector — re-chunk everything.
    // Same safe ordering as update/merge/replace: insert new → delete old.

    // Step 1: Stage the new vector set. Failure leaves D1 and old vectors intact.
    const newVectorIds = await stageEntryVectors(
      env, id, newContent, tags, source, Date.now(), ownerUserId, tags.includes("private"),
    );

    // Step 2: Commit content + exact vector references together in D1.
    await env.DB.prepare(`UPDATE entries SET content = ?, vector_ids = ? WHERE id = ?`)
      .bind(newContent, JSON.stringify(newVectorIds), id).run();

    // Step 3: Delete only stale vectors — ids reused by the upsert must survive.
    try {
      await deleteStaleVectors(env, existingVectorIds, newVectorIds);
    } catch (e) {
      console.error("Old vector cleanup failed (non-fatal):", e);
    }

    // Auto-link the updated entry to similar neighbors (#16) — same inference as on capture.
    try {
      await inferEdgesOnWrite(id, await neighborsFromVectorQuery(await embed(addition, env), env, ownerUserId), env);
    } catch (e) {
      console.error("Append auto-link failed (non-fatal):", e);
    }

    return;
  }

  // ── Normal append-only path (combined content ≤ CHUNK_MAX_CHARS) ────────────
  // Timestamp-based suffix guarantees uniqueness across concurrent appends
  const newChunkId = `${id}-update-${Date.now()}`;

  const values = await embed(addition, env);

  const metadata: Record<string, any> = {
    content: addition,
    parentId: id,
    isUpdate: true,
    tags,
    source,
    created_at: Date.now(),
    owner_user_id: ownerUserId ?? "",
    is_private: tags.includes("private"),
  };

  tags.forEach(t => {
    metadata[`tag_${t}`] = true;
  });

  await env.VECTORIZE.insert([{
    id: newChunkId,
    values,
    metadata,
  }]);

  // Single UPDATE for both content and vector_ids — saves one D1 round trip
  await env.DB.prepare(
    `UPDATE entries SET content = ?, vector_ids = ? WHERE id = ?`
  ).bind(newContent, JSON.stringify([...existingVectorIds, newChunkId]), id).run();

  // Auto-link the updated entry to similar neighbors (#16) — reuse the addition embedding.
  try {
    await inferEdgesOnWrite(id, await neighborsFromVectorQuery(values, env, ownerUserId), env);
  } catch (e) {
    console.error("Append auto-link failed (non-fatal):", e);
  }
}

// ─── Shared write path ────────────────────────────────────────────────────────

// Classify an entry's content (importance + canonical + kind) and apply the tags,
// asynchronously. Used for both newly-inserted entries and smart-merge targets.
function scheduleClassifyAndTag(entryId: string, content: string, env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    classifyEntry(content, env)
      .then(async ({ importance, canonical, kind }) => {
        await env.DB.prepare(`UPDATE entries SET importance_score = ? WHERE id = ?`).bind(importance, entryId).run();
        if (!kind && !canonical) return;
        const row = await env.DB.prepare(`SELECT tags FROM entries WHERE id = ?`).bind(entryId).first() as Record<string, any> | null;
        if (!row) return;
        let tags: string[] = JSON.parse(row.tags ?? "[]");
        if (kind) tags = withKind(tags, kind);
        if (canonical && getStatus(tags) === null) tags = withStatus(tags, "canonical");
        await env.DB.prepare(`UPDATE entries SET tags = ? WHERE id = ?`).bind(JSON.stringify(tags), entryId).run();
      })
      .catch(e => console.error("Classification failed (non-fatal):", e))
  );
}

export type CaptureResult =
  | { status: "blocked"; matchId: string; score: number }
  | { status: "stored"; id: string; crossUserNote?: string }
  | { status: "flagged"; id: string; matchId: string; score: number; crossUserNote?: string }
  | { status: "contradiction"; id: string; resolvedConflict: string; reason?: string }
  | { status: "contradiction_protected"; id: string; canonicalId: string; reason?: string }
  | { status: "merged"; id: string }
  | { status: "replaced"; id: string };

export async function captureEntry(
  rawContent: string,
  tags: string[],
  source: string,
  env: Env,
  ctx: ExecutionContext,
  userId?: string
): Promise<CaptureResult> {
  const raw = rawContent.trim();
  const { cleanContent, hashtags } = extractHashtags(raw);
  const c = cleanContent || raw;
  const t = [...new Set([...tags.map(tag => tag.toLowerCase()), ...hashtags])];

  const { duplicate: dup, contradiction, mergeAction, neighbors, crossUserSimilar } = await checkDuplicateAndContradiction(c, env, userId);

  const crossUserNote = crossUserSimilar
    ? `Similar content exists in ${crossUserSimilar.ownerUsername}'s public memories`
    : undefined;

  if (dup.status === "blocked") {
    return { status: "blocked", matchId: dup.matchId, score: dup.score };
  }

  // ── Smart merge: replace/merge existing entry — no new entry inserted ────────
  if (dup.status === "flagged" && mergeAction && mergeAction.action !== "keep_both") {
    const targetId = mergeAction.target_id;
    const newContent = mergeAction.action === "merge" ? mergeAction.merged_content : c;

    const targetRow = await env.DB.prepare(
      `SELECT tags, source, vector_ids, importance_score, owner_user_id FROM entries WHERE id = ?`
    ).bind(targetId).first() as Record<string, any> | null;

    if (targetRow) {
      // Ownership check: don't overwrite another user's entry
      if (userId && targetRow.owner_user_id && targetRow.owner_user_id !== userId && targetRow.owner_user_id !== "") {
        return { status: "flagged", id: crypto.randomUUID(), matchId: targetId, score: dup.score };
      }

      const existingTags: string[] = JSON.parse(targetRow.tags ?? "[]");
      const existingSource = targetRow.source as string;
      const oldVectorIds: string[] = JSON.parse(targetRow.vector_ids ?? "[]");

      // Protect high-importance or canonical memories from being silently overwritten.
      // Score ≥ 4 means the existing entry is critical; canonical = confirmed authoritative.
      const targetStatus = getStatus(existingTags);
      if ((targetRow.importance_score as number) >= 4 || targetStatus === "canonical") {
        return { status: "flagged", id: crypto.randomUUID(), matchId: targetId, score: dup.score };
      }

      // Read old content once for episode + passages (before destructive merge)
      const oldContentRow = await env.DB.prepare(`SELECT content, tags, source FROM entries WHERE id = ?`).bind(targetId).first() as Record<string, any> | null;
      const oldContent = oldContentRow?.content as string ?? "";

      // Snapshot: backup before destructive merge — fire-and-forget (non-fatal)
      ctx.waitUntil(createSnapshot(env, targetId).catch(e => console.error("Snapshot creation failed (non-fatal):", e)));

      // Episode: preserve old content before merge overwrite — fire-and-forget (non-fatal)
      const mergeEpisodeId = crypto.randomUUID();
      if (oldContent) {
        ctx.waitUntil(
          env.DB.prepare(
            `INSERT INTO episodes (id, entry_id, content, content_type, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(mergeEpisodeId, targetId, oldContent, "text", existingSource, Date.now()).run()
            .catch(e => console.error("Episode creation failed (non-fatal):", e))
        );
      }

      // Passages for old content — fire-and-forget (non-fatal)
      if (oldContent) {
        ctx.waitUntil(
          createPassagesForEntry(targetId, mergeEpisodeId, oldContent, env, ctx, userId, existingTags.includes("private")).catch(e => console.error("Passage creation failed (non-fatal):", e))
        );
      }

      // Step 1: Stage new vectors. Failure leaves the target untouched.
      const targetOwnerId = targetRow.owner_user_id as string;
      const newVectorIds = await stageEntryVectors(
        env, targetId, newContent, existingTags, existingSource, Date.now(),
        targetOwnerId || undefined, existingTags.includes("private"),
      );

      // Step 2: Commit content and vector references together.
      await env.DB.prepare(`UPDATE entries SET content = ?, vector_ids = ? WHERE id = ?`)
        .bind(newContent, JSON.stringify(newVectorIds), targetId).run();

      // Step 3: Delete only stale vectors — ids reused by the re-embed must survive
      try {
        await deleteStaleVectors(env, oldVectorIds, newVectorIds);
      } catch (e) { console.error("Old vector cleanup failed (non-fatal):", e); }

      // Re-classify the merged/replaced content — updates importance_score + kind (and canonical if warranted) on the target.
      scheduleClassifyAndTag(targetId, newContent, env, ctx);

      return mergeAction.action === "merge"
        ? { status: "merged", id: targetId }
        : { status: "replaced", id: targetId };
    }
    // target not found in DB — fall through to normal insert
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const baseTags = contradiction.detected ? [...t, "contradiction-resolved"] : t;
  const finalTags = dup.status === "flagged" ? [...baseTags, "duplicate-candidate"] : baseTags;

  await env.DB.prepare(
    `INSERT INTO entries (id, content, tags, source, created_at, vector_ids, owner_user_id, valid_from, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, c, JSON.stringify(finalTags), source, now, "[]", userId ?? "", now, now).run();

  // Episode: immutable raw content ledger — fire-and-forget (non-fatal)
  const newEpisodeId = crypto.randomUUID();
  ctx.waitUntil(
    (async () => {
      try {
        await env.DB.prepare(
          `INSERT INTO episodes (id, entry_id, content, content_type, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newEpisodeId, id, c, "text", source, now).run();
      } catch (e) {
        console.error("Episode creation failed (non-fatal):", e);
      }
    })()
  );

  // Passages: chunk content for citation-level recall — fire-and-forget (non-fatal)
  ctx.waitUntil(
    createPassagesForEntry(id, newEpisodeId, c, env, ctx, userId, finalTags.includes("private")).catch(e => console.error("Passage creation failed (non-fatal):", e))
  );

  ctx.waitUntil(
    storeEntry(env, id, c, finalTags, source, now, userId, finalTags.includes("private"))
      .catch(e => console.error("Vectorize insert failed (non-fatal):", e))
  );

  scheduleClassifyAndTag(id, c, env, ctx);

  if (contradiction.detected && contradiction.conflicting_id) {
    const conflictId = contradiction.conflicting_id;
    const conflictRow = await env.DB.prepare(
      `SELECT tags FROM entries WHERE id = ?`
    ).bind(conflictId).first() as Record<string, any> | null;
    const conflictStatus = conflictRow ? getStatus(JSON.parse(conflictRow.tags ?? "[]")) : null;

    if (conflictStatus === "canonical") {
      // Don't overwrite a canonical memory — keep it, demote the new entry to draft.
      // Strip "contradiction-resolved" — that tag marks entries that WON a contradiction;
      // this entry lost, so it must not carry that tag.
      const draftTags = finalTags.filter(t => t !== "contradiction-resolved");
      await env.DB.prepare(`UPDATE entries SET tags = ? WHERE id = ?`)
        .bind(JSON.stringify(withStatus(draftTags, "draft")), id).run();
      // Record the outcome: canonical incumbent survived (win), new draft lost (loss).
      // Non-fatal — a failed count update must not abort capture.
      try {
        await env.DB.prepare(`UPDATE entries SET contradiction_wins = contradiction_wins + 1 WHERE id = ?`).bind(conflictId).run();
        await env.DB.prepare(`UPDATE entries SET contradiction_losses = contradiction_losses + 1 WHERE id = ?`).bind(id).run();
      } catch (e) {
        console.error("Contradiction count update failed (non-fatal):", e);
      }
      return { status: "contradiction_protected", id, canonicalId: conflictId, reason: contradiction.reason };
    }

    // Non-canonical loser: the new entry wins; the incumbent loses and is deprecated
    // (row kept for audit). Record the outcome before deprecating. Non-fatal.
    try {
      await env.DB.prepare(`UPDATE entries SET contradiction_wins = contradiction_wins + 1 WHERE id = ?`).bind(id).run();
      await env.DB.prepare(`UPDATE entries SET contradiction_losses = contradiction_losses + 1 WHERE id = ?`).bind(conflictId).run();
    } catch (e) {
      console.error("Contradiction count update failed (non-fatal):", e);
    }
    // Bitemporal: close the old entry's validity window (Ticket 05)
    try {
      await env.DB.prepare(`UPDATE entries SET valid_to = ? WHERE id = ?`).bind(Date.now(), conflictId).run();
    } catch (e) {
      console.error("Bitemporal valid_to update failed (non-fatal):", e);
    }
    try {
      await deprecateEntry(conflictId, env);
    } catch (e) {
      console.error("Contradiction deprecation failed (non-fatal):", e);
    }
    // Project the lifecycle into the graph: the new entry supersedes the deprecated
    // one (#16). Skip a redundant relates_to to the superseded node — the supersedes
    // edge already captures that relationship — but still auto-link other neighbors.
    try {
      await createEdge(id, conflictId, "supersedes", { provenance: "system", weight: 1.0 }, env);
    } catch (e) {
      console.error("Supersedes edge creation failed (non-fatal):", e);
    }
    ctx.waitUntil(inferEdgesOnWrite(id, neighbors.filter(n => n.id !== conflictId), env).catch(e => console.error("Edge inference failed (non-fatal):", e)));
    return { status: "contradiction", id, resolvedConflict: conflictId, reason: contradiction.reason };
  }

  // Reached here without contradiction handling (flagged-new-row or stored) — both
  // are genuinely new nodes, so auto-link to similar neighbors (#16).
  ctx.waitUntil(inferEdgesOnWrite(id, neighbors, env).catch(e => console.error("Edge inference failed (non-fatal):", e)));

  if (dup.status === "flagged") {
    return { status: "flagged", id, matchId: dup.matchId, score: dup.score, crossUserNote };
  }

  return { status: "stored", id, crossUserNote };
}

// ─── Passage creation (Ticket 07) ───────────────────────────────────────────
// Chunk content into passages for citation-level recall.

const PASSAGE_CHUNK_CHARS = 1500;  // ~512 tokens
const PASSAGE_OVERLAP_CHARS = 400; // ~128 tokens

function findParentSection(headers: { level: number; title: string; offset: number }[], currentIndex: number): string | null {
  const currentLevel = headers[currentIndex].level;
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (headers[i].level < currentLevel) return headers[i].title;
  }
  return null;
}

function chunkIntoPassages(content: string): { chunks: { text: string; section: string | null; startOffset: number; endOffset: number }[]; headers: { level: number; title: string; offset: number }[] } {
  const sections: { text: string; section: string | null; startOffset: number; endOffset: number }[] = [];
  // Split on markdown headers to detect sections
  const headerRegex = /^(#{1,4})\s+(.+)$/gm;
  const headers: { level: number; title: string; offset: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(content)) !== null) {
    headers.push({ level: m[1].length, title: m[2].trim(), offset: m.index });
  }

  // If no headers, treat entire content as one section
  if (headers.length === 0) {
    for (let i = 0; i < content.length; i += PASSAGE_CHUNK_CHARS - PASSAGE_OVERLAP_CHARS) {
      const end = Math.min(i + PASSAGE_CHUNK_CHARS, content.length);
      sections.push({ text: content.slice(i, end), section: null, startOffset: i, endOffset: end });
      if (end >= content.length) break;
    }
    return { chunks: sections, headers: [] };
  }

  // Chunk within each section
  for (let h = 0; h < headers.length; h++) {
    const start = headers[h].offset;
    const end = h + 1 < headers.length ? headers[h + 1].offset : content.length;
    const sectionText = content.slice(start, end);
    const sectionName = headers[h].title;

    for (let i = 0; i < sectionText.length; i += PASSAGE_CHUNK_CHARS - PASSAGE_OVERLAP_CHARS) {
      const chunkEnd = Math.min(i + PASSAGE_CHUNK_CHARS, sectionText.length);
      sections.push({
        text: sectionText.slice(i, chunkEnd),
        section: sectionName,
        startOffset: start + i,
        endOffset: start + chunkEnd,
      });
      if (chunkEnd >= sectionText.length) break;
    }
  }

  return { chunks: sections, headers };
}

export async function createPassagesForEntry(
  entryId: string,
  episodeId: string,
  content: string,
  env: Env,
  ctx: ExecutionContext,
  ownerUserId?: string,
  isPrivate?: boolean
): Promise<void> {
  const { chunks, headers } = chunkIntoPassages(content);
  const now = Date.now();

  // Create document hierarchy if content has headers (research content)
  let sectionMap = new Map<string, string>(); // section title -> section id
  if (headers.length > 0) {
    const docId = crypto.randomUUID();
    const title = headers[0]?.title ?? "Untitled Document";
    try {
      await env.DB.prepare(
        `INSERT INTO documents (id, title, source_url, content_type, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(docId, title, null, "research", now).run();

      // Create sections from headers
      for (let i = 0; i < headers.length; i++) {
        const sectionId = crypto.randomUUID();
        const parentTitle = findParentSection(headers, i);
        const parentSectionId = parentTitle ? sectionMap.get(parentTitle) ?? null : null;
        try {
          await env.DB.prepare(
            `INSERT INTO document_sections (id, document_id, parent_section_id, title, level, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(sectionId, docId, parentSectionId, headers[i].title, headers[i].level, i, now).run();
          sectionMap.set(headers[i].title, sectionId);
        } catch (e) {
          console.error("Document section insert failed (non-fatal):", e);
        }
      }
    } catch (e) {
      console.error("Document insert failed (non-fatal):", e);
    }
  }

  for (const chunk of chunks) {
    const passageId = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO passages (id, entry_id, episode_id, content, section, start_offset, end_offset, vector_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(passageId, entryId, episodeId, chunk.text, chunk.section, chunk.startOffset, chunk.endOffset, "[]", now).run();
    } catch (e) {
      console.error("Passage insert failed (non-fatal):", e);
      continue;
    }

    // Vectorize passage — fire-and-forget
    ctx.waitUntil(
      (async () => {
        try {
          const values = await embed(chunk.text, env);
          const vectorId = `passage-${passageId}`;
          await env.VECTORIZE.insert([{ id: vectorId, values, metadata: { content: chunk.text, passageId, entryId, parentId: entryId, section: chunk.section ?? "", source: "passage", owner_user_id: ownerUserId ?? "", is_private: isPrivate ?? false } }]);
          await env.DB.prepare(`UPDATE passages SET vector_ids = ? WHERE id = ?`).bind(JSON.stringify([vectorId]), passageId).run();
        } catch (e) {
          console.error("Passage vectorize failed (non-fatal):", e);
        }
      })()
    );
  }
}
