/**
 * types.ts — Shared type definitions used across modules.
 *
 * Purpose: Define all cross-module interfaces, enums, and type aliases in one place.
 * Input: None (type-only module).
 * Output: Env, RecallMatch, MemoryStatus, MemoryKind, CaptureResult, etc.
 * Logic: Type definitions only — no runtime logic.
 */

// ─── Cloudflare Worker environment bindings ────────────────────────────────────
// Bindings come from the generated Cloudflare.Env (see `wrangler types`);
// VECTORIZE_GRACE_MS is widened from its generated literal default so tests
// and per-deploy vars can override it.

export interface Env extends Omit<Cloudflare.Env, "VECTORIZE_GRACE_MS"> {
  VECTORIZE_GRACE_MS?: string;
}

// ─── Memory lifecycle ──────────────────────────────────────────────────────────

export const STATUS_PREFIX = "status:";
export const KIND_PREFIX = "kind:";
export const KIND_VALUES = ["episodic", "semantic"] as const;
export const MEMORY_KIND_VALUES = KIND_VALUES;
export type MemoryKind = (typeof KIND_VALUES)[number];

export const STATUS_VALUES = ["canonical", "draft", "deprecated"] as const;
export type MemoryStatus = (typeof STATUS_VALUES)[number];

// ─── Recall results ────────────────────────────────────────────────────────────

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

// ─── Ingestion capture result ──────────────────────────────────────────────────

export type CaptureResult =
  | { status: "blocked"; matchId: string; score: number }
  | { status: "stored"; id: string; crossUserNote?: string }
  | { status: "flagged"; id: string; matchId: string; score: number; crossUserNote?: string }
  | { status: "contradiction"; id: string; resolvedConflict: string; reason?: string }
  | { status: "contradiction_protected"; id: string; canonicalId: string; reason?: string }
  | { status: "contradiction_resolved"; id: string; replacedId?: string; mergedInto?: string; keptBoth?: boolean; reason?: string };
