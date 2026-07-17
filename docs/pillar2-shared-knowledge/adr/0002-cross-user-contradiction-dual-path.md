# ADR-0002: Cross-User Contradiction Detection — Dual-Path

**Status:** Superseded 2026-07-16 by read-only recall and governed nightly diagnosis

Similarity now generates candidates only. Recall never writes proposals or
usage state. The nightly path reauthorizes both public entries in D1, requires
a strict high-confidence classifier with exact evidence from both claims, and
creates an idempotent team-visible `edge.publish` action proposal. Uncertain,
malformed, or unavailable classification is a no-op.

Cross-user contradictions (where user A's entry conflicts with user B's public entry) need detection. A single path is insufficient: during-recall catches contradictions when relevant entries surface, but misses contradictions that are never recalled; nightly-only introduces up to 24h latency.

Use both paths: during recall (real-time, for immediate context) and nightly cron (catch-all, for comprehensive coverage). Both write to the same `edge_proposals` table with deduplication by `(source_id, target_id)` — if a pending proposal already exists for a pair, neither path creates a duplicate. Proposals are always gated (human approval required) — no automatic edge creation for cross-user contradictions.
