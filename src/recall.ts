/**
 * Recall / search pipeline
 *
 * Purpose: Semantic + keyword hybrid search over the second-brain entry store.
 *          Embeds the query, runs Vectorize cosine search and D1 keyword LIKE
 *          search in parallel, fuses via Reciprocal Rank Fusion, reranks with
 *          time-decay / importance / tag-boost scoring, deduplicates, optionally
 *          expands via the relationship graph, hydrates from D1, and synthesizes
 *          an insight summary.
 *
 * Input:   query string, topK, optional tag/after/before/kind/hops/userId filters.
 *          Env bindings (DB, VECTORIZE, AI) and ExecutionContext for waitUntil.
 *
 * Output:  RecallSearchResult — { matches: RecallMatch[], insight: string,
 *          semanticUnavailable: boolean }.
 *
 * Logic:   parseTimePhrase → embed + inferQueryTags → Vectorize query (or tag-path
 *          vector fetch) ‖ keywordSearch → fuseDenseAndKeyword (RRF) →
 *          rerankWithTimeDecay → dedupe → expandGraph → D1 hydration →
 *          cross-user mention flagging → synthesizeInsight → derivePattern.
 */

import type { Env } from "./types";
import { MemoryKind, KIND_VALUES } from "./types";
import {
  getHalfLifeMs,
  cosineSim,
  embed,
  escapeLikePattern,
  tokenizeQuery,
  readStreamText,
} from "./helpers";
import {
  GRAPH_MAX_HOPS,
  GRAPH_HOP_DECAY,
  VECTORIZE_TOP_K_MULTIPLIER,
  VECTORIZE_GET_BY_IDS_BATCH,
  D1_MAX_BOUND_PARAMS,
  DUPLICATE_FLAG_THRESHOLD,
  RRF_K,
  KEYWORD_CANDIDATE_LIMIT,
  TAG_BOOST_MAX,
  TAG_BOOST_STEP,
  CONTRADICTION_IMPORTANCE_STEP,
  VECTORIZE_FIX_HINT,
  LLM_MODEL,
  INSIGHT_MAX_TOKENS,
  CHUNK_OVERLAP_CHARS,
} from "./config";
import { getStatus, withKind, withStatus, buildVisibilityClause } from "./tags";
import { expandGraph } from "./graph";
import { inferQueryTags, extractHashtags } from "./classification";
import { synthesizeInsight, derivePattern } from "./lifecycle";

// ─── Time-decay reranking ─────────────────────────────────────────────────────

export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export function rerankWithTimeDecay(
  matches: VectorizeMatch[],
  recallCounts: Map<string, number> = new Map(),
  importanceScores: Map<string, number> = new Map(),
  queryTags: string[] = [],
  contradictionWins: Map<string, number> = new Map(),
  contradictionLosses: Map<string, number> = new Map()
): VectorizeMatch[] {
  const now = Date.now();

  return matches
    .map(match => {
      const meta = match.metadata as any;
      const createdAt = meta?.created_at ?? now;
      const tags: string[] = Array.isArray(meta?.tags) ? meta.tags : [];
      const ageMs = now - createdAt;
      const parentId = (meta?.parentId ?? match.id) as string;
      const rc = recallCounts.get(parentId) ?? 0;

      const halfLifeMs = getHalfLifeMs(tags);
      const recencyMultiplier = Math.exp(-ageMs / halfLifeMs);
      // Frequency can compensate for recency loss but never push above a fresh entry (cap at 1.0).
      // Without the cap, high recall counts overwhelm recency and bury newly-stored memories.
      const frequencyMultiplier = 1 + Math.log1p(rc);
      const combinedMultiplier = Math.min(1.0, recencyMultiplier * frequencyMultiplier);
      const isShortAppend = match.id.includes("-update-") &&
        typeof meta?.content === "string" && meta.content.length < CHUNK_OVERLAP_CHARS;
      const appendPenalty = isShortAppend ? 0.2 : 1.0;
      const rolledUpPenalty = tags.includes("rolled-up") ? 0.4 : 1.0;

      // Effective importance = classifier score adjusted by net contradiction history.
      // Survivors (net wins) rise toward 5; repeatedly-contradicted memories (net losses)
      // fall toward 1. log1p gives diminishing returns; clamp keeps the effect inside the
      // existing 0.88–1.20 importance band. The stored importance_score is never mutated.
      const imp = importanceScores.get(parentId) ?? 0;
      const wins = contradictionWins.get(parentId) ?? 0;
      const losses = contradictionLosses.get(parentId) ?? 0;
      const net = wins - losses;
      let importanceMultiplier: number;
      if (imp === 0 && net === 0) {
        importanceMultiplier = 1.0; // unscored and never contested — unchanged baseline
      } else {
        const base = imp === 0 ? 3 : imp; // unscored-but-contested → neutral midpoint
        const adj = Math.sign(net) * Math.log1p(Math.abs(net)) * CONTRADICTION_IMPORTANCE_STEP;
        const effectiveImp = Math.max(1, Math.min(5, base + adj));
        importanceMultiplier = 0.8 + (effectiveImp / 5) * 0.4;
      }

      // Tag boost: applied outside the recency ≤1.0 cap so a tag-relevant memory can
      // surface above a marginally-closer but irrelevant one.
      const overlap = queryTags.length ? tags.filter(t => queryTags.includes(t)).length : 0;
      const tagBoost = overlap ? Math.min(TAG_BOOST_MAX, 1 + overlap * TAG_BOOST_STEP) : 1.0;

      return { ...match, score: match.score * combinedMultiplier * appendPenalty * rolledUpPenalty * importanceMultiplier * tagBoost };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Temporal phrase parsing ──────────────────────────────────────────────────
export function parseTimePhrase(query: string, now: number): { after?: number; before?: number; cleanQuery: string } {
  const MS_DAY = 86400000;
  const MS_WEEK = 7 * MS_DAY;
  const d = new Date(now);
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startOfWeek = (date: Date) => {
    const dow = date.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    return startOfDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff));
  };

  type TimeResult = { after?: number; before?: number };
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => TimeResult]> = [
    [/\blast\s+(\d+)\s+days?\b/i, m => ({ after: now - parseInt(m[1]) * MS_DAY })],
    [/\blast\s+(\d+)\s+weeks?\b/i, m => ({ after: now - parseInt(m[1]) * MS_WEEK })],
    [/\blast\s+week\b/i, () => ({ after: now - MS_WEEK })],
    [/\bthis\s+week\b/i, () => ({ after: startOfWeek(d) })],
    [/\blast\s+month\b/i, () => ({
      after: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
      before: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    })],
    [/\bthis\s+month\b/i, () => ({ after: new Date(d.getFullYear(), d.getMonth(), 1).getTime() })],
    [/\byesterday\b/i, () => {
      const s = startOfDay(d) - MS_DAY;
      return { after: s, before: s + MS_DAY };
    }],
    [/\btoday\b/i, () => ({ after: startOfDay(d) })],
    [/\baround\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i, m => {
      const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
      const center = new Date(d.getFullYear(), month, parseInt(m[2])).getTime();
      return { after: center - 3 * MS_DAY, before: center + 3 * MS_DAY };
    }],
  ];

  for (const [pattern, handler] of patterns) {
    const match = query.match(pattern);
    if (match) {
      const { after, before } = handler(match);
      const cleanQuery = query.replace(pattern, '').replace(/\s+/g, ' ').trim() || query;
      return { after, before, cleanQuery };
    }
  }

  return { cleanQuery: query };
}

// ─── Shared search path ───────────────────────────────────────────────────────
// Used by both the `recall` MCP tool and GET /recall — the full semantic
// search pipeline (embed → vector query → time-decay rerank → dedupe → D1
// hydration → insight synthesis) lives here once; callers format the result.

export interface RecallMatch {
  id: string;
  content: string;
  score: number;
  createdAt: number;
  tags: string[];
  source: string;
  isUpdate: boolean;
  hop: number; // 0 = direct match; ≥1 = surfaced via graph expansion (issue #16)
  crossUserMention?: { entryId: string; ownerUsername: string; similarity: number };
}

export interface RecallSearchResult {
  matches: RecallMatch[];
  insight: string;
  // True when the dense (Vectorize) step could not run — recall fell back to
  // keyword-only. Lets callers tell the user semantic search is unavailable.
  semanticUnavailable: boolean;
}

// Render recall matches as the MCP tool's text reply. Crucially includes each entry's
// ID so an LLM can act on a result (link, connections, append, update, forget) without
// a second list_recent round-trip — recall used to drop the ID, which left tools unable
// to reference the memories they just found.
export function renderRecallText(matches: RecallMatch[], insight: string): string {
  const text = matches.map((m, i) => {
    const date = new Date(m.createdAt).toLocaleDateString();
    const tagList = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
    const src = m.source ? ` · ${m.source}` : "";
    const score = (m.score * 100).toFixed(0);
    const updateLabel = m.isUpdate ? " [updated]" : "";
    const hopLabel = m.hop > 0 ? ` [related · ${m.hop} hop${m.hop > 1 ? "s" : ""}]` : "";
    const crossUserLabel = m.crossUserMention ? ` · also by ${m.crossUserMention.ownerUsername}` : "";
    return `${i + 1}. [${date}${src}${tagList}] (${score}% match)${updateLabel}${hopLabel}${crossUserLabel}\nID: ${m.id}\n${m.content}`;
  }).join("\n\n");
  return insight ? `**Insight:** ${insight}\n\n---\n\n${text}` : text;
}

// ─── Hybrid recall: keyword search + Reciprocal Rank Fusion ────────────────────

interface KeywordRow { id: string; content: string; tags: string; source: string; created_at: number; }

// Keyword candidates: entries whose content contains any query token, bounded by
// KEYWORD_CANDIDATE_LIMIT. Relevance ranking happens in fuseDenseAndKeyword.
async function keywordSearch(tokens: string[], env: Env, userId?: string): Promise<KeywordRow[]> {
  if (!tokens.length) return [];
  const where = tokens.map(() => "content LIKE ?").join(" OR ");
  const visClause = userId ? buildVisibilityClause(userId) : null;
  const fullWhere = visClause ? `(${where}) AND ${visClause.sql}` : where;
  const bindValues = visClause
    ? [...tokens.map(t => `%${t}%`), ...visClause.bind]
    : tokens.map(t => `%${t}%`);
  const { results } = await env.DB.prepare(
    `SELECT id, content, tags, source, created_at FROM entries WHERE ${fullWhere} ORDER BY created_at DESC LIMIT ?`
  ).bind(...bindValues, KEYWORD_CANDIDATE_LIMIT).all();
  return results as unknown as KeywordRow[];
}

// Reciprocal Rank Fusion. Dense candidates contribute 1/(k+rank); keyword candidates
// contribute weight/(k+rank), where weight = number of distinct query tokens the entry
// matched — so an exact multi-token/identifier hit outweighs entries that merely share a
// common word, and an entry present in BOTH lists accumulates from both.
export function rrfFuse(
  denseRanked: string[],
  keywordRanked: { id: string; weight: number }[],
  k = RRF_K
): Map<string, number> {
  const scores = new Map<string, number>();
  denseRanked.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i)));
  keywordRanked.forEach((e, i) => scores.set(e.id, (scores.get(e.id) ?? 0) + e.weight / (k + i)));
  return scores;
}

// Fuse a dense match list (Vectorize chunks, or tag-path cosine scores) with keyword rows
// into one per-parent candidate list scored by RRF, ready for rerankWithTimeDecay. With
// allowKeywordOnly=false (tag path) keyword is a re-ranking signal only — it never
// introduces an entry the dense pass didn't already surface.
function fuseDenseAndKeyword(
  denseMatches: VectorizeMatch[],
  keywordRows: KeywordRow[],
  tokens: string[],
  allowKeywordOnly: boolean
): VectorizeMatch[] {
  const denseByParent = new Map<string, VectorizeMatch>();
  for (const m of [...denseMatches].sort((a, b) => b.score - a.score)) {
    const pid = ((m.metadata as any)?.parentId ?? m.id) as string;
    if (!denseByParent.has(pid)) denseByParent.set(pid, m);
  }
  const denseRanked = [...denseByParent.keys()];

  const keywordRanked = keywordRows
    .map(r => ({ row: r, weight: tokens.reduce((n, t) => n + (r.content.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter(x => x.weight > 0 && (allowKeywordOnly || denseByParent.has(x.row.id)))
    .sort((a, b) => b.weight - a.weight || b.row.created_at - a.row.created_at || (a.row.id < b.row.id ? -1 : 1));

  const fused = rrfFuse(denseRanked, keywordRanked.map(x => ({ id: x.row.id, weight: x.weight })));
  const keywordRowById = new Map(keywordRows.map(r => [r.id, r]));

  const out: VectorizeMatch[] = [];
  for (const [pid, score] of fused) {
    const dm = denseByParent.get(pid);
    if (dm) {
      out.push({ id: dm.id, score, metadata: dm.metadata });
    } else {
      const r = keywordRowById.get(pid)!;
      out.push({ id: pid, score, metadata: { parentId: pid, created_at: r.created_at, tags: JSON.parse(r.tags ?? "[]"), content: r.content, source: r.source } });
    }
  }
  return out;
}

export async function recallEntries(
  params: { query: string; topK: number; tag?: string; after?: number; before?: number; kind?: MemoryKind; hops?: number; userId?: string },
  env: Env,
  ctx: ExecutionContext
): Promise<RecallSearchResult> {
  const { query, topK } = params;
  let { tag, after, before, kind } = params;
  const hops = Math.max(0, Math.min(GRAPH_MAX_HOPS, params.hops ?? 0));
  const userId = params.userId;
  const now = Date.now();
  let semanticUnavailable = false;

  let embedQuery = query;
  if (after === undefined && before === undefined) {
    const parsed = parseTimePhrase(query, now);
    after = parsed.after;
    before = parsed.before;
    embedQuery = parsed.cleanQuery;
  }

  const tokens = tokenizeQuery(embedQuery);
  const [values, queryTags] = await Promise.all([
    embed(embedQuery, env),
    inferQueryTags(embedQuery, env),
  ]);

  let keywordRows: KeywordRow[] = [];
  let results: { matches: VectorizeMatch[] };
  if (tag) {
    // Tag path: score the tag's own vectors directly. An unconstrained Vectorize
    // query caps at 50 candidates, silently dropping tagged entries whose global
    // semantic rank falls outside the top 50 (issue #141). D1 is the source of
    // truth for tags and already stores each entry's vector_ids.
    const { results: tagRows } = await env.DB.prepare(
      `SELECT id, vector_ids, content, tags, source, created_at FROM entries WHERE tags LIKE ?`
    ).bind(`%"${escapeLikePattern(tag)}"%`).all();
    if (!tagRows.length) return { matches: [], insight: "", semanticUnavailable };

    // Visibility filter: exclude other users' private entries
    const visibleTagRows = userId
      ? (tagRows as any[]).filter((r: any) => {
          const tags: string[] = JSON.parse(r.tags ?? "[]");
          return !(tags.includes("private") && r.owner_user_id !== userId);
        })
      : tagRows as any[];
    if (!visibleTagRows.length) return { matches: [], insight: "", semanticUnavailable };

    keywordRows = visibleTagRows as unknown as KeywordRow[];

    const vectorIds = [...new Set(
      (visibleTagRows as any[]).flatMap(r => JSON.parse((r.vector_ids as string) ?? "[]") as string[])
    )];
    if (!vectorIds.length) return { matches: [], insight: "", semanticUnavailable };

    const vectors: VectorizeVector[] = [];
    try {
      for (let i = 0; i < vectorIds.length; i += VECTORIZE_GET_BY_IDS_BATCH) {
        vectors.push(...await env.VECTORIZE.getByIds(vectorIds.slice(i, i + VECTORIZE_GET_BY_IDS_BATCH)));
      }
    } catch (e) {
      console.error("Vectorize getByIds failed (degrading to keyword-only):", e);
      semanticUnavailable = true;
    }

    results = {
      matches: vectors.map(v => ({
        id: v.id,
        score: cosineSim(values, v.values as number[]),
        metadata: v.metadata,
      })) as VectorizeMatch[],
    };
  } else {
    // Cloudflare Vectorize caps topK at 50 when returnMetadata="all" (error 40025).
    // Run the keyword search in parallel with the dense query.
    const vectorizeTopK = Math.min(topK * VECTORIZE_TOP_K_MULTIPLIER, 50);
    const denseQuery = async (): Promise<{ matches: VectorizeMatch[] }> => {
      try {
        const vectorizeOpts: Record<string, any> = { topK: vectorizeTopK, returnMetadata: "all" };
        if (userId) {
          vectorizeOpts.metadataFilter = {
            OR: [
              { owner_user_id: { $eq: userId } },
              { is_private: { $eq: false } }
            ]
          };
        }
        return await env.VECTORIZE.query(values, vectorizeOpts);
      } catch (e) {
        // This is the authoritative signal that the Vectorize index is unreachable —
        // semanticUnavailable drives the dashboard banner (checkVectorizeHealth/GET /health
        // is the full health probe; this catch fires only when the query itself throws).
        console.error("Vectorize query failed (degrading to keyword-only):", e);
        semanticUnavailable = true;
        return { matches: [] as VectorizeMatch[] };
      }
    };
    const [denseResults, kwRows] = await Promise.all([denseQuery(), keywordSearch(tokens, env, userId)]);
    results = denseResults;
    keywordRows = kwRows;

    if (!semanticUnavailable && results.matches.length && results.matches[0].score < DUPLICATE_FLAG_THRESHOLD) {
      try {
        const widenOpts: Record<string, any> = { topK: 50, returnMetadata: "all" };
        if (userId) {
          widenOpts.metadataFilter = {
            OR: [
              { owner_user_id: { $eq: userId } },
              { is_private: { $eq: false } }
            ]
          };
        }
        results = await env.VECTORIZE.query(values, widenOpts);
      } catch (e) {
        // Narrow query already succeeded with real matches, so the index works.
        // A transient widen failure must not claim semantic search is unavailable.
        console.error("Vectorize widen-query failed (non-fatal, keeping narrow results):", e);
      }
    }
  }

  // Always-on hybrid retrieval: fuse dense + keyword candidates via RRF. On the tag path
  // keyword is a re-ranking signal only (allowKeywordOnly=false); on the default path it can
  // also surface exact-identifier matches the dense top-K missed entirely.
  const fusedMatches = fuseDenseAndKeyword(results.matches as VectorizeMatch[], keywordRows, tokens, !tag || semanticUnavailable);
  if (!fusedMatches.length) return { matches: [], insight: "", semanticUnavailable };

  // Visibility filter: after RRF fusion, remove candidates that are other users' private entries.
  let visibleFusedMatches = fusedMatches;
  if (userId) {
    const candidateParentIds = [...new Set(fusedMatches.map(m => (m.metadata as any)?.parentId ?? m.id))] as string[];
    const visPlaceholders = candidateParentIds.map(() => "?").join(", ");
    const { results: visRows } = await env.DB.prepare(
      `SELECT id, owner_user_id, tags FROM entries WHERE id IN (${visPlaceholders})`
    ).bind(...candidateParentIds).all() as { results: { id: string; owner_user_id: string; tags: string }[] };
    const hiddenIds = new Set(
      visRows.filter((r: any) => {
        const tags: string[] = JSON.parse(r.tags ?? "[]");
        return tags.includes("private") && r.owner_user_id !== userId;
      }).map((r: any) => r.id)
    );
    visibleFusedMatches = fusedMatches.filter(m => !hiddenIds.has((m.metadata as any)?.parentId ?? m.id));
    if (!visibleFusedMatches.length) return { matches: [], insight: "", semanticUnavailable };
  }

  // Fetch recall_count and importance_score for all candidates to use in scoring.
  // The tag path can produce far more than 100 candidates, so chunk the IN query
  // to stay under D1's bound-parameter limit.
  const candidateIds = [...new Set(visibleFusedMatches.map(m => (m.metadata as any)?.parentId ?? m.id))] as string[];
  const rcRows: { id: string; recall_count: number; importance_score: number; contradiction_wins: number; contradiction_losses: number }[] = [];
  for (let i = 0; i < candidateIds.length; i += D1_MAX_BOUND_PARAMS) {
    const batch = candidateIds.slice(i, i + D1_MAX_BOUND_PARAMS);
    const rcPlaceholders = batch.map(() => "?").join(", ");
    const { results: rows } = await env.DB.prepare(
      `SELECT id, recall_count, importance_score, contradiction_wins, contradiction_losses FROM entries WHERE id IN (${rcPlaceholders})`
    ).bind(...batch).all() as { results: { id: string; recall_count: number; importance_score: number; contradiction_wins: number; contradiction_losses: number }[] };
    rcRows.push(...rows);
  }
  const recallCounts = new Map(rcRows.map(r => [r.id, r.recall_count ?? 0]));
  const importanceScores = new Map(rcRows.map(r => [r.id, r.importance_score ?? 0]));
  const contradictionWins = new Map(rcRows.map(r => [r.id, r.contradiction_wins ?? 0]));
  const contradictionLosses = new Map(rcRows.map(r => [r.id, r.contradiction_losses ?? 0]));

  const reranked = rerankWithTimeDecay(visibleFusedMatches, recallCounts, importanceScores, queryTags, contradictionWins, contradictionLosses);

  const seen = new Set<string>();
  const deduped = reranked.filter((m) => {
    const parentId = (m.metadata as any)?.parentId ?? m.id;
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    return true;
  }).slice(0, topK);

  if (!deduped.length) return { matches: [], insight: "", semanticUnavailable };

  const seedParentIds = deduped.map((m) => (m.metadata as any)?.parentId ?? m.id);

  // Multi-hop expansion (issue #16): walk the graph outward from the direct-match seeds
  // and fold in related memories. Each expanded node is scored as a fraction of the
  // WEAKEST seed (minSeedScore × decay^hop × edgeWeight), so a related node can never
  // outrank a direct match — recall never regresses — while neighbors still order by
  // graph distance and link strength. hops:0 → no expansion → byte-for-byte today's path.
  let expandedScored: { parentId: string; score: number; hop: number }[] = [];
  if (hops > 0) {
    const minSeedScore = deduped.reduce((mn, m) => Math.min(mn, m.score), Infinity);
    const expanded = await expandGraph(seedParentIds, { hops }, env, userId);
    expandedScored = expanded.map(n => ({
      parentId: n.id,
      hop: n.hop,
      score: minSeedScore * Math.pow(GRAPH_HOP_DECAY, n.hop) * n.viaWeight,
    }));
  }

  // Fetch full content from D1 for seeds + expanded nodes, applying filters: auto-pattern
  // exclusion, status:deprecated exclusion, optional kind match, and optional after/before range
  const allParentIds = [...seedParentIds, ...expandedScored.map(e => e.parentId)];
  const placeholders = allParentIds.map(() => "?").join(", ");
  const d1Bindings: (string | number)[] = [...allParentIds];
  let d1Sql = `SELECT id, content, tags, source, created_at FROM entries WHERE id IN (${placeholders}) AND tags NOT LIKE '%"auto-pattern"%' AND tags NOT LIKE '%"status:deprecated"%'`;
  if (userId) {
    const vis = buildVisibilityClause(userId);
    d1Sql += ` AND ${vis.sql}`;
    d1Bindings.push(...vis.bind);
  }
  if (kind && (KIND_VALUES as readonly string[]).includes(kind)) {
    // Safe to interpolate: `kind` is validated against the KIND_VALUES enum just above,
    // so only "episodic"/"semantic" can reach the string. Kept as a literal (not a bound
    // param) so it doesn't shift the positional after/before bindings below.
    d1Sql += ` AND tags LIKE '%"kind:${kind}"%'`;
  }
  if (after !== undefined) { d1Sql += ` AND created_at >= ?`; d1Bindings.push(after); }
  if (before !== undefined) { d1Sql += ` AND created_at <= ?`; d1Bindings.push(before); }
  const { results: d1Rows } = await env.DB.prepare(d1Sql).bind(...d1Bindings).all() as { results: Record<string, any>[] };

  const d1Map = new Map(d1Rows.map((r) => [r.id as string, r]));

  // Increment recall_count for the DIRECT seeds shown — never for graph-expanded
  // neighbors, or well-connected nodes would inflate their own ranking (feedback loop).
  const seedIdSet = new Set(seedParentIds);
  ctx.waitUntil(
    Promise.all(
      [...d1Map.keys()].filter(id => seedIdSet.has(id)).map(id =>
        env.DB.prepare(`UPDATE entries SET recall_count = recall_count + 1 WHERE id = ?`).bind(id).run()
      )
    ).catch(e => console.error("recall_count update failed (non-fatal):", e))
  );

  const seedMatches: RecallMatch[] = deduped.flatMap((m) => {
    const meta = m.metadata as Record<string, any>;
    const parentId = (meta?.parentId ?? m.id) as string;
    const row = d1Map.get(parentId);
    if (!row) {
      // D1 row not found — either filtered out (e.g. status:deprecated) or genuinely missing
      return [];
    }
    return [{
      id: parentId,
      content: row.content as string,
      score: m.score,
      createdAt: row.created_at as number,
      tags: JSON.parse(row.tags ?? "[]"),
      source: row.source as string,
      isUpdate: !!meta?.isUpdate,
      hop: 0,
    }];
  });

  const expandedMatches: RecallMatch[] = expandedScored.flatMap((e) => {
    const row = d1Map.get(e.parentId);
    if (!row) return []; // filtered out (deprecated/kind/range) or missing
    return [{
      id: e.parentId,
      content: row.content as string,
      score: e.score,
      createdAt: row.created_at as number,
      tags: JSON.parse(row.tags ?? "[]"),
      source: row.source as string,
      isUpdate: false,
      hop: e.hop,
    }];
  });

  // Seeds always outrank expanded by construction, so they fill the top and expanded
  // occupy only leftover slots — a direct match is never displaced by a neighbor.
  const matches: RecallMatch[] = [...seedMatches, ...expandedMatches]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Normalize fused scores to 0–1 (top match = 1.0) so the displayed match % is a clean,
  // monotonically-decreasing scale rather than raw RRF values.
  const maxScore = matches.reduce((mx, m) => Math.max(mx, m.score), 0);
  if (maxScore > 0) for (const m of matches) m.score = m.score / maxScore;

  // ── Cross-user mentions: flag high-similarity public entries from other users ──
  if (userId) {
    // Collect unique owner IDs from deduped Vectorize matches that differ from the current user
    const crossUserOwnerIds = new Set<string>();
    for (const m of deduped) {
      const ownerId = (m.metadata as any)?.owner_user_id;
      if (ownerId && ownerId !== userId) crossUserOwnerIds.add(ownerId);
    }
    if (crossUserOwnerIds.size) {
      const ownerIds = [...crossUserOwnerIds];
      const placeholders = ownerIds.map(() => "?").join(", ");
      const { results: ownerRows } = await env.DB.prepare(
        `SELECT id, username FROM users WHERE id IN (${placeholders})`
      ).bind(...ownerIds).all() as { results: { id: string; username: string }[] };
      const usernameMap = new Map(ownerRows.map(r => [r.id, r.username]));

      // Attach crossUserMention to matches owned by other users with high similarity
      const seenOwnerMatches = new Set<string>();
      for (const m of matches) {
        // Find the original Vectorize match to get the raw score and owner
        const rawMatch = deduped.find(d => ((d.metadata as any)?.parentId ?? d.id) === m.id);
        if (!rawMatch) continue;
        const ownerId = (rawMatch.metadata as any)?.owner_user_id;
        if (!ownerId || ownerId === userId) continue;
        const username = usernameMap.get(ownerId);
        if (!username) continue;
        // Only mention once per owner
        if (seenOwnerMatches.has(ownerId)) continue;
        seenOwnerMatches.add(ownerId);
        m.crossUserMention = { entryId: m.id, ownerUsername: username, similarity: m.score };
      }
    }
  }

  // Synthesize over exactly what's shown (seeds + any surfaced neighbors) so the
  // insight stays grounded in the returned results.
  const insight = matches.length > 1
    ? await synthesizeInsight(embedQuery, matches.map(m => ({ id: m.id, content: m.content })), env)
    : "";

  if (d1Rows.length >= 5) {
    ctx.waitUntil(
      derivePattern(d1Rows as { id: string; content: string }[], env, ctx)
        .catch(e => console.error("derivePattern failed (non-fatal):", e))
    );
  }

  return { matches, insight, semanticUnavailable };
}
