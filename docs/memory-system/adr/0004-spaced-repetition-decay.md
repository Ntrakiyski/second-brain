# ADR-0004: Spaced Repetition Decay from Last Recall

**Status:** Superseded 2026-07-16 by explicit reinforcement
**Date:** 2026-07-13  
**Deciders:** Nikolay Trakiyski  

> Recall is now strictly read-only. Only an explicit owner action through the
> human REST/MCP reinforcement surface increments `recall_count`, sets
> `last_recalled_at`, and resets `retention_score`. This removes ranking
> feedback caused by merely appearing in search results.

## Context

Current `getHalfLifeMs()` applies time-decay from age-since-creation, not time-since-last-recall. A memory recalled 100 days ago still scores well because `frequencyMultiplier` compensates. There is no `last_recalled_at` column. The frequency-based multiplier creates a feedback loop: frequently recalled entries stay high, rarely recalled entries fade regardless of actual relevance.

## Decision

Add `last_recalled_at` (INTEGER, nullable) and `retention_score` (REAL, default 1.0) to `entries`. Compute retention via exponential decay: `Math.exp(-λ * daysSinceLastRecall)` where `λ = ln(2) / RETENTION_HALF_LIFE_DAYS` (default 30 days). If `last_recalled_at` is NULL, use `created_at` as fallback. Recall updates `last_recalled_at` for returned entries (fire-and-forget).

The final recall score becomes: `semanticSimilarity × retentionScore × (existing multipliers)`.

## Consequences

- **Positive:** Memories fade unless reinforced — correct spaced-repetition behavior.
- **Positive:** Entry with 0 recalls for 90+ days scores < 0.5 retention — meets acceptance criteria.
- **Positive:** Configurable half-life via `RETENTION_HALF_LIFE_DAYS` constant.
- **Negative:** One UPDATE per recall result (fire-and-forget, non-fatal). Negligible D1 cost.
- **Neutral:** Existing entries (last_recalled_at = NULL) default to created_at — old entries appear "old" but not immediately stale.

## Alternatives Considered

1. **Decay from creation date** — current behavior, doesn't account for reinforcement.
2. **SM-2 algorithm** — overkill for a note-taking system, requires interval tracking.
3. **No decay, only importance scoring** — doesn't capture temporal relevance.
