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
import { filterVisibleIds, inferEdgesOnWrite } from "./graph";

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

  const recentSynth = await env.DB.prepare(`
    SELECT id FROM entries
    WHERE tags LIKE '%"synthesized"%'
      AND tags LIKE ?
      AND created_at > ?
    LIMIT 1
  `).bind(`%"${escapeLikePattern(tag)}"%`, Date.now() - 86400000).first();

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

  if (rawEntries.length < 10) {
    return { synthesizedId: null, entriesUsed: 0, text: "" };
  }

  const rows = rawEntries.map((r: any) => ({ id: r.id as string, content: r.content as string }));
  const text = await synthesizeDigest(tag, rows, env);
  if (!text) return { synthesizedId: null, entriesUsed: 0, text: "" };

  const content = `[Synthesized from ${rows.length} entries tagged "${tag}"]\n\n${text}`;
  const result = await captureEntry(content, ["synthesized", tag], "system", env, ctx);

  if (result.status !== "stored") {
    return { synthesizedId: null, entriesUsed: 0, text };
  }

  for (const id of rows.map((r: any) => r.id)) {
    // Snapshot: backup before compression — fire-and-forget (non-fatal)
    createSnapshot(env, id).catch(e => console.error(`Snapshot creation failed for ${id} (non-fatal):`, e));
    try {
      await env.DB.prepare(
        `UPDATE entries SET tags = json_insert(tags, '$[#]', 'rolled-up'), content = content || ? WHERE id = ?`
      ).bind(`\n\n[Digest: ${result.id}]`, id).run();
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
      const values = await embed(entry.content, env);
      const { matches } = await env.VECTORIZE.query(values, { topK: 5, returnMetadata: "all" });
      const scores = new Map<string, number>();
      for (const m of matches) {
        const pid = (m.metadata as any)?.parentId ?? m.id;
        scores.set(pid, Math.max(scores.get(pid) ?? 0, m.score));
      }
      let neighbors = [...scores.entries()].map(([id, score]) => ({ id, score }));

      // Visibility filter: only link to entries mutually visible with this entry's owner.
      // Private entries link only to same-owner entries; public entries link to public only.
      const entryTags: string[] = JSON.parse(entry.tags ?? "[]");
      const entryOwner = entry.owner_user_id;
      if (entryOwner || entryTags.includes("private")) {
        const neighborIds = neighbors.map(n => n.id);
        const visibleIds = await filterVisibleIds(neighborIds, entryOwner || "__no_owner__", env);
        const visibleSet = new Set(visibleIds);
        neighbors = neighbors.filter(n => visibleSet.has(n.id));
      }

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

export async function forgetEntry(id: string, env: Env): Promise<ForgetResult> {
  const row = await env.DB.prepare(
    `SELECT vector_ids FROM entries WHERE id = ?`
  ).bind(id).first() as Record<string, any> | null;

  if (!row) return { status: "not_found" };

  const vectorIds: string[] = JSON.parse(row.vector_ids ?? "[]");

  await env.DB.prepare(`DELETE FROM entries WHERE id = ?`).bind(id).run();

  // Cascade: drop any edges touching this node (as source or target) so the graph
  // never holds links pointing at a deleted entry. Non-fatal — a failed cleanup
  // must not abort the delete.
  try {
    await env.DB.prepare(`DELETE FROM edges WHERE source_id = ? OR target_id = ?`).bind(id, id).run();
  } catch (e) {
    console.error("Edge cascade-delete failed (non-fatal):", e);
  }

  try {
    if (vectorIds.length) {
      // Delete exact IDs — no guessing, no leaks
      await env.VECTORIZE.deleteByIds(vectorIds);
    }
  } catch (e) {
    console.error("Vectorize delete failed (non-fatal):", e);
  }

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
