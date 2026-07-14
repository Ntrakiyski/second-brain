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

// ─── Epistemic status (Ticket 06) ────────────────────────────────────────────
export const EPISTEMIC_STATUS_VALUES = ["candidate", "reviewed", "canonical", "qualified", "stale", "superseded", "retracted"] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUS_VALUES)[number];

// ─── Epistemic state machine (Ticket 10) ─────────────────────────────────────
export const VALID_EPISTEMIC_TRANSITIONS: Record<EpistemicStatus, readonly EpistemicStatus[]> = {
  candidate:   ["reviewed"],
  reviewed:    ["canonical"],
  canonical:   ["qualified", "superseded"],
  qualified:   ["canonical", "superseded"],
  stale:       ["reviewed", "retracted"],
  superseded:  ["retracted"],
  retracted:   [],
};

export function isValidTransition(from: EpistemicStatus, to: EpistemicStatus): boolean {
  return VALID_EPISTEMIC_TRANSITIONS[from]?.includes(to) ?? false;
}

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
  passages?: { id: string; content: string; section: string | null; startOffset: number | null; endOffset: number | null }[];
  relations?: { type: string; confidence: number; targetId: string; targetContent?: string }[];
  epistemicStatus?: string;
}

// ─── Ingestion capture result ──────────────────────────────────────────────────

export type CaptureResult =
  | { status: "blocked"; matchId: string; score: number }
  | { status: "stored"; id: string; crossUserNote?: string }
  | { status: "flagged"; id: string; matchId: string; score: number; crossUserNote?: string }
  | { status: "contradiction"; id: string; resolvedConflict: string; reason?: string }
  | { status: "contradiction_protected"; id: string; canonicalId: string; reason?: string }
  | { status: "contradiction_resolved"; id: string; replacedId?: string; mergedInto?: string; keptBoth?: boolean; reason?: string };

// ─── Memory Pillar: Episodes, Snapshots, Passages ────────────────────────────

export interface Episode {
  id: string;
  entryId: string;
  content: string;
  contentType: string;
  source: string;
  createdAt: number;
}

export interface EntrySnapshot {
  id: string;
  entryId: string;
  content: string;
  tags: string;
  source: string;
  createdAt: number;
}

export interface Passage {
  id: string;
  entryId: string;
  episodeId: string | null;
  content: string;
  section: string | null;
  page: number | null;
  startOffset: number | null;
  endOffset: number | null;
  vectorIds: string;
  createdAt: number;
}

export interface Document {
  id: string;
  title: string;
  sourceUrl: string | null;
  contentType: string;
  createdAt: number;
}

export interface DocumentSection {
  id: string;
  documentId: string;
  parentSectionId: string | null;
  title: string;
  level: number;
  orderIndex: number;
  createdAt: number;
}
