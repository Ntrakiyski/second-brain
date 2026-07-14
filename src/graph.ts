/**
 * graph.ts — Relationship graph: edge types, CRUD, traversal, and auto-linking.
 *
 * Purpose: Define the relationship graph subsystem — edge type registry, single
 *   writer/remover for edges, BFS graph traversal with hop/fanout/node caps,
 *   entry hydration, connection queries, full graph assembly for the dashboard,
 *   and automatic edge inference on new entry writes.
 * Input: Entry IDs, edge types, weights, Vectorize query results, user IDs.
 * Output: Graph neighbors, connections, full graph views, and persisted edge rows.
 * Logic: Code-validated edge type registry (no SQL CHECK constraints), symmetric
 *   edge normalization, BFS traversal with deprecated/visibility filtering,
 *   cosine-similarity-based auto-linking, and batched D1 queries within the
 *   100-bound-param limit.
 */

import type { Env, MemoryKind, MemoryStatus } from "./types";
import {
  D1_MAX_BOUND_PARAMS,
  EDGE_INFER_MAX,
  EDGE_INFER_THRESHOLD,
  EDGE_QUERY_BATCH,
  GRAPH_FANOUT_CAP,
  GRAPH_HOP_DECAY,
  GRAPH_MAX_HOPS,
  GRAPH_MAX_NODES,
} from "./config";
import { embed } from "./helpers";
import { getKind, getStatus } from "./tags";

// ─── Relationship graph (issue #16) ─────────────────────────────────────────────
// Edges live in a dedicated `edges` table — the one additive schema change. Edge
// types and provenance are validated in CODE against this registry rather than via
// SQL CHECK constraints, so adding a new type is a one-line change here that ships
// with a deploy and never requires a migration. Per-edge extension data goes in the
// edges.metadata JSON column (the edges analogue of entries.tags) — also no ALTER.

export const EDGE_TYPES = {
  relates_to:      { directed: false, label: "Related to",      allowedKinds: null },
  supersedes:      { directed: true,  label: "Supersedes",      allowedKinds: null },
  caused_by:       { directed: true,  label: "Caused by",       allowedKinds: null },
  decided:         { directed: true,  label: "Decided",         allowedKinds: ["episodic"] },
  about_person:    { directed: true,  label: "About person",    allowedKinds: null },
  part_of_project: { directed: true,  label: "Part of project", allowedKinds: null },
  follows:         { directed: true,  label: "Follows",         allowedKinds: ["episodic"] },
  corrects:        { directed: true,  label: "Corrects",        allowedKinds: null },
  contradicts:     { directed: true,  label: "Contradicts",     allowedKinds: null },
  clarifies:       { directed: true,  label: "Clarifies",       allowedKinds: null },
  temporal_after:  { directed: true,  label: "After (temporal)", allowedKinds: null },
  contextually_matches: { directed: false, label: "Contextually matches", allowedKinds: null },
  derives_from:        { directed: true,  label: "Derives from",        allowedKinds: null },
  supports:            { directed: true,  label: "Supports",            allowedKinds: null },
  evaluates_on:        { directed: true,  label: "Evaluates on",        allowedKinds: null },
  has_limitation:      { directed: true,  label: "Has limitation",      allowedKinds: null },
} as const satisfies Record<string, { directed: boolean; label: string; allowedKinds: readonly MemoryKind[] | null }>;

export type EdgeType = keyof typeof EDGE_TYPES;

export const PROVENANCE_VALUES = ["explicit", "inferred", "system"] as const;
export type EdgeProvenance = (typeof PROVENANCE_VALUES)[number];

const DEFAULT_EDGE_WEIGHT = 0.5;

export function isValidEdgeType(type: string): type is EdgeType {
  return Object.prototype.hasOwnProperty.call(EDGE_TYPES, type);
}

// Symmetric (undirected) edges store the pair smaller-id-first so A→B and B→A
// collapse to one row; directed edges keep their natural order.
export function isSymmetric(type: EdgeType): boolean {
  return !EDGE_TYPES[type].directed;
}

export function edgeLabel(type: EdgeType): string {
  return EDGE_TYPES[type].label;
}

export function allowedKindsFor(type: EdgeType): readonly MemoryKind[] | null {
  return EDGE_TYPES[type].allowedKinds;
}

// The single writer for edges. Rejects self-links and unknown types (returns null),
// normalizes symmetric pairs, and upserts idempotently so re-linking the same pair
// keeps the stronger weight instead of erroring or duplicating.
export async function createEdge(
  sourceId: string,
  targetId: string,
  type: string,
  opts: { weight?: number; provenance?: EdgeProvenance; metadata?: Record<string, unknown>; confidence?: number },
  env: Env,
): Promise<{ source_id: string; target_id: string; type: EdgeType } | null> {
  if (!isValidEdgeType(type)) return null;
  if (sourceId === targetId) return null;

  // Visibility check: private entries can only connect to same-owner entries.
  // A private entry must not link to any entry owned by a different user.
  const srcRow = await env.DB.prepare("SELECT tags, owner_user_id FROM entries WHERE id = ?").bind(sourceId).first() as { tags: string; owner_user_id: string } | null;
  const tgtRow = await env.DB.prepare("SELECT tags, owner_user_id FROM entries WHERE id = ?").bind(targetId).first() as { tags: string; owner_user_id: string } | null;
  if (srcRow && tgtRow) {
    const srcPrivate = JSON.parse(srcRow.tags ?? "[]").includes("private");
    const tgtPrivate = JSON.parse(tgtRow.tags ?? "[]").includes("private");
    if (srcPrivate && srcRow.owner_user_id !== tgtRow.owner_user_id) return null;
    if (tgtPrivate && tgtRow.owner_user_id !== srcRow.owner_user_id) return null;
  }

  let source = sourceId;
  let target = targetId;
  if (isSymmetric(type) && source > target) [source, target] = [target, source];

  const weight = Math.max(0, Math.min(1, opts.weight ?? DEFAULT_EDGE_WEIGHT));
  const provenance = opts.provenance ?? "inferred";
  const confidence = Math.max(0, Math.min(1, opts.confidence ?? DEFAULT_EDGE_WEIGHT));
  const meta = { ...(opts.metadata ?? {}), confidence };
  const metadata = JSON.stringify(meta);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO edges (id, source_id, target_id, type, weight, provenance, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, target_id, type) DO UPDATE SET weight = max(weight, excluded.weight), updated_at = excluded.updated_at`
  ).bind(crypto.randomUUID(), source, target, type, weight, provenance, metadata, now, now).run();

  return { source_id: source, target_id: target, type };
}

// The single remover for edges. The WHERE is order-agnostic — it matches directed
// edges stated in either direction AND symmetric pairs regardless of the smaller-id-
// first normalization createEdge applied — so callers never re-derive that rule.
// Optional type narrows the delete to one relationship type; omitted removes every
// edge between the pair. Returns rows removed: 0 is not an error (idempotent delete,
// the mirror of createEdge's idempotent upsert).
export async function deleteEdge(
  sourceId: string,
  targetId: string,
  type: string | undefined,
  env: Env,
): Promise<number> {
  let sql = `DELETE FROM edges WHERE ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))`;
  const bindings: string[] = [sourceId, targetId, targetId, sourceId];
  if (type) {
    sql += ` AND type = ?`;
    bindings.push(type);
  }
  const result = await env.DB.prepare(sql).bind(...bindings).run();
  return result.meta.changes ?? 0;
}

// ─── Graph traversal ────────────────────────────────────────────────────────────

export interface GraphNeighbor {
  id: string;
  hop: number;
  viaWeight: number;
  viaType: EdgeType;
}

// Returns the subset of `ids` whose entry is tagged status:deprecated.
async function deprecatedIdsAmong(ids: string[], env: Env): Promise<Set<string>> {
  const deprecated = new Set<string>();
  for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMS) {
    const batch = ids.slice(i, i + D1_MAX_BOUND_PARAMS);
    const ph = batch.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, tags FROM entries WHERE id IN (${ph})`
    ).bind(...batch).all() as { results: Record<string, any>[] };
    for (const r of results) {
      if (getStatus(JSON.parse(r.tags ?? "[]")) === "deprecated") deprecated.add(r.id as string);
    }
  }
  return deprecated;
}

// Breadth-first traversal of the edges table outward from a set of seed nodes.
// Shared by recall (multi-hop expansion), GET /connections, and GET /graph. Bounded
// by hop/fanout/node caps so a heavily-connected node can't explode the query, and
// skips status:deprecated nodes by default so stale entries aren't traversed through.
export async function expandGraph(
  seedIds: string[],
  opts: { hops: number; fanoutCap?: number; maxNodes?: number; includeDeprecated?: boolean },
  env: Env,
  userId?: string,
): Promise<GraphNeighbor[]> {
  const hops = Math.max(0, Math.min(GRAPH_MAX_HOPS, opts.hops));
  if (hops === 0 || seedIds.length === 0) return [];
  const fanoutCap = opts.fanoutCap ?? GRAPH_FANOUT_CAP;
  const maxNodes = opts.maxNodes ?? GRAPH_MAX_NODES;

  const visited = new Set(seedIds);
  const out: GraphNeighbor[] = [];
  let frontier = [...seedIds];

  for (let hop = 1; hop <= hops && frontier.length && out.length < maxNodes; hop++) {
    // Pull every edge touching the current frontier, strongest first (batched).
    const edgeRows: { source_id: string; target_id: string; type: string; weight: number }[] = [];
    for (let i = 0; i < frontier.length; i += EDGE_QUERY_BATCH) {
      const batch = frontier.slice(i, i + EDGE_QUERY_BATCH);
      const ph = batch.map(() => "?").join(", ");
      const { results } = await env.DB.prepare(
        `SELECT source_id, target_id, type, weight FROM edges WHERE source_id IN (${ph}) OR target_id IN (${ph}) ORDER BY weight DESC`
      ).bind(...batch, ...batch).all() as { results: any[] };
      edgeRows.push(...results);
    }

    // For each frontier node, take its strongest unseen neighbors up to the fanout cap.
    const frontierSet = new Set(frontier);
    const perNodeCount = new Map<string, number>();
    const candidates: GraphNeighbor[] = [];
    for (const e of edgeRows) {
      let from: string | null = null;
      let to: string | null = null;
      if (frontierSet.has(e.source_id)) { from = e.source_id; to = e.target_id; }
      else if (frontierSet.has(e.target_id)) { from = e.target_id; to = e.source_id; }
      if (!from || !to || visited.has(to)) continue;
      const n = perNodeCount.get(from) ?? 0;
      if (n >= fanoutCap) continue;
      perNodeCount.set(from, n + 1);
      candidates.push({ id: to, hop, viaWeight: e.weight, viaType: e.type as EdgeType });
    }

    // Drop deprecated nodes before they enter results or the next frontier.
    let allowed = candidates;
    if (!opts.includeDeprecated && candidates.length) {
      const deprecated = await deprecatedIdsAmong([...new Set(candidates.map(c => c.id))], env);
      allowed = candidates.filter(c => !deprecated.has(c.id));
    }

    // Visibility filter: skip other users' private entries
    if (userId && allowed.length) {
      const candidateIds = [...new Set(allowed.map(c => c.id))];
      const visibleIds = await filterVisibleIds(candidateIds, userId, env);
      const visibleSet = new Set(visibleIds);
      allowed = allowed.filter(c => visibleSet.has(c.id));
    }

    const nextFrontier: string[] = [];
    for (const c of allowed) {
      if (visited.has(c.id)) continue; // first (strongest) wins; dedupe across this hop
      if (out.length >= maxNodes) break;
      visited.add(c.id);
      out.push(c);
      nextFrontier.push(c.id);
    }
    frontier = nextFrontier;
  }

  return out;
}

// Filter entry IDs to only those visible to the given user: own entries + all public.
// Used by expandGraph and runGraphPass to enforce visibility during traversal.
export async function filterVisibleIds(ids: string[], userId: string, env: Env): Promise<string[]> {
  if (!ids.length) return [];
  const visible: string[] = [];
  for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMS) {
    const batch = ids.slice(i, i + D1_MAX_BOUND_PARAMS);
    const ph = batch.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, tags, owner_user_id FROM entries WHERE id IN (${ph})`
    ).bind(...batch).all() as { results: { id: string; tags: string; owner_user_id: string }[] };
    for (const r of results) {
      const tags: string[] = JSON.parse(r.tags ?? "[]");
      if (tags.includes("private") && r.owner_user_id !== userId) continue;
      visible.push(r.id);
    }
  }
  return visible;
}

// Hydrate graph node ids into full entry rows (id → row), batched within the D1
// bound-param limit. Shared by /connections and /graph.
async function hydrateGraphEntries(ids: string[], env: Env): Promise<Map<string, Record<string, any>>> {
  const map = new Map<string, Record<string, any>>();
  for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMS) {
    const batch = ids.slice(i, i + D1_MAX_BOUND_PARAMS);
    const ph = batch.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, content, tags, source, created_at, owner_user_id FROM entries WHERE id IN (${ph})`
    ).bind(...batch).all() as { results: Record<string, any>[] };
    for (const r of results) map.set(r.id as string, r);
  }
  return map;
}

export interface Connection {
  id: string;
  content: string;
  tags: string[];
  source: string;
  created_at: number;
  type: EdgeType;
  label: string;
  weight: number;
}

// 1-hop neighborhood of an entry, hydrated and annotated with edge type/weight.
// Backs both the `connections` MCP tool and GET /connections.
export async function getConnections(id: string, type: string | undefined, env: Env, userId?: string): Promise<Connection[]> {
  let neighbors = await expandGraph([id], { hops: 1 }, env, userId);
  if (type) neighbors = neighbors.filter(n => n.viaType === type);
  if (!neighbors.length) return [];

  const rows = await hydrateGraphEntries(neighbors.map(n => n.id), env);
  const out: Connection[] = [];
  for (const n of neighbors) {
    const row = rows.get(n.id);
    if (!row) continue; // neighbor was deleted (cascade should prevent this) — skip dangling
    // Visibility filter: exclude other users' private entries
    const tags: string[] = JSON.parse(row.tags ?? "[]");
    if (userId && tags.includes("private") && (row as any).owner_user_id !== userId) continue;
    out.push({
      id: n.id,
      content: row.content as string,
      tags,
      source: row.source as string,
      created_at: row.created_at as number,
      type: n.viaType,
      label: edgeLabel(n.viaType),
      weight: n.viaWeight,
    });
  }
  return out;
}

export interface GraphNode {
  id: string;
  label: string;
  tags: string[];
  kind: MemoryKind | null;
  status: MemoryStatus | null;
  importance: number;
  created_at: number;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: { source: string; target: string; type: string; weight: number }[];
}

// Assemble a node+edge subgraph for the dashboard graph view. Either the 2-hop
// neighborhood of a seed entry, or (default) the most strongly-connected slice of the
// whole graph — uncapped unless the caller passes an explicit limit. Only edges whose
// BOTH endpoints are in the returned node set are included, so the client never has
// to handle dangling edges.
export async function buildGraph(opts: { seed?: string; limit?: number; userId?: string }, env: Env): Promise<GraphView> {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;

  // 1. Determine the candidate node id set.
  let nodeIds: string[];
  if (opts.seed) {
    const neighbors = await expandGraph([opts.seed], { hops: 2, maxNodes: limit, includeDeprecated: true }, env, opts.userId);
    nodeIds = [opts.seed, ...neighbors.map(n => n.id)].slice(0, limit);
  } else {
    const sql = Number.isFinite(limit)
      ? `SELECT source_id, target_id FROM edges ORDER BY weight DESC LIMIT ${limit * 4}`
      : `SELECT source_id, target_id FROM edges ORDER BY weight DESC`;
    const { results } = await env.DB.prepare(sql)
      .all() as { results: { source_id: string; target_id: string }[] };
    const ids: string[] = [];
    const seenIds = new Set<string>();
    for (const r of results) {
      for (const id of [r.source_id, r.target_id]) {
        if (ids.length >= limit) break;
        if (!seenIds.has(id)) { seenIds.add(id); ids.push(id); }
      }
      if (ids.length >= limit) break;
    }
    nodeIds = ids;
  }
  if (!nodeIds.length) return { nodes: [], edges: [] };

  // 2. Hydrate nodes (drop ids with no entry row — that's how dangling edges get pruned).
  const nodeRows = new Map<string, Record<string, any>>();
  for (let i = 0; i < nodeIds.length; i += D1_MAX_BOUND_PARAMS) {
    const batch = nodeIds.slice(i, i + D1_MAX_BOUND_PARAMS);
    const ph = batch.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT id, content, tags, importance_score, created_at, owner_user_id FROM entries WHERE id IN (${ph})`
    ).bind(...batch).all() as { results: Record<string, any>[] };
    for (const r of results) nodeRows.set(r.id as string, r);
  }

  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const r = nodeRows.get(id);
    if (!r) continue;
    const tags: string[] = JSON.parse(r.tags ?? "[]");
    // Visibility filter: exclude other users' private entries
    if (opts.userId && tags.includes("private") && (r as any).owner_user_id !== opts.userId) continue;
    nodes.push({
      id,
      label: (r.content as string).slice(0, 80),
      tags,
      kind: getKind(tags) as MemoryKind | null,
      status: getStatus(tags) as MemoryStatus | null,
      importance: (r.importance_score as number) ?? 0,
      created_at: r.created_at as number,
    });
  }
  const nodeIdSet = new Set(nodes.map(n => n.id));
  if (!nodeIdSet.size) return { nodes: [], edges: [] };

  // 3. Edges with BOTH endpoints present. Fetch edges touching the node set (chunked,
  // 2 binds/id), then keep only the internal ones — never a dangling edge.
  const presentIds = [...nodeIdSet];
  const edgeSeen = new Set<string>();
  const edges: GraphView["edges"] = [];
  for (let i = 0; i < presentIds.length; i += EDGE_QUERY_BATCH) {
    const batch = presentIds.slice(i, i + EDGE_QUERY_BATCH);
    const ph = batch.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT source_id, target_id, type, weight FROM edges WHERE source_id IN (${ph}) OR target_id IN (${ph}) ORDER BY weight DESC`
    ).bind(...batch, ...batch).all() as { results: any[] };
    for (const e of results) {
      if (!nodeIdSet.has(e.source_id) || !nodeIdSet.has(e.target_id)) continue;
      const key = `${e.source_id}|${e.target_id}|${e.type}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({ source: e.source_id, target: e.target_id, type: e.type, weight: e.weight });
    }
  }

  return { nodes, edges };
}

// Auto-link a freshly-stored entry to its most-similar existing neighbors with
// inferred `relates_to` edges. Reuses the similarity scores already computed during
// duplicate/contradiction detection — no extra embed or Vectorize query. Only the
// strongest few links above a confidence floor are kept so the graph stays sparse;
// the nightly graph pass later refines and types these.
//
// Threshold tuned for the bge-small-en-v1.5 embedding model, whose cosine scores are
// NOT spread across [0,1]: unrelated text lands ~0.4–0.6, mere keyword/concept overlap
// ~0.6–0.7, genuinely same-topic ~0.78–0.85, near-duplicate ≥0.85. We sit just below
// the 0.85 smart-merge band so we capture "clearly related but distinct" while
// rejecting loose overlap (e.g. "espresso filter" vs "Buy Me a Coffee", ~0.65). Lower
// toward ~0.74 if the graph feels too sparse; raise toward ~0.82 if noise returns.
export async function inferEdgesOnWrite(
  newId: string,
  neighbors: { id: string; score: number }[],
  env: Env,
): Promise<void> {
  const top = neighbors
    .filter(n => n.id !== newId && n.score >= EDGE_INFER_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, EDGE_INFER_MAX);
  for (const n of top) {
    await createEdge(newId, n.id, "relates_to", { weight: n.score, provenance: "inferred" }, env);
  }
}

// Compute auto-link neighbors from a query embedding: the topK Vectorize matches
// collapsed to parent ids (strongest score per parent). Lets the append path reuse the
// same inference as on capture without re-deriving the dedupe logic.
export async function neighborsFromVectorQuery(values: number[], env: Env, userId?: string): Promise<{ id: string; score: number }[]> {
  const vectorizeOpts: Record<string, any> = { topK: 5, returnMetadata: "all" };
  if (userId) {
    vectorizeOpts.metadataFilter = {
      OR: [
        { owner_user_id: { $eq: userId } },
        { is_private: { $eq: false } }
      ]
    };
  }
  const { matches } = await env.VECTORIZE.query(values, vectorizeOpts);
  const scores = new Map<string, number>();
  for (const m of matches) {
    const pid = (m.metadata as any)?.parentId ?? m.id;
    scores.set(pid, Math.max(scores.get(pid) ?? 0, m.score));
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score }));
}
