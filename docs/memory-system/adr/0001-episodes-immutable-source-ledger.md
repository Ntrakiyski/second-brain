# ADR-0001: Episodes as Immutable Source Ledger

**Status:** Superseded 2026-07-16 by the synchronous versioning contract
**Date:** 2026-07-13  
**Deciders:** Nikolay Trakiyski  

> Historical decision record. `src/entry-version-service.ts` now commits the
> entry projection, immutable episode, one document envelope, evidence rows,
> and cleanup intent atomically. Provenance failure fails the mutation; it is
> never fire-and-forget. Legacy entries receive an immutable baseline on their
> first versioned mutation.

## Context

`updateEntry()` destructively overwrites `entries.content` with no recovery path. Compression overwrites originals with LLM digests (though originals are tagged `rolled-up`). There is no way to trace a recalled fact back to its original source text. This is a provenance gap — epistemic errors correlate r=-0.65 with task failure (HELM, 2025).

## Decision

Create an `episodes` table where each row is an immutable snapshot of raw content at capture time. Episodes are created fire-and-forget during `captureEntry()` and during merge flows (before destructive UPDATE). Episodes are never updated or deleted.

The link from `entries` → `episodes` provides clean provenance. Compression continues to work as-is (rolled-up entries coexist with episodes). Recall joins episodes to return original content alongside entry results.

## Consequences

- **Positive:** Every new capture has an immutable source. Original text always recoverable. Clean joins for Phase 4 passage linking.
- **Positive:** No migration needed — existing entries have `episode_id = NULL`, queries use LEFT JOIN.
- **Negative:** One extra INSERT per capture (fire-and-forget, non-fatal). ~2x storage for new entries.
- **Neutral:** Pre-migration entries have no episodes. Known limitation, not a blocker.

## Alternatives Considered

1. **`raw_content` column on entries** — adds mutable state to an already-mutated table. Violates immutability goal.
2. **Version history in entries** — complex, no clean joins, no passage linking path.
3. **R2 blob storage** — adds a binding dependency, no SQL joins, overkill for text content.
