# ADR-0002: Cross-User Contradiction Detection — Dual-Path

Cross-user contradictions (where user A's entry conflicts with user B's public entry) need detection. A single path is insufficient: during-recall catches contradictions when relevant entries surface, but misses contradictions that are never recalled; nightly-only introduces up to 24h latency.

Use both paths: during recall (real-time, for immediate context) and nightly cron (catch-all, for comprehensive coverage). Both write to the same `edge_proposals` table with deduplication by `(source_id, target_id)` — if a pending proposal already exists for a pair, neither path creates a duplicate. Proposals are always gated (human approval required) — no automatic edge creation for cross-user contradictions.
