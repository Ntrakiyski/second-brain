/**
 * lifecycle.ts — Memory lifecycle management and compression.
 *
 * Purpose: Provide memory status transitions (deprecation, archival) and
 *   async pattern synthesis, insight generation, digest compression, and
 *   nightly graph maintenance — the "background brain" that keeps entries
 *   organized and the relationship graph healthy.
 *
 * Input:   Entry IDs, user queries, tag names, and Cloudflare Env bindings.
 * Output:  ForgetResult, status booleans, synthesized text, graph mutations.
 * Logic:   LLM-powered synthesis (insights, patterns, digests), tag-scoped
 *   compression with eligibility guards, and a bounded nightly graph pass
 *   that prunes weak inferred edges and backfills unlinked entries.
 */

import type { Env } from "./types";
import { readStreamText, escapeLikePattern, embed } from "./helpers";
import {
  LLM_MODEL,
  DIGEST_MAX_TOKENS,
  INSIGHT_MAX_TOKENS,
  PATTERN_MAX_TOKENS,
  COMPRESSION_MIN_AGE_MS,
  compressionEligibilitySql,
} from "./config";
import { STATUS_PREFIX, KIND_PREFIX, type MemoryStatus } from "./types";
import { withStatus } from "./tags";
import { initializeDatabase } from "./db";
import { captureEntry, createSnapshot } from "./ingest";
import { inferEdgesOnWrite } from "./graph";
import { queryVisibleVectors, vectorMatchParentId } from "./vector-access";

// ─── Synthesize insight from retrieved memories ───────────────────────────────

export async function synthesizeInsight(
  query: string,
  rows: { id: string; content: string }[],
  env: Env
): Promise<string> {
  if (!rows.length) return "";

  const memoriesList = rows
    .map((r, i) => `[${i + 1}] ID: ${r.id}\n${r.content}`)
    .join("\n\n");

  const prompt = `You are a second brain assistant. Summarize what the user's stored memories below say in relation to their query. Base the insight ONLY on these memories.

Query: "${query}"

Memories:
${memoriesList}

Rules:
- Use ONLY the information in the memories above. Do not add, infer, guess, or speculate, and do not use hedging language like "might" or "it seems".
- These memories are a retrieved subset, not the user's full memory store. Never say that information is missing, unavailable, or does not exist.
- If the memories don't address the query, briefly state only what they do contain.

Write a brief insight (2-4 sentences).`;

  let insight = "";
  try {
    const stream = await (env.AI as any).run(LLM_MODEL as any, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: INSIGHT_MAX_TOKENS,
      stream: true,
    });
    insight = await readStreamText(stream as ReadableStream);
  } catch (e) {
    console.error("synthesizeInsight LLM call failed (non-fatal):", e);
  }

  return insight.trim();
}

// ─── Async pattern derivation ─────────────────────────────────────────────────

export async function derivePattern(
  rows: { id: string; content: string }[],
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (rows.length < 10) return;

  // At most one auto-pattern per 48h to prevent spam across repeated recalls
  const recentPattern = await env.DB.prepare(
    `SELECT id FROM entries WHERE tags LIKE '%"auto-pattern"%' AND created_at > ? LIMIT 1`
  ).bind(Date.now() - 172800000).first();
  if (recentPattern) return;

  const sample = rows.slice(0, 20);
  const memoriesList = sample
    .map((r, i) => `[${i + 1}] ${r.content.slice(0, 300)}`)
    .join("\n\n");

  const prompt = `You are analyzing stored memories to find genuine recurring themes.

Memories:
${memoriesList}

Find a pattern that appears across 3 or more of these memories — a real tendency, preference, or recurring theme about this person. Do NOT summarize individual memories. Do NOT describe any single event.

If you find a genuine cross-memory pattern, respond with exactly ONE sentence starting with exactly one of: "You tend to", "There's a recurring", or "Across your memories".

If no genuine pattern exists across 3+ memories, respond with exactly: NONE`;

  try {
    const response = await (env.AI as any).run(LLM_MODEL as any, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: PATTERN_MAX_TOKENS,
    }) as any;

    const trimmed = (
      response?.choices?.[0]?.message?.content ??
      response?.response ??
      ""
    ).trim();

    if (!trimmed || trimmed === "NONE") return;

    const validStarters = ["You tend to", "There's a recurring", "Across your memories"];
    if (!validStarters.some(s => trimmed.startsWith(s))) return;

    await captureEntry(trimmed, ["auto-pattern"], "system", env, ctx);
  } catch (e) {
    console.error("derivePattern failed (non-fatal):", String(e));
  }
}

// ─── Semantic compression ─────────────────────────────────────────────────────

export async function synthesizeDigest(
  tag: string,
  rows: { id: string; content: string }[],
  env: Env
): Promise<string> {
  if (!rows.length) return "";

  const memoriesList = rows
    .map((r, i) => `[${i + 1}] ${r.content.slice(0, 400)}`)
    .join("\n\n");

  const prompt = `You are a second brain assistant. Based on these stored memories tagged "${tag}", write a single cohesive paragraph describing the current state of this area — what has been done, decided, and is being worked toward. Write as one flowing paragraph, not a list.

Memories:
${memoriesList}

State of "${tag}":`;

  let digest = "";
  try {
    const stream = await (env.AI as any).run(LLM_MODEL as any, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: DIGEST_MAX_TOKENS,
      stream: true,
    });
    digest = await readStreamText(stream as ReadableStream);
  } catch (e) {
    console.error("synthesizeDigest LLM call failed (non-fatal):", e);
  }

  return digest.trim();
}

type CompressionSource = {
  id: string;
  content: string;
  tags: string[];
  ownerUserId: string;
};

function parseEntryTags(raw: unknown): string[] | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || !parsed.every(tag => typeof tag === "string")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function authorizeCompressionSources(
  rawEntries: Record<string, unknown>[],
  tag: string,
  env: Env,
  userId?: string,
): Promise<CompressionSource[]> {
  const sources: CompressionSource[] = [];

  for (const rawEntry of rawEntries) {
    const id = typeof rawEntry.id === "string" ? rawEntry.id : "";
    const content = typeof rawEntry.content === "string" ? rawEntry.content : "";
    if (!id || !content) continue;

    // Re-authorize each row immediately before synthesis/mutation. Besides
    // defending against stale or imperfect query filters, this makes malformed
    // tag metadata fail closed instead of being treated as public.
    const metadata = await env.DB.prepare(
      `SELECT tags, owner_user_id FROM entries WHERE id = ?`
    ).bind(id).first<{ tags: string; owner_user_id: string }>();
    if (!metadata) continue;

    const tags = parseEntryTags(metadata.tags);
    if (!tags) continue;
    if (!tags.includes(tag)) continue;
    if (tags.some(candidate =>
      candidate === "synthesized" ||
      candidate === "auto-pattern" ||
      candidate === "rolled-up"
    )) continue;

    const ownerUserId = typeof metadata.owner_user_id === "string"
      ? metadata.owner_user_id
      : "";
    if (userId && ownerUserId !== userId) continue;

    sources.push({ id, content, tags, ownerUserId });
  }

  return sources;
}

export async function compressTag(
  tag: string,
  env: Env,
  ctx: ExecutionContext,
  userId?: string
): Promise<{ synthesizedId: string | null; entriesUsed: number; text: string }> {
  // Reserved/namespaced tags (kind:*, status:*) describe a memory's type/lifecycle,
  // not a topic — digesting them would blend unrelated memories (and could compress
  // protected/canonical ones). Never compress by them. This also guards /digest and
  // the web UI Compress button, not just the nightly cron.
  if (tag.startsWith(STATUS_PREFIX) || tag.startsWith(KIND_PREFIX)) {
    return { synthesizedId: null, entriesUsed: 0, text: "" };
  }

  const recentSynthSql = `
    SELECT id FROM entries
    WHERE ${userId ? "owner_user_id = ? AND" : ""} tags LIKE '%"synthesized"%'
      AND tags LIKE ?
      AND created_at > ?
    LIMIT 1
  `;
  const recentSynthBindings = userId
    ? [userId, `%"${escapeLikePattern(tag)}"%`, Date.now() - 86400000]
    : [`%"${escapeLikePattern(tag)}"%`, Date.now() - 86400000];
  const recentSynth = await env.DB.prepare(recentSynthSql)
    .bind(...recentSynthBindings).first();

  if (recentSynth) {
    return { synthesizedId: null, entriesUsed: 0, text: "" };
  }

  // Fetch compressible entries: tagged with this tag, not system-tagged, not high-importance
  const eligibilitySql = compressionEligibilitySql("", userId);
  const bindValues = userId
    ? [`%"${escapeLikePattern(tag)}"%`, Date.now() - COMPRESSION_MIN_AGE_MS, userId]
    : [`%"${escapeLikePattern(tag)}"%`, Date.now() - COMPRESSION_MIN_AGE_MS];
  const { results: rawEntries } = await env.DB.prepare(`
    SELECT id, content FROM entries
    WHERE tags LIKE ?
      AND tags NOT LIKE '%"synthesized"%'
      AND tags NOT LIKE '%"auto-pattern"%'
      AND tags NOT LIKE '%"rolled-up"%'
      AND ${eligibilitySql}
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(...bindValues).all();

  const rows = await authorizeCompressionSources(
    rawEntries as Record<string, unknown>[], tag, env, userId,
  );
  if (rows.length < 10) {
    return { synthesizedId: null, entriesUsed: 0, text: "" };
  }

  const text = await synthesizeDigest(tag, rows, env);
  if (!text) return { synthesizedId: null, entriesUsed: 0, text: "" };

  const content = `[Synthesized from ${rows.length} entries tagged "${tag}"]\n\n${text}`;
  // A digest that incorporates any private source must itself remain private.
  // Public-only source sets remain public, matching their source visibility.
  const digestTags = [
    "synthesized",
    tag,
    ...(rows.some(row => row.tags.includes("private")) ? ["private"] : []),
  ];
  const result = await captureEntry(content, digestTags, "system", env, ctx, userId);

  if (result.status !== "stored") {
    return { synthesizedId: null, entriesUsed: 0, text };
  }

  for (const id of rows.map(row => row.id)) {
    // Snapshot: backup before compression — fire-and-forget (non-fatal)
    createSnapshot(env, id).catch(e => console.error(`Snapshot creation failed for ${id} (non-fatal):`, e));
    try {
      const ownerGuard = userId ? " AND owner_user_id = ?" : "";
      await env.DB.prepare(
        `UPDATE entries SET tags = json_insert(tags, '$[#]', 'rolled-up'), content = content || ? WHERE id = ?${ownerGuard}`
      ).bind(`\n\n[Digest: ${result.id}]`, id, ...(userId ? [userId] : [])).run();
    } catch (e) {
      console.error(`Failed to update source entry ${id} (non-fatal):`, e);
    }
  }

  return { synthesizedId: result.id, entriesUsed: rows.length, text };
}

export async function runNightlyCompression(env: Env, ctx: ExecutionContext): Promise<void> {
  await initializeDatabase(env);

  // Get all active users for per-user compression
  const { results: users } = await env.DB.prepare(
    `SELECT id FROM users WHERE status = 'active'`
  ).all<{ id: string }>();

  // If no users table or no users, fall back to system-user-only compression
  const userIds = users.length > 0 ? users.map((u: any) => u.id) : [""];

  for (const userId of userIds) {
    const { results } = await env.DB.prepare(`
      SELECT value as tag, COUNT(*) as count
      FROM entries, json_each(entries.tags)
      WHERE value NOT IN ('synthesized', 'auto-pattern', 'duplicate-candidate', 'contradiction-resolved', 'rolled-up')
        AND value NOT LIKE 'status:%'
        AND value NOT LIKE 'kind:%'
        AND entries.tags NOT LIKE '%"rolled-up"%'
        AND entries.tags NOT LIKE '%"synthesized"%'
        AND entries.tags NOT LIKE '%"auto-pattern"%'
        AND ${compressionEligibilitySql("entries.", userId || undefined)}
      GROUP BY value
      HAVING count > 10
      ORDER BY count DESC
    `).bind(Date.now() - COMPRESSION_MIN_AGE_MS, ...(userId ? [userId] : [])).all();

    for (const row of results) {
      const tag = row.tag as string;
      try {
        await compressTag(tag, env, ctx, userId || undefined);
      } catch (e) {
        console.error(`Compression failed for tag "${tag}" user "${userId}" (non-fatal):`, e);
      }
    }
  }

  // Staleness detection pass (Ticket 06)
  try {
    await detectStaleness(env);
  } catch (e) {
    console.error("Staleness detection failed (non-fatal):", e);
  }
}

// ─── Staleness detection (Ticket 06) ────────────────────────────────────────
// Marks entries as stale when: valid_to is set, incoming edge confidence < 0.5,
// or age > STALENESS_THRESHOLD_DAYS with no recalls. Runs nightly.
export async function detectStaleness(env: Env): Promise<void> {
  const now = Date.now();
  const { STALENESS_THRESHOLD_DAYS, STALENESS_CONFIDENCE_THRESHOLD } = await import("./config");

  // 1. Entries with valid_to set (superseded by contradicting evidence)
  try {
    const { meta } = await env.DB.prepare(
      `UPDATE entries SET epistemic_status = 'stale' WHERE valid_to IS NOT NULL AND epistemic_status != 'stale'`
    ).run();
    if (meta?.changes) console.log(`Staleness: ${meta.changes} entries marked stale (valid_to set)`);
  } catch (e) { console.error("Staleness check (valid_to) failed (non-fatal):", e); }

  // 2. Entries with low-confidence incoming edges
  try {
    const { meta } = await env.DB.prepare(
      `UPDATE entries SET epistemic_status = 'stale' WHERE id IN (
        SELECT DISTINCT target_id FROM edges WHERE confidence < ? AND confidence > 0
      ) AND epistemic_status != 'stale'`
    ).bind(STALENESS_CONFIDENCE_THRESHOLD).run();
    if (meta?.changes) console.log(`Staleness: ${meta.changes} entries marked stale (low confidence)`);
  } catch (e) { console.error("Staleness check (confidence) failed (non-fatal):", e); }

  // 3. Old entries with no recalls
  try {
    const cutoff = now - STALENESS_THRESHOLD_DAYS * 86400000;
    const { meta } = await env.DB.prepare(
      `UPDATE entries SET epistemic_status = 'stale' WHERE created_at < ? AND recall_count = 0 AND epistemic_status != 'stale'`
    ).bind(cutoff).run();
    if (meta?.changes) console.log(`Staleness: ${meta.changes} entries marked stale (age > ${STALENESS_THRESHOLD_DAYS}d, no recall)`);
  } catch (e) { console.error("Staleness check (age) failed (non-fatal):", e); }
}

// ─── Nightly graph maintenance (issue #16) ──────────────────────────────────────
// Bounded, idempotent background pass that keeps the relationship graph healthy:
// prunes weak stale auto-edges, then backfills links for still-unlinked entries so
// memories created before linking existed gradually join the graph. Runs on the same
// daily cron as compression — no new/extra trigger. (A future fast-follow can add an
// LLM step that promotes generic relates_to edges to specific types from EDGE_TYPES.)
const GRAPH_PASS_BACKFILL_LIMIT = 25;          // unlinked entries to link per run
const EDGE_PRUNE_WEIGHT = 0.3;                 // inferred edges weaker than this are prune candidates…
const EDGE_PRUNE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // …once they're at least a week old

export async function runGraphPass(env: Env, ctx: ExecutionContext): Promise<void> {
  await initializeDatabase(env);

  // (1) Prune weak, old, INFERRED edges only — explicit (user) and system (lifecycle)
  // edges are never auto-removed. That's exactly what `provenance` is for.
  try {
    await env.DB.prepare(
      `DELETE FROM edges WHERE provenance = 'inferred' AND weight < ? AND updated_at < ?`
    ).bind(EDGE_PRUNE_WEIGHT, Date.now() - EDGE_PRUNE_MIN_AGE_MS).run();
  } catch (e) {
    console.error("Graph prune failed (non-fatal):", e);
  }

  // (2) Backfill: find a bounded batch of entries with no edges yet and link each to
  // its nearest neighbors (same logic as on-write inference). Empty edges table →
  // every entry is unlinked → the graph fills in over successive nightly runs.
  let unlinked: { id: string; content: string; owner_user_id: string; tags: string }[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, content, owner_user_id, tags FROM entries
       WHERE id NOT IN (SELECT source_id FROM edges) AND id NOT IN (SELECT target_id FROM edges)
         AND tags NOT LIKE '%"status:deprecated"%'
       ORDER BY created_at DESC LIMIT ${GRAPH_PASS_BACKFILL_LIMIT}`
    ).all() as { results: { id: string; content: string; owner_user_id: string; tags: string }[] };
    unlinked = results;
  } catch (e) {
    console.error("Graph backfill query failed (non-fatal):", e);
  }

  for (const entry of unlinked) {
    try {
      const entryTags = parseEntryTags(entry.tags);
      if (!entryTags) continue;

      const isPrivate = entryTags.includes("private");
      const entryOwner = typeof entry.owner_user_id === "string"
        ? entry.owner_user_id
        : "";
      // A private entry without an authoritative owner cannot be partitioned
      // safely, so it must not participate in automatic graph inference.
      if (isPrivate && !entryOwner) continue;

      const values = await embed(entry.content, env);
      const { matches, entriesById } = await queryVisibleVectors(values, env, {
        topK: 5,
        ...(isPrivate ? { userId: entryOwner } : {}),
      });
      const scores = new Map<string, number>();
      for (const match of matches) {
        const parentId = vectorMatchParentId(match);
        if (parentId === entry.id) continue;

        // Enforce the graph partition from authoritative D1 metadata, never
        // from Vectorize payloads: private↔same-owner-private; public↔public.
        const candidate = entriesById.get(parentId);
        if (!candidate) continue;
        const candidateIsPrivate = candidate.tags.includes("private");
        if (isPrivate) {
          if (!candidateIsPrivate || candidate.ownerUserId !== entryOwner) continue;
        } else if (candidateIsPrivate) {
          continue;
        }

        scores.set(parentId, Math.max(scores.get(parentId) ?? 0, match.score));
      }
      const neighbors = [...scores.entries()].map(([id, score]) => ({ id, score }));

      await inferEdgesOnWrite(entry.id, neighbors, env);
    } catch (e) {
      console.error(`Graph backfill failed for ${entry.id} (non-fatal):`, e);
    }
  }
}

// ─── Shared delete path ───────────────────────────────────────────────────────
// Used by both the `forget` MCP tool and POST /forget so the cleanup logic
// (D1 row + tracked Vectorize IDs) lives in exactly one place.

export type ForgetResult =
  | { status: "not_found" }
  | { status: "deleted"; vectorCount: number };

function parseTrackedVectorIds(raw: unknown, scope: string): string[] {
  if (raw == null) return [];

  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error(`Cannot forget entry: malformed vector_ids for ${scope}`);
  }

  if (
    !Array.isArray(parsed) ||
    !parsed.every((vectorId) => typeof vectorId === "string" && vectorId.length > 0)
  ) {
    throw new Error(`Cannot forget entry: malformed vector_ids for ${scope}`);
  }

  return parsed;
}

export async function forgetEntry(id: string, env: Env): Promise<ForgetResult> {
  const row = await env.DB.prepare(
    `SELECT vector_ids FROM entries WHERE id = ?`
  ).bind(id).first() as Record<string, any> | null;

  if (!row) return { status: "not_found" };

  const { results: passages } = await env.DB.prepare(
    `SELECT id, vector_ids FROM passages WHERE entry_id = ?`
  ).bind(id).all<{ id: string; vector_ids: string }>();

  // Validate every tracking record before mutating either store. Continuing with
  // malformed metadata could orphan vectors whose IDs can no longer be recovered.
  const vectorIds = [...new Set([
    ...parseTrackedVectorIds(row.vector_ids, `entry ${id}`),
    ...passages.flatMap((passage) =>
      parseTrackedVectorIds(passage.vector_ids, `passage ${passage.id}`)
    ),
  ])];

  // Vectorize has no shared transaction with D1. Delete vectors first and fail
  // closed so a Vectorize outage never leaves searchable data after D1 is gone.
  // A later retry is safe because deleting the same Vectorize IDs is idempotent.
  if (vectorIds.length) await env.VECTORIZE.deleteByIds(vectorIds);

  // D1 batch execution is transactional. Delete every entry-owned artifact in a
  // single batch so no dangling graph, provenance, passage, episode, or snapshot
  // records survive a successful permanent forget.
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM edge_proposals WHERE source_id = ? OR target_id = ?`
    ).bind(id, id),
    env.DB.prepare(
      `DELETE FROM edges WHERE source_id = ? OR target_id = ?`
    ).bind(id, id),
    env.DB.prepare(`DELETE FROM passages WHERE entry_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM episodes WHERE entry_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM entry_snapshots WHERE entry_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM entries WHERE id = ?`).bind(id),
  ]);

  return { status: "deleted", vectorCount: vectorIds.length };
}

// Deprecate (issue #119): keep the D1 row for audit but make the entry
// unrecallable by deleting its vectors and tagging it status:deprecated.
export async function deprecateEntry(id: string, env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT tags, vector_ids FROM entries WHERE id = ?`
  ).bind(id).first() as Record<string, any> | null;
  if (!row) return false;

  const tags: string[] = JSON.parse(row.tags ?? "[]");
  const vectorIds: string[] = JSON.parse(row.vector_ids ?? "[]");

  await env.DB.prepare(`UPDATE entries SET tags = ?, vector_ids = ? WHERE id = ?`)
    .bind(JSON.stringify(withStatus(tags, "deprecated")), "[]", id).run();

  try {
    if (vectorIds.length) await env.VECTORIZE.deleteByIds(vectorIds);
  } catch (e) {
    console.error("Vectorize deleteByIds failed during deprecate (non-fatal):", e);
  }
  return true;
}

// Apply a lifecycle status to an entry (issue #119). 'deprecated' deletes vectors
// (via deprecateEntry); others swap the status:* tag in place. Returns ok=false if no such entry.
export async function applyStatus(id: string, status: MemoryStatus, env: Env): Promise<boolean> {
  if (status === "deprecated") return deprecateEntry(id, env);
  const row = await env.DB.prepare(`SELECT tags FROM entries WHERE id = ?`).bind(id).first() as Record<string, any> | null;
  if (!row) return false;
  const tags: string[] = JSON.parse(row.tags ?? "[]");
  await env.DB.prepare(`UPDATE entries SET tags = ? WHERE id = ?`).bind(JSON.stringify(withStatus(tags, status)), id).run();
  return true;
}

// ─── Nightly cross-user contradiction detection (S06) ─────────────────────────
// Scans recent public entries and checks for contradictions against other users'
// entries. Writes proposals to edge_proposals table (deduplicated).
export async function detectCrossUserContradictions(env: Env): Promise<{ scanned: number; proposals: number }> {
  const SEVEN_DAYS_AGO = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const CONTRADICTION_THRESHOLD = 0.85;
  const MAX_ENTRIES = 25;

  // Fetch recent public entries (exclude private)
  const { results: recentEntries } = await env.DB.prepare(
    `SELECT id, content, owner_user_id FROM entries WHERE created_at >= ? AND tags NOT LIKE '%"private"%' ORDER BY created_at DESC LIMIT ?`
  ).bind(SEVEN_DAYS_AGO, MAX_ENTRIES).all() as { results: { id: string; content: string; owner_user_id: string }[] };

  let scanned = 0;
  let proposals = 0;

  for (const entry of recentEntries) {
    try {
      // The SQL predicate is a candidate reduction only. Re-authorize the
      // source against D1 so malformed tags never become implicitly public.
      const sourceMetadata = await env.DB.prepare(
        `SELECT tags, owner_user_id FROM entries WHERE id = ?`
      ).bind(entry.id).first<{ tags: string; owner_user_id: string }>();
      const sourceTags = parseEntryTags(sourceMetadata?.tags);
      if (!sourceMetadata || !sourceTags || sourceTags.includes("private")) continue;
      const sourceOwnerId = typeof sourceMetadata.owner_user_id === "string"
        ? sourceMetadata.owner_user_id
        : "";
      if (!sourceOwnerId) continue;

      scanned++;
      const entryVec = await embed(entry.content, env);
      // Public-only query. The helper uses Vectorize's supported `filter`
      // option and then authorizes every parent entry against D1.
      const { matches, entriesById } = await queryVisibleVectors(entryVec, env, { topK: 5 });

      for (const match of matches) {
        const matchEntryId = vectorMatchParentId(match);
        const matchScope = entriesById.get(matchEntryId);
        if (!matchScope || matchScope.tags.includes("private")) continue;
        const matchOwnerId = matchScope.ownerUserId;
        if (!matchOwnerId || matchOwnerId === sourceOwnerId) continue;
        if (matchEntryId === entry.id) continue;
        if ((match.score ?? 0) < CONTRADICTION_THRESHOLD) continue;

        // Dedup: check if proposal already exists
        const existing = await env.DB.prepare(
          `SELECT id FROM edge_proposals WHERE source_id = ? AND target_id = ? AND type = 'contradicts' AND status = 'pending'`
        ).bind(matchEntryId, entry.id).first();
        if (existing) continue;

        const proposalId = crypto.randomUUID();
        const now = Date.now();
        await env.DB.prepare(
          `INSERT INTO edge_proposals (id, source_id, target_id, type, reason, proposed_by, status, created_at) VALUES (?, ?, ?, 'contradicts', ?, ?, 'pending', ?)`
        ).bind(
          proposalId,
          matchEntryId,
          entry.id,
          `Nightly contradiction scan (similarity: ${(match.score * 100).toFixed(0)}%)`,
          "_nightly_scan",
          now,
        ).run();
        proposals++;
      }
    } catch (e) {
      console.error(`Contradiction scan failed for entry ${entry.id} (non-fatal):`, e);
    }
  }

  return { scanned, proposals };
}
